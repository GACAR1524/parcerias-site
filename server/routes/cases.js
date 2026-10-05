const express = require('express');
const { db, nowISO, uuid, audit, caseRow } = require('../db');
const { requireAuth, denyIntern } = require('../auth');
const { caseInput, cnj } = require('../validate');

const router = express.Router();
router.use(requireAuth, denyIntern);

const ALL = 'SELECT * FROM cases ORDER BY data_protocolo DESC, criado_em DESC';
const MINE = 'SELECT * FROM cases WHERE partner_id = ? ORDER BY data_protocolo DESC, criado_em DESC';
const ONE = db.prepare('SELECT * FROM cases WHERE id = ?');
const partnerById = db.prepare('SELECT id, nome, tipo FROM partners WHERE id = ?');
const round2 = v => Math.round(v * 100) / 100;

/* Escopo: o parceiro só enxerga (e só grava em) os próprios processos. */
function scoped(req, row) { return req.user.role === 'admin' || row.partner_id === req.user.partner_id; }

/* Lançamentos que um recebimento gera no financeiro (mesma regra da tela). */
function financeEntriesFor(c, partner) {
  const partnerNome = partner?.nome || 'parceiro', associado = partner?.tipo === 'associado';
  if (c.titularidade === 'escritorio' || !c.parceiroId) {
    const recebidoTotal = c.valorRecebido == null ? c.honorariosPretendidos : c.valorRecebido;
    const numeroE = c.natureza === 'judicial' ? cnj(c.numeroProcesso) : c.numeroProcesso;
    return recebidoTotal > 0 ? [{ tipo: 'receita', categoria: c.fase === 'julgado' ? 'Alvará de honorários finais' : 'Honorários de êxito', descricao: `Processo ${numeroE} — ${c.cliente} (escritório)`, valor: round2(recebidoTotal) }] : [];
  }
  const recebido = c.valorRecebido == null ? c.honorariosPretendidos : c.valorRecebido;
  const nossa = round2(recebido * c.pctNosso / 100), parceiro = round2(recebido * c.pctParceiro / 100);
  const numero = c.natureza === 'judicial' ? cnj(c.numeroProcesso) : c.numeroProcesso;
  const ref = `Processo ${numero} — ${c.cliente}`;
  const categoria = c.fase === 'julgado' ? 'Alvará de honorários finais' : (associado ? 'Honorários de êxito' : 'Honorários de parceria');
  const out = [];
  if (!associado && c.fluxoRecebimento === 'parceiro') out.push({ tipo: 'receita', categoria, descricao: `${ref} (parte do escritório, repassada por ${partnerNome})`, valor: nossa });
  else {
    out.push({ tipo: 'receita', categoria, descricao: `${ref} (valor total recebido)`, valor: round2(recebido) });
    if (associado) out.push({ tipo: 'despesa', categoria: 'Bonificação de associado', descricao: `Bonificação de ${partnerNome} — ${ref}`, valor: parceiro, associadoId: partner.id });
    else out.push({ tipo: 'despesa', categoria: 'Repasse a parceiro', descricao: `Repasse a ${partnerNome} — ${ref}`, valor: parceiro });
  }
  return out.filter(e => e.valor > 0);
}

/*
 * Decide o estado do financeiro para o processo:
 *  - deixou de estar "recebido": remove os lançamentos vinculados (se havia) → 'nao'
 *  - está "recebido" e ainda não lançado: admin com lancarFinanceiro=true → grava e marca 'lancado';
 *    caso contrário fica 'pendente' (aguardando confirmação do escritório)
 * Deve rodar dentro da transação que grava o processo.
 */
function settleFinance({ cur, c, id, req }) {
  const prev = cur?.financeiro_status || 'nao';
  let status = prev, em = cur?.financeiro_em || null;
  if (c.resultado !== 'recebido') {
    if (prev === 'lancado') db.prepare('DELETE FROM finance_entries WHERE case_id = ?').run(id);
    status = 'nao'; em = null;
  } else if (prev !== 'lancado') {
    if (req.user.role === 'admin' && req.body.lancarFinanceiro === true) {
      const partner = c.parceiroId ? partnerById.get(c.parceiroId) : null;
      const now = nowISO();
      if (partner?.tipo === 'associado' || !partner) c.fluxoRecebimento = 'escritorio';
      for (const e of financeEntriesFor(c, partner)) {
        db.prepare(`INSERT INTO finance_entries (id, tipo, categoria, descricao, valor, data, observacoes, case_id, associado_id, criado_por, atualizado_por, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(uuid(), e.tipo, e.categoria, e.descricao, e.valor, c.dataRecebimento, '', id, e.associadoId || null, req.user.id, req.user.id, now, now);
      }
      status = 'lancado'; em = now;
    } else status = 'pendente';
  }
  return { status, em };
}

router.get('/', (req, res) => {
  const rows = req.user.role === 'admin' ? db.prepare(ALL).all() : db.prepare(MINE).all(req.user.partner_id);
  res.json({ cases: rows.map(caseRow) });
});

router.post('/', (req, res, next) => {
  try {
    const c = caseInput(req.body);
    if (req.user.role === 'partner') { c.titularidade = 'parceria'; c.parceiroId = req.user.partner_id; }
    if (c.titularidade === 'parceria' && !partnerById.get(c.parceiroId)) return res.status(400).json({ error: 'Parceiro inválido.' });
    const now = nowISO(), id = uuid();
    db.transaction(() => {
      const fin = settleFinance({ cur: null, c, id, req });
      db.prepare(`INSERT INTO cases (id, partner_id, titularidade, valor_acao, valor_condenacao, pct_honorarios, base_honorarios, valor_debito, valor_devido, valor_reconhecido, honorarios_iniciais, natureza, fase, resultado, numero_processo, cliente, tipo_acao, data_protocolo, honorarios_pretendidos, custo_lead, pct_parceiro, pct_nosso,
        recebido, valor_recebido, data_recebimento, data_encerramento, fluxo_recebimento, financeiro_status, financeiro_em,
        tem_corretor, nome_corretor, valor_corretor, corretor_pago, observacoes, criado_por, atualizado_por, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, c.parceiroId, c.titularidade, c.valorAcao, c.valorCondenacao, c.pctHonorarios, c.baseHonorarios, c.valorDebito, c.valorDevido, c.valorReconhecido, c.honorariosIniciais, c.natureza, c.fase, c.resultado, c.numeroProcesso, c.cliente, c.tipoAcao, c.dataProtocolo, c.honorariosPretendidos, c.custoLead, c.pctParceiro, c.pctNosso,
          c.recebido ? 1 : 0, c.valorRecebido, c.dataRecebimento, c.dataEncerramento, c.fluxoRecebimento, fin.status, fin.em,
          c.temCorretor ? 1 : 0, c.nomeCorretor, c.valorCorretor, c.corretorPago ? 1 : 0, c.observacoes, req.user.id, req.user.id, now, now);
    })();
    audit({ user: req.user, acao: 'criar_processo', entidade: 'case', entidadeId: id, detalhes: { numero: c.numeroProcesso, cliente: c.cliente, resultado: c.resultado }, ip: req.ip });
    res.status(201).json({ id, case: caseRow(ONE.get(id)) });
  } catch (e) { next(e); }
});

router.put('/:id', (req, res, next) => {
  try {
    const cur = ONE.get(req.params.id);
    if (!cur || !scoped(req, cur)) return res.status(404).json({ error: 'Processo não encontrado.' });
    const c = caseInput(req.body);
    if (req.user.role === 'partner') { c.titularidade = 'parceria'; c.parceiroId = cur.partner_id; }
    if (c.titularidade === 'parceria' && !partnerById.get(c.parceiroId)) return res.status(400).json({ error: 'Parceiro inválido.' });
    db.transaction(() => {
      const fin = settleFinance({ cur, c, id: cur.id, req });
      db.prepare(`UPDATE cases SET partner_id=?, titularidade=?, valor_acao=?, valor_condenacao=?, pct_honorarios=?, base_honorarios=?, valor_debito=?, valor_devido=?, valor_reconhecido=?, honorarios_iniciais=?, natureza=?, fase=?, resultado=?, numero_processo=?, cliente=?, tipo_acao=?, data_protocolo=?, honorarios_pretendidos=?, custo_lead=?, pct_parceiro=?, pct_nosso=?,
        recebido=?, valor_recebido=?, data_recebimento=?, data_encerramento=?, fluxo_recebimento=?, financeiro_status=?, financeiro_em=?,
        tem_corretor=?, nome_corretor=?, valor_corretor=?, corretor_pago=?, observacoes=?, atualizado_por=?, atualizado_em=? WHERE id=?`)
        .run(c.parceiroId, c.titularidade, c.valorAcao, c.valorCondenacao, c.pctHonorarios, c.baseHonorarios, c.valorDebito, c.valorDevido, c.valorReconhecido, c.honorariosIniciais, c.natureza, c.fase, c.resultado, c.numeroProcesso, c.cliente, c.tipoAcao, c.dataProtocolo, c.honorariosPretendidos, c.custoLead, c.pctParceiro, c.pctNosso,
          c.recebido ? 1 : 0, c.valorRecebido, c.dataRecebimento, c.dataEncerramento, c.fluxoRecebimento, fin.status, fin.em,
          c.temCorretor ? 1 : 0, c.nomeCorretor, c.valorCorretor, c.corretorPago ? 1 : 0, c.observacoes, req.user.id, nowISO(), cur.id);
    })();
    audit({ user: req.user, acao: 'editar_processo', entidade: 'case', entidadeId: cur.id, detalhes: { resultado: c.resultado, financeiro: req.body.lancarFinanceiro === true }, ip: req.ip });
    res.json({ case: caseRow(ONE.get(cur.id)) });
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    const cur = ONE.get(req.params.id);
    if (!cur || !scoped(req, cur)) return res.status(404).json({ error: 'Processo não encontrado.' });
    db.transaction(() => {
      db.prepare('UPDATE finance_entries SET case_id = NULL WHERE case_id = ?').run(cur.id); // lançamentos ficam, sem o vínculo
      db.prepare('DELETE FROM cases WHERE id = ?').run(cur.id);
    })();
    audit({ user: req.user, acao: 'excluir_processo', entidade: 'case', entidadeId: cur.id, detalhes: caseRow(cur), ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
