/* Compra de créditos — exclusivo da administração. */
const express = require('express');
const { db, nowISO, uuid, audit, creditRow } = require('../db');
const { requireAdmin } = require('../auth');
const { creditInput, cnj } = require('../validate');

const router = express.Router();
router.use(requireAdmin);

const ALL = 'SELECT * FROM credits ORDER BY data_compra DESC, criado_em DESC';
const ONE = db.prepare('SELECT * FROM credits WHERE id = ?');
const insFin = db.prepare(`INSERT INTO finance_entries (id, tipo, categoria, descricao, valor, data, observacoes, credit_id, criado_por, atualizado_por, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);

/* Integração com o financeiro: a compra entra como despesa e o recebimento como receita (opções do administrador).
   Deve rodar dentro da transação que grava o crédito. */
function settleFinance({ cur, c, id, req }) {
  const now = nowISO();
  let compra = cur?.financeiro_compra || 'nao', receb = cur?.financeiro_recebimento || 'nao';
  const ref = `Crédito — processo ${cnj(c.numeroProcesso)}${c.cedente ? ' (' + c.cedente + ')' : ''}`;
  if (compra !== 'lancado' && req.body.lancarCompra === true) {
    insFin.run(uuid(), 'despesa', 'Compra de créditos', `${ref} — aquisição`, c.valorCompra, c.dataCompra, '', id, req.user.id, req.user.id, now, now);
    compra = 'lancado';
  }
  if (!c.recebido) {
    if (receb === 'lancado') db.prepare("DELETE FROM finance_entries WHERE credit_id = ? AND tipo = 'receita'").run(id);
    receb = 'nao';
  } else if (receb !== 'lancado' && req.body.lancarRecebimento === true) {
    insFin.run(uuid(), 'receita', 'Créditos comprados', `${ref} — recebimento`, c.valorRecebido, c.dataRecebimento, '', id, req.user.id, req.user.id, now, now);
    receb = 'lancado';
  }
  return { compra, receb };
}

router.get('/', (_req, res) => res.json({ credits: db.prepare(ALL).all().map(creditRow) }));

router.post('/', (req, res, next) => {
  try {
    const c = creditInput(req.body), now = nowISO(), id = uuid();
    db.transaction(() => {
      const fin = settleFinance({ cur: null, c, id, req });
      db.prepare(`INSERT INTO credits (id, numero_processo, cedente, data_compra, data_prevista, valor_compra, valor_receber, recebido, valor_recebido, data_recebimento, financeiro_compra, financeiro_recebimento, observacoes, criado_por, atualizado_por, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, c.numeroProcesso, c.cedente, c.dataCompra, c.dataPrevista, c.valorCompra, c.valorReceber, c.recebido ? 1 : 0, c.valorRecebido, c.dataRecebimento, fin.compra, fin.receb, c.observacoes, req.user.id, req.user.id, now, now);
    })();
    audit({ user: req.user, acao: 'criar_credito', entidade: 'credit', entidadeId: id, detalhes: { numero: c.numeroProcesso, valorCompra: c.valorCompra }, ip: req.ip });
    res.status(201).json({ id, credit: creditRow(ONE.get(id)) });
  } catch (e) { next(e); }
});

router.put('/:id', (req, res, next) => {
  try {
    const cur = ONE.get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Crédito não encontrado.' });
    const c = creditInput(req.body);
    db.transaction(() => {
      const fin = settleFinance({ cur, c, id: cur.id, req });
      db.prepare(`UPDATE credits SET numero_processo=?, cedente=?, data_compra=?, data_prevista=?, valor_compra=?, valor_receber=?, recebido=?, valor_recebido=?, data_recebimento=?, financeiro_compra=?, financeiro_recebimento=?, observacoes=?, atualizado_por=?, atualizado_em=? WHERE id=?`)
        .run(c.numeroProcesso, c.cedente, c.dataCompra, c.dataPrevista, c.valorCompra, c.valorReceber, c.recebido ? 1 : 0, c.valorRecebido, c.dataRecebimento, fin.compra, fin.receb, c.observacoes, req.user.id, nowISO(), cur.id);
    })();
    audit({ user: req.user, acao: 'editar_credito', entidade: 'credit', entidadeId: cur.id, ip: req.ip });
    res.json({ credit: creditRow(ONE.get(cur.id)) });
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    const cur = ONE.get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Crédito não encontrado.' });
    db.transaction(() => {
      db.prepare('UPDATE finance_entries SET credit_id = NULL WHERE credit_id = ?').run(cur.id);
      db.prepare('DELETE FROM credits WHERE id = ?').run(cur.id);
    })();
    audit({ user: req.user, acao: 'excluir_credito', entidade: 'credit', entidadeId: cur.id, detalhes: creditRow(cur), ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
