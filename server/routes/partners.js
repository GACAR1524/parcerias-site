const express = require('express');
const { db, nowISO, uuid, audit, partnerRow } = require('../db');
const { hash, requireAdmin } = require('../auth');
const { partnerInput, password } = require('../validate');

const router = express.Router();
router.use(requireAdmin);

const LIST = `SELECT p.*, u.usuario FROM partners p LEFT JOIN users u ON u.partner_id = p.id ORDER BY p.nome`;
const ONE = `SELECT p.*, u.usuario FROM partners p LEFT JOIN users u ON u.partner_id = p.id WHERE p.id = ?`;
const userTaken = db.prepare('SELECT id, partner_id FROM users WHERE usuario = ?');

router.get('/', (_req, res) => res.json({ partners: db.prepare(LIST).all().map(partnerRow) }));

router.post('/', async (req, res, next) => {
  try {
    const p = partnerInput(req.body), senha = password(req.body.senha, 6);
    if (userTaken.get(p.usuario)) return res.status(400).json({ error: 'Já existe um usuário com este login.' });
    const now = nowISO(), id = uuid(), uid = uuid(), senhaHash = await hash(senha);
    db.transaction(() => {
      db.prepare('INSERT INTO partners (id, nome, escritorio, oab, email, telefone, pct_parceiro_padrao, pct_nosso_padrao, tipo, area_atuacao, especializacao, salario_fixo, pct_bonificacao_padrao, termos, curso, instituicao, supervisor, inicio_estagio, fim_estagio, bolsa, admissao, jornada, ativo, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)')
        .run(id, p.nome, p.escritorio, p.oab, p.email, p.telefone, p.pctParceiroPadrao, p.pctNossoPadrao, p.tipo, p.areaAtuacao, p.especializacao, p.salarioFixo, p.pctBonificacaoPadrao, p.termos, p.curso, p.instituicao, p.supervisor, p.inicioEstagio, p.fimEstagio, p.bolsa, p.admissao, p.jornada ? JSON.stringify(p.jornada) : null, now, now);
      db.prepare('INSERT INTO users (id, usuario, senha_hash, role, partner_id, ativo, criado_em, atualizado_em) VALUES (?,?,?,?,?,1,?,?)')
        .run(uid, p.usuario, senhaHash, 'partner', id, now, now);
    })();
    audit({ user: req.user, acao: 'criar_parceiro', entidade: 'partner', entidadeId: id, detalhes: { nome: p.nome, usuario: p.usuario, tipo: p.tipo }, ip: req.ip });
    res.status(201).json({ id, partner: partnerRow(db.prepare(ONE).get(id)) });
  } catch (e) { next(e); }
});

router.put('/:id', (req, res, next) => {
  try {
    const cur = db.prepare(ONE).get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Parceiro não encontrado.' });
    const p = partnerInput(req.body);
    const taken = userTaken.get(p.usuario);
    if (taken && taken.partner_id !== cur.id) return res.status(400).json({ error: 'Já existe um usuário com este login.' });
    const now = nowISO();
    db.transaction(() => {
      db.prepare('UPDATE partners SET nome=?, escritorio=?, oab=?, email=?, telefone=?, pct_parceiro_padrao=?, pct_nosso_padrao=?, tipo=?, area_atuacao=?, especializacao=?, salario_fixo=?, pct_bonificacao_padrao=?, termos=?, curso=?, instituicao=?, supervisor=?, inicio_estagio=?, fim_estagio=?, bolsa=?, admissao=?, jornada=?, atualizado_em=? WHERE id=?')
        .run(p.nome, p.escritorio, p.oab, p.email, p.telefone, p.pctParceiroPadrao, p.pctNossoPadrao, p.tipo, p.areaAtuacao, p.especializacao, p.salarioFixo, p.pctBonificacaoPadrao, p.termos, p.curso, p.instituicao, p.supervisor, p.inicioEstagio, p.fimEstagio, p.bolsa, p.admissao, p.jornada ? JSON.stringify(p.jornada) : null, now, cur.id);
      db.prepare('UPDATE users SET usuario=?, atualizado_em=? WHERE partner_id=?').run(p.usuario, now, cur.id);
    })();
    audit({ user: req.user, acao: 'editar_parceiro', entidade: 'partner', entidadeId: cur.id, ip: req.ip });
    res.json({ partner: partnerRow(db.prepare(ONE).get(cur.id)) });
  } catch (e) { next(e); }
});

router.post('/:id/password', async (req, res, next) => {
  try {
    const cur = db.prepare(ONE).get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Parceiro não encontrado.' });
    const senha = password(req.body.senha, 6);
    db.prepare('UPDATE users SET senha_hash=?, atualizado_em=? WHERE partner_id=?').run(await hash(senha), nowISO(), cur.id);
    audit({ user: req.user, acao: 'redefinir_senha_parceiro', entidade: 'partner', entidadeId: cur.id, ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/:id/ativo', (req, res, next) => {
  try {
    const cur = db.prepare(ONE).get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Parceiro não encontrado.' });
    const ativo = req.body.ativo ? 1 : 0, now = nowISO();
    db.transaction(() => {
      db.prepare('UPDATE partners SET ativo=?, atualizado_em=? WHERE id=?').run(ativo, now, cur.id);
      db.prepare('UPDATE users SET ativo=?, atualizado_em=? WHERE partner_id=?').run(ativo, now, cur.id);
    })();
    audit({ user: req.user, acao: ativo ? 'reativar_parceiro' : 'desativar_parceiro', entidade: 'partner', entidadeId: cur.id, ip: req.ip });
    res.json({ partner: partnerRow(db.prepare(ONE).get(cur.id)) });
  } catch (e) { next(e); }
});

module.exports = router;
