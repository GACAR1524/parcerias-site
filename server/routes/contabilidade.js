/*
 * Importação de lançamentos a partir de planilhas — exclusivo da administração.
 *
 * O escritório fecha o mês fora do sistema (planilhas para o contador). Aqui o sistema só LÊ essas planilhas e devolve
 * as linhas normalizadas; a tela monta a prévia e grava pelos endpoints normais (processos e Financeiro).
 *
 * Dados sensíveis NÃO entram: a coluna de CPF/CNPJ é ignorada na leitura e nunca sai desta rota.
 *
 *  POST /api/contabilidade/ler-planilha  { nome, base64 }  → { tipo, mes, nome, linhas }
 *    tipo 'recebimentos' : NOME DO CLIENTE | CPF / CNPJ (ignorado) | VALOR RECEBIDO (R$) | TIPO DE COBRANÇA
 *    tipo 'alvaras'      : Nº DO PROCESSO | NOME DO CLIENTE | CPF / CNPJ (ignorado) | VALOR BRUTO | VALOR REPASSADO | VALOR A DECLARAR | OBSERVAÇÃO / VARA
 *    tipo 'lancamentos'  : DATA | TIPO (receita/despesa) | CATEGORIA | DESCRIÇÃO | VALOR (R$) | VENCIMENTO (opcional)  — ex.: guias de imposto
 *  Linhas de TOTAL / OBSERVAÇÃO são puladas; valores aceitam número ou texto "R$ 1.234,56"; número CNJ com 20 dígitos é formatado.
 */
const express = require('express');
const ExcelJS = require('exceljs');
const { requireAdmin } = require('../auth');
const { cnj } = require('../validate');

const router = express.Router();
router.use(requireAdmin);

const round2 = v => Math.round((Number(v) || 0) * 100) / 100;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const digits = s => String(s || '').replace(/\D/g, '');
const cellText = v => v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'object' ? (v.richText ? v.richText.map(t => t.text).join('') : v.result != null ? String(v.result) : v.text != null ? String(v.text) : String(v)) : String(v);
const cellNum = v => { if (v == null || v === '') return null; if (typeof v === 'number') return round2(v); if (typeof v === 'object' && v.result != null) return round2(v.result); const s = cellText(v).replace(/[R$\s]/g, ''); const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s); return Number.isFinite(n) ? round2(n) : null; };
const cellDate = v => { if (v instanceof Date) return v.toISOString().slice(0, 10); const s = cellText(v).trim(); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return null; };

const H = {
  recebimentos: { cliente: /NOME/, valor: /VALOR/, tipo: /TIPO/ },
  alvaras: { processo: /PROCESSO/, cliente: /NOME/, bruto: /BRUTO/, repassado: /REPASS/, declarar: /DECLARAR/, obs: /OBSERVA|VARA/ },
  lancamentos: { data: /^DATA$|DATA DO/, tipo: /^TIPO/, categoria: /CATEGORIA/, descricao: /DESCRI/, valor: /VALOR/, vencimento: /VENCIMENTO/ }
};

router.post('/ler-planilha', async (req, res, next) => {
  try {
    const nome = String(req.body?.nome || '').slice(0, 200), b64 = String(req.body?.base64 || '');
    if (!b64 || b64.length > 6_000_000) return res.status(400).json({ error: 'Envie a planilha (até 4 MB).' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(b64, 'base64'));
    const ws = wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: 'Planilha vazia.' });
    const head = ws.getRow(1).values.map(v => norm(cellText(v)));
    const tipo = head.some(h => /PROCESSO/.test(h)) && head.some(h => /DECLARAR|BRUTO/.test(h)) ? 'alvaras'
      : head.some(h => /^DATA/.test(h)) && head.some(h => /CATEGORIA/.test(h)) && head.some(h => /VALOR/.test(h)) ? 'lancamentos'
      : head.some(h => /NOME/.test(h)) && head.some(h => /VALOR/.test(h)) ? 'recebimentos' : null;
    if (!tipo) return res.status(400).json({ error: 'Não reconheci o cabeçalho. Formatos aceitos: recebimentos ("NOME DO CLIENTE | … | VALOR RECEBIDO | TIPO DE COBRANÇA"), alvarás ("Nº DO PROCESSO | NOME | … | VALOR BRUTO | VALOR REPASSADO | VALOR A DECLARAR") ou lançamentos ("DATA | TIPO | CATEGORIA | DESCRIÇÃO | VALOR").' });
    const col = {}; for (const [k, rx] of Object.entries(H[tipo])) col[k] = head.findIndex((h, i) => i > 0 && rx.test(h) && !Object.values(col).includes(i));
    const mesArq = (nome.match(/(\d{2})[_-](\d{4})/) || [])[0]; const mes = mesArq ? `${mesArq.slice(3, 7)}-${mesArq.slice(0, 2)}` : null;
    const linhas = [];
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const v = row.values; const first = norm(cellText(v[1]));
      if (!first || /^TOTAL/.test(first) || /^OBSERVA/.test(first) || /^PLANILHA REFERENTE|^VALORES INFORMADOS|^NAO HOUVE/.test(first)) return;
      if (tipo === 'recebimentos') {
        const valor = cellNum(v[col.valor]); if (valor == null) return;
        linhas.push({ linha: i, cliente: cellText(v[col.cliente]).trim(), valor, tipo: cellText(v[col.tipo]).trim() || 'Honorário Inicial' });
      } else if (tipo === 'alvaras') {
        const declarar = cellNum(v[col.declarar]), bruto = cellNum(v[col.bruto]), repassado = cellNum(v[col.repassado]);
        if (declarar == null && bruto == null) return;
        const proc = cellText(v[col.processo]).trim();
        linhas.push({ linha: i, processo: digits(proc).length === 20 ? cnj(proc) : proc, processoDigitos: digits(proc), cliente: cellText(v[col.cliente]).trim(), bruto, repassado, declarar: declarar ?? (bruto != null && repassado != null ? round2(bruto - repassado) : null), obs: col.obs > 0 ? cellText(v[col.obs]).trim() : '', confere: bruto != null && repassado != null && declarar != null ? Math.abs(round2(bruto - repassado) - declarar) < 0.011 : null });
      } else {
        const valor = cellNum(v[col.valor]); if (valor == null) return;
        const t = norm(cellText(v[col.tipo])); const tp = /RECEITA|ENTRADA/.test(t) ? 'receita' : 'despesa';
        linhas.push({ linha: i, data: cellDate(v[col.data]), tipo: tp, categoria: cellText(v[col.categoria]).trim() || (tp === 'despesa' ? 'Impostos e taxas' : 'Outras receitas'), descricao: cellText(v[col.descricao]).trim(), valor, vencimento: col.vencimento > 0 ? cellDate(v[col.vencimento]) : null });
      }
    });
    res.json({ tipo, mes, nome, linhas });
  } catch (e) { if (/zip|central directory|not a valid|end of data/i.test(String(e.message))) return res.status(400).json({ error: 'Arquivo inválido: envie a planilha em formato .xlsx.' }); next(e); }
});

module.exports = router;
