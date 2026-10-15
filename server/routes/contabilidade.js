/*
 * Contabilidade — exclusivo da administração.
 *
 *  GET  /api/contabilidade/planilhas?mes=AAAA-MM&arquivo=recebimentos|alvaras
 *       Gera, a partir do Financeiro, as duas planilhas que o escritório envia todo mês ao contador, no padrão já usado
 *       (cabeçalho azul #1F4E78 com texto branco, bordas, filtro, 1ª linha congelada, moeda R$ e totais com fórmula):
 *         - Recebimentos_Honorarios_Mes_MM_AAAA.xlsx: NOME DO CLIENTE | CPF / CNPJ | VALOR RECEBIDO (R$) | TIPO DE COBRANÇA
 *             receitas realizadas do mês nas categorias de honorários (iniciais → "Honorário Inicial"; êxito/parceria/consultoria → "Honorário Final")
 *         - Alvaras_Judiciais_Mes_MM_AAAA.xlsx: Nº DO PROCESSO | NOME | CPF / CNPJ | VALOR BRUTO | VALOR REPASSADO | VALOR A DECLARAR | OBSERVAÇÃO / VARA
 *             receitas "Alvará de honorários finais" do mês; bruto = valor total da condenação do processo, a declarar = honorários recebidos,
 *             repassado = bruto − a declarar (quando o processo tem condenação informada)
 *  POST /api/contabilidade/ler-planilha  { nome, base64 }
 *       Lê uma planilha nesses dois formatos e devolve as linhas normalizadas (a tela monta a prévia e grava pelos endpoints normais).
 */
const express = require('express');
const ExcelJS = require('exceljs');
const { db, caseRow, financeRow } = require('../db');
const { requireAdmin } = require('../auth');
const { cnj } = require('../validate');

const router = express.Router();
router.use(requireAdmin);

const AZUL = 'FF1F4E78', BRANCO = 'FFFFFFFF', MOEDA = 'R$ #,##0.00';
const SIMPLES = { 'Honorários iniciais': 'Honorário Inicial', 'Honorários de êxito': 'Honorário Final', 'Honorários de parceria': 'Honorário Final', 'Consultoria': 'Honorário Final', 'Repasse de parceria': 'Honorário Final' };
const round2 = v => Math.round((Number(v) || 0) * 100) / 100;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const digits = s => String(s || '').replace(/\D/g, '');

function styleSheet(ws, nCols) {
  ws.getRow(1).eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }; c.font = { bold: true, color: { argb: BRANCO } }; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });
  ws.getRow(1).height = 24;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  ws.eachRow((row, i) => { for (let c = 1; c <= nCols; c++) { const cell = row.getCell(c); cell.border = { top: thin, left: thin, bottom: thin, right: thin }; if (i > 1 && typeof cell.value === 'number') cell.alignment = { horizontal: 'right' }; } });
}
function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

/* Dados do mês */
function mesRows(mes) {
  const ini = `${mes}-01`, fim = `${mes}-31`;
  const fin = db.prepare("SELECT * FROM finance_entries WHERE tipo = 'receita' AND status = 'realizado' AND data >= ? AND data <= ? ORDER BY data, criado_em").all(ini, fim).map(financeRow);
  const caseById = id => id ? caseRow(db.prepare('SELECT * FROM cases WHERE id = ?').get(id)) : null;
  const recebimentos = [], alvaras = [];
  for (const e of fin) {
    const c = caseById(e.caseId);
    if (e.categoria === 'Alvará de honorários finais') {
      const bruto = c && c.valorCondenacao != null ? round2(c.valorCondenacao) : null, declarar = round2(e.valor);
      alvaras.push({ processo: c ? (c.natureza === 'judicial' ? cnj(c.numeroProcesso) : c.numeroProcesso) : (e.descricao.match(/Processo\s+([\d.\-\/]+)/) || [])[1] || '', cliente: c ? c.cliente : e.descricao, cpf: c?.cpfCnpj || '', bruto: bruto ?? declarar, repassado: bruto != null ? round2(bruto - declarar) : 0, declarar, obs: c ? [c.tipoAcao, c.fase === 'julgado' ? 'alvará' : ''].filter(Boolean).join(' — ') : 'processo não cadastrado no sistema', data: e.data, caseId: e.caseId || null, entryId: e.id });
    } else if (SIMPLES[e.categoria]) {
      recebimentos.push({ cliente: c ? c.cliente : (e.descricao || e.categoria).replace(/\s*\(.*$/, ''), cpf: c?.cpfCnpj || (e.descricao.match(/(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/) || [])[1] || '', valor: round2(e.valor), tipo: SIMPLES[e.categoria], categoria: e.categoria, data: e.data, parcela: e.parcela || '', caseId: e.caseId || null, entryId: e.id });
    }
  }
  return { recebimentos, alvaras };
}

router.get('/resumo', (req, res) => {
  const mes = String(req.query.mes || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ error: 'Informe o mês (AAAA-MM).' });
  const d = mesRows(mes);
  res.json({ mes, recebimentos: d.recebimentos, alvaras: d.alvaras, totais: { recebimentos: round2(d.recebimentos.reduce((s, r) => s + r.valor, 0)), bruto: round2(d.alvaras.reduce((s, r) => s + r.bruto, 0)), repassado: round2(d.alvaras.reduce((s, r) => s + r.repassado, 0)), declarar: round2(d.alvaras.reduce((s, r) => s + r.declarar, 0)) }, semCpf: d.recebimentos.filter(r => !r.cpf).length + d.alvaras.filter(r => !r.cpf).length });
});

router.get('/planilhas', async (req, res, next) => {
  try {
    const mes = String(req.query.mes || '').slice(0, 7), arquivo = String(req.query.arquivo || 'recebimentos');
    if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ error: 'Informe o mês (AAAA-MM).' });
    const [ano, mm] = mes.split('-'), d = mesRows(mes), wb = new ExcelJS.Workbook();
    wb.creator = 'Gestão geral — Costa de Araújo';
    let nome;
    if (arquivo === 'alvaras') {
      nome = `Alvaras_Judiciais_Mes_${mm}_${ano}.xlsx`;
      const ws = wb.addWorksheet('Alvarás Judiciais');
      ws.columns = [{ width: 30 }, { width: 34 }, { width: 23 }, { width: 19 }, { width: 21 }, { width: 22 }, { width: 55 }];
      ws.addRow(['Nº DO PROCESSO JUDICIAL', 'NOME DO CLIENTE', 'CPF / CNPJ', 'VALOR BRUTO (R$)', 'VALOR REPASSADO (R$)', 'VALOR A DECLARAR (R$)', 'OBSERVAÇÃO / VARA']);
      for (const r of d.alvaras) ws.addRow([r.processo, r.cliente, r.cpf || 'Não informado', r.bruto, r.repassado, r.declarar, r.obs]);
      const n = d.alvaras.length, last = n + 1;
      if (n) { const t = ws.addRow(['TOTAL', '', '', { formula: `SUM(D2:D${last})` }, { formula: `SUM(E2:E${last})` }, { formula: `SUM(F2:F${last})` }, '']); t.font = { bold: true }; }
      else ws.addRow(['Não houve recebimento de alvará judicial no mês.']);
      ws.addRow([]); ws.addRow(['OBSERVAÇÃO']).font = { bold: true };
      ws.addRow(['Valores informados pelo escritório. O valor a declarar corresponde à parcela que permaneceu com o escritório (honorários).']);
      for (let i = 2; i <= last + 1; i++) ['D', 'E', 'F'].forEach(col => { ws.getCell(`${col}${i}`).numFmt = MOEDA; });
      ws.autoFilter = `A1:G${Math.max(2, last)}`;
      styleSheet(ws, 7);
    } else {
      nome = `Recebimentos_Honorarios_Mes_${mm}_${ano}.xlsx`;
      const ws = wb.addWorksheet('Recebimentos');
      ws.columns = [{ width: 40 }, { width: 23 }, { width: 20 }, { width: 23 }];
      ws.addRow(['NOME DO CLIENTE', 'CPF / CNPJ', 'VALOR RECEBIDO (R$)', 'TIPO DE COBRANÇA']);
      for (const r of d.recebimentos) ws.addRow([r.cliente, r.cpf || 'Não informado', r.valor, r.tipo]);
      const n = d.recebimentos.length, last = n + 1;
      if (n) { const t = ws.addRow(['TOTAL', '', { formula: `SUM(C2:C${last})` }, '']); t.font = { bold: true }; }
      else ws.addRow(['Não houve recebimento de honorários no mês.']);
      ws.addRow([]); ws.addRow(['OBSERVAÇÃO']).font = { bold: true };
      ws.addRow([`Planilha referente aos recebimentos de honorários do mês ${mm}/${ano}.`]);
      for (let i = 2; i <= last + 1; i++) ws.getCell(`C${i}`).numFmt = MOEDA;
      ws.autoFilter = `A1:D${Math.max(2, last)}`;
      styleSheet(ws, 4);
    }
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(Buffer.from(buf));
  } catch (e) { next(e); }
});

/* Leitura de uma planilha enviada (formatos de recebimentos e de alvarás). */
const H = {
  recebimentos: { cliente: /NOME/, cpf: /CPF|CNPJ/, valor: /VALOR/, tipo: /TIPO/ },
  alvaras: { processo: /PROCESSO/, cliente: /NOME/, cpf: /CPF|CNPJ/, bruto: /BRUTO/, repassado: /REPASS/, declarar: /DECLARAR/, obs: /OBSERVA|VARA/ }
};
const cellText = v => v == null ? '' : typeof v === 'object' ? (v.richText ? v.richText.map(t => t.text).join('') : v.result != null ? String(v.result) : v.text != null ? String(v.text) : String(v)) : String(v);
const cellNum = v => { if (v == null || v === '') return null; if (typeof v === 'number') return round2(v); if (typeof v === 'object' && v.result != null) return round2(v.result); const s = cellText(v).replace(/[R$\s]/g, ''); const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s); return Number.isFinite(n) ? round2(n) : null; };

router.post('/ler-planilha', async (req, res, next) => {
  try {
    const nome = String(req.body?.nome || '').slice(0, 200), b64 = String(req.body?.base64 || '');
    if (!b64 || b64.length > 6_000_000) return res.status(400).json({ error: 'Envie a planilha (até 4 MB).' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(b64, 'base64'));
    const ws = wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: 'Planilha vazia.' });
    const head = ws.getRow(1).values.map(v => norm(cellText(v)));
    const tipo = head.some(h => /PROCESSO/.test(h)) && head.some(h => /DECLARAR|BRUTO/.test(h)) ? 'alvaras' : head.some(h => /NOME/.test(h)) && head.some(h => /VALOR/.test(h)) ? 'recebimentos' : null;
    if (!tipo) return res.status(400).json({ error: 'Não reconheci o cabeçalho. Esperado: "NOME DO CLIENTE | CPF / CNPJ | VALOR RECEBIDO | TIPO DE COBRANÇA" ou "Nº DO PROCESSO | NOME | CPF / CNPJ | VALOR BRUTO | VALOR REPASSADO | VALOR A DECLARAR | OBSERVAÇÃO".' });
    const col = {}; for (const [k, rx] of Object.entries(H[tipo])) col[k] = head.findIndex((h, i) => i > 0 && rx.test(h) && !Object.values(col).includes(i));
    const mesArq = (nome.match(/(\d{2})[_-](\d{4})/) || [])[0]; const mes = mesArq ? `${mesArq.slice(3, 7)}-${mesArq.slice(0, 2)}` : null;
    const linhas = [];
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const v = row.values; const first = norm(cellText(v[1]));
      if (!first || /^TOTAL/.test(first) || /^OBSERVA/.test(first) || /^PLANILHA REFERENTE|^VALORES INFORMADOS|^NAO HOUVE/.test(first)) return;
      if (tipo === 'recebimentos') {
        const valor = cellNum(v[col.valor]); if (valor == null) return;
        linhas.push({ linha: i, cliente: cellText(v[col.cliente]).trim(), cpf: cellText(v[col.cpf]).trim(), valor, tipo: cellText(v[col.tipo]).trim() || 'Honorário Inicial' });
      } else {
        const declarar = cellNum(v[col.declarar]), bruto = cellNum(v[col.bruto]), repassado = cellNum(v[col.repassado]);
        if (declarar == null && bruto == null) return;
        const proc = cellText(v[col.processo]).trim();
        linhas.push({ linha: i, processo: digits(proc).length === 20 ? cnj(proc) : proc, processoDigitos: digits(proc), cliente: cellText(v[col.cliente]).trim(), cpf: cellText(v[col.cpf]).trim(), bruto, repassado, declarar: declarar ?? (bruto != null && repassado != null ? round2(bruto - repassado) : null), obs: col.obs > 0 ? cellText(v[col.obs]).trim() : '', confere: bruto != null && repassado != null && declarar != null ? Math.abs(round2(bruto - repassado) - declarar) < 0.011 : null });
      }
    });
    res.json({ tipo, mes, nome, linhas });
  } catch (e) { if (/zip|central directory|not a valid/i.test(String(e.message))) return res.status(400).json({ error: 'Arquivo inválido: envie a planilha em formato .xlsx.' }); next(e); }
});

module.exports = router;
module.exports.mesRows = mesRows;
