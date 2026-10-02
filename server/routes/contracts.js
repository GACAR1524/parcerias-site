/* Contratos de prestação de serviços para empresas — exclusivo da administração.
   Os recebimentos mensais são lançamentos do financeiro (receita) com contract_id + competencia. */
const express = require('express');
const { db, nowISO, uuid, audit, contractRow } = require('../db');
const { requireAdmin } = require('../auth');
const { contractInput } = require('../validate');

const router = express.Router();
router.use(requireAdmin);

const ALL = 'SELECT * FROM contracts ORDER BY ativo DESC, empresa';
const ONE = db.prepare('SELECT * FROM contracts WHERE id = ?');

router.get('/', (_req, res) => res.json({ contracts: db.prepare(ALL).all().map(contractRow) }));

router.post('/', (req, res, next) => {
  try {
    const c = contractInput(req.body), now = nowISO(), id = uuid();
    db.prepare(`INSERT INTO contracts (id, empresa, cnpj, contato, servico, valor_mensal, dia_vencimento, data_inicio, data_fim, ativo, observacoes, criado_por, atualizado_por, criado_em, atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, c.empresa, c.cnpj, c.contato, c.servico, c.valorMensal, c.diaVencimento, c.dataInicio, c.dataFim, c.ativo ? 1 : 0, c.observacoes, req.user.id, req.user.id, now, now);
    audit({ user: req.user, acao: 'criar_contrato', entidade: 'contract', entidadeId: id, detalhes: { empresa: c.empresa, valorMensal: c.valorMensal }, ip: req.ip });
    res.status(201).json({ id, contract: contractRow(ONE.get(id)) });
  } catch (e) { next(e); }
});

router.put('/:id', (req, res, next) => {
  try {
    const cur = ONE.get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Contrato não encontrado.' });
    const c = contractInput(req.body);
    db.prepare(`UPDATE contracts SET empresa=?, cnpj=?, contato=?, servico=?, valor_mensal=?, dia_vencimento=?, data_inicio=?, data_fim=?, ativo=?, observacoes=?, atualizado_por=?, atualizado_em=? WHERE id=?`)
      .run(c.empresa, c.cnpj, c.contato, c.servico, c.valorMensal, c.diaVencimento, c.dataInicio, c.dataFim, c.ativo ? 1 : 0, c.observacoes, req.user.id, nowISO(), cur.id);
    audit({ user: req.user, acao: 'editar_contrato', entidade: 'contract', entidadeId: cur.id, ip: req.ip });
    res.json({ contract: contractRow(ONE.get(cur.id)) });
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    const cur = ONE.get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Contrato não encontrado.' });
    db.transaction(() => {
      db.prepare('UPDATE finance_entries SET contract_id = NULL WHERE contract_id = ?').run(cur.id); // receitas já recebidas permanecem
      db.prepare('DELETE FROM contracts WHERE id = ?').run(cur.id);
    })();
    audit({ user: req.user, acao: 'excluir_contrato', entidade: 'contract', entidadeId: cur.id, detalhes: contractRow(cur), ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
