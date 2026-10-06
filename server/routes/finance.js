/* Financeiro do escritório (receitas e despesas) — exclusivo da administração. */
const express = require('express');
const { db, nowISO, uuid, audit, financeRow } = require('../db');
const { requireAdmin } = require('../auth');
const { financeInput } = require('../validate');

const router = express.Router();
router.use(requireAdmin);

const ONE = db.prepare('SELECT * FROM finance_entries WHERE id = ?');

router.get('/', (req, res) => {
  const ano = String(req.query.ano || '').trim();
  const rows = /^\d{4}$/.test(ano)
    ? db.prepare("SELECT * FROM finance_entries WHERE substr(data,1,4) = ? ORDER BY data DESC, criado_em DESC").all(ano)
    : db.prepare('SELECT * FROM finance_entries ORDER BY data DESC, criado_em DESC').all();
  res.json({ finance: rows.map(financeRow) });
});

router.post('/', (req, res, next) => {
  try {
    const f = financeInput(req.body), now = nowISO(), id = uuid();
    db.prepare(`INSERT INTO finance_entries (id, tipo, categoria, descricao, valor, data, observacoes, contract_id, competencia, credit_id, associado_id, case_id, status, vencimento, parcela, grupo_id, criado_por, atualizado_por, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, f.tipo, f.categoria, f.descricao, f.valor, f.data, f.observacoes, f.contractId, f.competencia, f.creditId, f.associadoId, f.caseId, f.status, f.vencimento, f.parcela, f.grupoId, req.user.id, req.user.id, now, now);
    audit({ user: req.user, acao: 'criar_lancamento', entidade: 'finance', entidadeId: id, detalhes: { tipo: f.tipo, categoria: f.categoria, valor: f.valor, data: f.data }, ip: req.ip });
    res.status(201).json({ id, entry: financeRow(ONE.get(id)) });
  } catch (e) { next(e); }
});

/* Lote: vários lançamentos de uma vez (despesa/receita recorrente), gravados em uma única transação. */
router.post('/lote', (req, res, next) => {
  try {
    const list = Array.isArray(req.body?.lancamentos) ? req.body.lancamentos : null;
    if (!list || !list.length) return res.status(400).json({ error: 'Informe os lançamentos.' });
    if (list.length > 120) return res.status(400).json({ error: 'No máximo 120 lançamentos por vez.' });
    const items = list.map(financeInput), now = nowISO(), ids = [];
    const ins = db.prepare(`INSERT INTO finance_entries (id, tipo, categoria, descricao, valor, data, observacoes, contract_id, competencia, credit_id, associado_id, case_id, status, vencimento, parcela, grupo_id, criado_por, atualizado_por, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    db.transaction(() => {
      for (const f of items) { const id = uuid(); ids.push(id); ins.run(id, f.tipo, f.categoria, f.descricao, f.valor, f.data, f.observacoes, f.contractId, f.competencia, f.creditId, f.associadoId, f.caseId, f.status, f.vencimento, f.parcela, f.grupoId, req.user.id, req.user.id, now, now); }
    })();
    audit({ user: req.user, acao: 'criar_lancamentos_lote', entidade: 'finance', detalhes: { quantidade: items.length, tipo: items[0].tipo, categoria: items[0].categoria, grupoId: items[0].grupoId || null, de: items[0].data, ate: items[items.length - 1].data }, ip: req.ip });
    res.status(201).json({ ids, entries: ids.map(id => financeRow(ONE.get(id))) });
  } catch (e) { next(e); }
});

/* Grupo (parcelas ou recorrência): altera o valor ou exclui os lançamentos ainda não realizados do mesmo grupo, a partir de uma data. */
router.post('/grupo/:grupoId', (req, res, next) => {
  try {
    const grupoId = String(req.params.grupoId || '').slice(0, 64), acao = String(req.body?.acao || ''), desde = String(req.body?.desde || '').slice(0, 10);
    if (!grupoId || !/^\d{4}-\d{2}-\d{2}$/.test(desde)) return res.status(400).json({ error: 'Grupo ou data inválidos.' });
    const alvo = db.prepare("SELECT id FROM finance_entries WHERE grupo_id = ? AND status = 'provisionado' AND COALESCE(vencimento, data) > ?").all(grupoId, desde).map(r => r.id);
    if (acao === 'valor') {
      const valor = Number(req.body?.valor);
      if (!Number.isFinite(valor) || valor <= 0) return res.status(400).json({ error: 'Valor inválido.' });
      const upd = db.prepare('UPDATE finance_entries SET valor = ?, atualizado_por = ?, atualizado_em = ? WHERE id = ?');
      db.transaction(() => { for (const id of alvo) upd.run(Math.round(valor * 100) / 100, req.user.id, nowISO(), id); })();
      audit({ user: req.user, acao: 'alterar_valor_grupo', entidade: 'finance', detalhes: { grupoId, desde, valor, quantidade: alvo.length }, ip: req.ip });
    } else if (acao === 'excluir') {
      const del = db.prepare('DELETE FROM finance_entries WHERE id = ?');
      db.transaction(() => { for (const id of alvo) del.run(id); })();
      audit({ user: req.user, acao: 'excluir_grupo', entidade: 'finance', detalhes: { grupoId, desde, quantidade: alvo.length }, ip: req.ip });
    } else return res.status(400).json({ error: 'Ação inválida: use valor ou excluir.' });
    res.json({ ok: true, quantidade: alvo.length });
  } catch (e) { next(e); }
});

router.put('/:id', (req, res, next) => {
  try {
    const cur = ONE.get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Lançamento não encontrado.' });
    const f = financeInput(req.body);
    db.prepare(`UPDATE finance_entries SET tipo=?, categoria=?, descricao=?, valor=?, data=?, observacoes=?, contract_id=?, competencia=?, credit_id=?, associado_id=?, case_id=?, status=?, vencimento=?, parcela=?, grupo_id=?, atualizado_por=?, atualizado_em=? WHERE id=?`)
      .run(f.tipo, f.categoria, f.descricao, f.valor, f.data, f.observacoes, f.contractId ?? cur.contract_id, f.competencia ?? cur.competencia, f.creditId ?? cur.credit_id, f.associadoId ?? cur.associado_id, f.caseId ?? cur.case_id,
        f.status, f.vencimento ?? cur.vencimento, f.parcela ?? cur.parcela, f.grupoId ?? cur.grupo_id, req.user.id, nowISO(), cur.id);
    audit({ user: req.user, acao: 'editar_lancamento', entidade: 'finance', entidadeId: cur.id, ip: req.ip });
    res.json({ entry: financeRow(ONE.get(cur.id)) });
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    const cur = ONE.get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Lançamento não encontrado.' });
    db.prepare('DELETE FROM finance_entries WHERE id = ?').run(cur.id);
    audit({ user: req.user, acao: 'excluir_lancamento', entidade: 'finance', entidadeId: cur.id, detalhes: financeRow(cur), ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
