#!/usr/bin/env node
/*
 * Importa o CSV exportado pelo próprio sistema (botão "Exportar CSV", separador ";").
 * Serve para migrar os dados da versão hospedada no Claude para o site próprio.
 *
 *   npm run import -- caminho/para/parcerias-processos-2026-09-29.csv
 *
 * Parceiros são localizados pelo nome; os que não existirem são criados com um
 * login sugerido e uma senha temporária, mostrados no final (envie-os ao parceiro).
 */
require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const { db, nowISO, uuid, audit } = require('../server/db');
const { hash } = require('../server/auth');
const { cnj } = require('../server/validate');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('Informe o caminho do arquivo CSV.'); process.exit(1); }

function parseCSV(text, sep = ';') {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
const money = s => { s = String(s || '').trim(); if (!s) return 0; if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); return Number(s) || 0; };
const dateBR = s => { const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null); };
const sim = s => /^s/i.test(String(s || '').trim());
const slug = n => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).filter(Boolean);
const tempPassword = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; return Array.from(crypto.randomBytes(10)).map(b => a[b % a.length]).join(''); };

(async () => {
  const rows = parseCSV(fs.readFileSync(file, 'utf8'));
  const head = rows.shift().map(h => h.trim().toLowerCase());
  const col = name => head.findIndex(h => h === name.toLowerCase());
  const C = {
    data: col('Data do protocolo'), numero: col('Número do processo'), cliente: col('Cliente'), parceiro: col('Parceiro'), tipo: col('Tipo de ação'),
    hon: col('Honorários pretendidos'), lead: col('Custo do lead'), pp: col('% parceiro'), pn: col('% escritório'), rec: col('Recebido'), vrec: col('Valor recebido'),
    drec: col('Data do recebimento'), cor: col('Corretor'), ncor: col('Nome do corretor'), vcor: col('Valor do corretor'), corPago: col('Corretor pago'), obs: col('Observações')
  };
  for (const [k, v] of Object.entries(C)) if (v < 0) { console.error(`Coluna não encontrada no CSV: ${k}`); process.exit(1); }
  const cNat = col('Natureza'), cFase = col('Fase'), cSit = col('Situação'), cVA = col('Valor da ação'), cVC = col('Valor da condenação'), cPH = col('% honorários (escritório)'); // opcionais (exportações antigas não têm)

  const findPartner = db.prepare('SELECT id FROM partners WHERE lower(nome) = lower(?)');
  const userTaken = db.prepare('SELECT 1 FROM users WHERE usuario = ?');
  const existsCase = db.prepare('SELECT 1 FROM cases WHERE numero_processo = ? AND partner_id IS ?');
  const isOffice = nome => !nome || /^(escrit[oó]rio|somente do escrit[oó]rio|—|-)$/i.test(nome); // processo só do escritório (sem parceiro)
  const created = []; let inserted = 0, skipped = 0;

  const tx = db.transaction(async () => {});
  void tx;
  for (const r of rows) {
    const nome = (r[C.parceiro] || '').trim();
    const office = isOffice(nome);
    let p = office ? null : findPartner.get(nome);
    let pid = p?.id || null;
    if (!pid && !office) {
      pid = uuid(); const now = nowISO();
      const parts = slug(nome); let usuario = parts.length > 1 ? parts[0] + '.' + parts[parts.length - 1] : (parts[0] || 'parceiro'); let n = 1;
      while (userTaken.get(usuario)) usuario = usuario.replace(/\d+$/, '') + (++n);
      const senha = tempPassword();
      db.prepare('INSERT INTO partners (id, nome, ativo, criado_em, atualizado_em) VALUES (?,?,1,?,?)').run(pid, nome, now, now);
      db.prepare('INSERT INTO users (id, usuario, senha_hash, role, partner_id, ativo, criado_em, atualizado_em) VALUES (?,?,?,?,?,1,?,?)').run(uuid(), usuario, await hash(senha), 'partner', pid, now, now);
      created.push({ nome, usuario, senha });
    }
    const natureza = cNat >= 0 && /^adm/i.test(String(r[cNat] || '').trim()) ? 'administrativo' : 'judicial';
    const numero = natureza === 'judicial' ? cnj(r[C.numero]) : String(r[C.numero] || '').trim();
    if (existsCase.get(numero, pid)) { skipped++; continue; }
    const now = nowISO(), rec = sim(r[C.rec]), cor = sim(r[C.cor]);
    const fase = cFase >= 0 && /^julg/i.test(String(r[cFase] || '')) ? 'julgado' : 'em_curso';
    const sit = cSit >= 0 ? String(r[cSit] || '').toLowerCase() : '';
    const resultado = /perdid/.test(sit) ? 'perdido' : (rec || /receb/.test(sit)) ? 'recebido' : 'em_andamento';
    db.prepare(`INSERT INTO cases (id, partner_id, titularidade, valor_acao, valor_condenacao, pct_honorarios, natureza, fase, resultado, financeiro_status, numero_processo, cliente, tipo_acao, data_protocolo, honorarios_pretendidos, custo_lead, pct_parceiro, pct_nosso,
      recebido, valor_recebido, data_recebimento, tem_corretor, nome_corretor, valor_corretor, corretor_pago, observacoes, criado_por, criado_em, atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(uuid(), pid, office ? 'escritorio' : 'parceria', cVA >= 0 && String(r[cVA] || '').trim() ? money(r[cVA]) : null, cVC >= 0 && String(r[cVC] || '').trim() ? money(r[cVC]) : null, office && cPH >= 0 && String(r[cPH] || '').trim() ? money(r[cPH]) : null, natureza, fase, resultado, resultado === 'recebido' ? 'pendente' : 'nao', numero, r[C.cliente] || '', r[C.tipo] || '', dateBR(r[C.data]) || now.slice(0, 10), money(r[C.hon]), money(r[C.lead]), office ? 0 : money(r[C.pp]), office ? 100 : money(r[C.pn]),
        resultado === 'recebido' ? 1 : 0, resultado === 'recebido' ? money(r[C.vrec]) : null, resultado === 'recebido' ? dateBR(r[C.drec]) : null, cor ? 1 : 0, cor ? (r[C.ncor] || '') : '', cor ? money(r[C.vcor]) : 0, cor && sim(r[C.corPago]) ? 1 : 0, r[C.obs] || '', 'importacao', now, now);
    inserted++;
  }
  audit({ acao: 'importar_csv', entidade: 'case', detalhes: { arquivo: file, inseridos: inserted, ignorados: skipped } });
  console.log(`Importação concluída: ${inserted} processo(s) inserido(s), ${skipped} já existente(s) ignorado(s).`);
  if (created.length) {
    console.log('\nParceiros criados (envie estes acessos; a senha pode ser trocada em "Nova senha"):');
    for (const c of created) console.log(`  ${c.nome}  →  usuário: ${c.usuario}   senha: ${c.senha}`);
  }
})().catch(e => { console.error('Erro:', e.message); process.exit(1); });
