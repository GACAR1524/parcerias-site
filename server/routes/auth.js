const express = require('express');
const rateLimit = require('express-rate-limit');
const { db, nowISO, uuid, audit } = require('../db');
const { hash, verify, setSessionCookie, clearSessionCookie, requireAuth, sessionFromUser } = require('../auth');
const { username, password } = require('../validate');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' } });

const hasAdmin = () => !!db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
const findUser = db.prepare(`SELECT u.*, p.nome AS partner_nome, p.ativo AS partner_ativo, p.tipo AS partner_tipo FROM users u LEFT JOIN partners p ON p.id = u.partner_id WHERE u.usuario = ?`);

/* Estado da sessão + se o sistema já foi configurado (existe administrador) */
router.get('/session', (req, res) => {
  res.json({ configured: hasAdmin(), session: req.user ? sessionFromUser(req.user) : null });
});

/* Primeiro acesso: cria o administrador. Só funciona enquanto não existir nenhum. */
router.post('/setup', loginLimiter, async (req, res, next) => {
  try {
    if (hasAdmin()) return res.status(409).json({ error: 'O sistema já foi configurado. Para redefinir a senha do administrador use o comando "npm run admin -- reset <usuario>" no servidor.' });
    const u = username(req.body.usuario), p = password(req.body.senha, 8);
    const now = nowISO(), id = uuid();
    db.prepare('INSERT INTO users (id, usuario, senha_hash, role, ativo, criado_em, atualizado_em) VALUES (?,?,?,?,1,?,?)').run(id, u, await hash(p), 'admin', now, now);
    const user = findUser.get(u);
    audit({ user, acao: 'setup_admin', entidade: 'user', entidadeId: id, ip: req.ip });
    setSessionCookie(res, user, true);
    res.json({ session: sessionFromUser(user) });
  } catch (e) { next(e); }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const u = String(req.body.usuario || '').trim().toLowerCase();
    const user = u ? findUser.get(u) : null;
    const ok = user && await verify(req.body.senha, user.senha_hash);
    if (!ok) { audit({ acao: 'login_falhou', entidade: 'user', detalhes: { usuario: u }, ip: req.ip }); return res.status(401).json({ error: 'Usuário ou senha incorretos.' }); }
    if (!user.ativo || (user.role === 'partner' && !user.partner_ativo)) return res.status(401).json({ error: 'Este acesso foi desativado. Fale com o escritório Costa de Araújo.' });
    setSessionCookie(res, user, !!req.body.lembrar);
    audit({ user, acao: 'login', entidade: 'user', entidadeId: user.id, ip: req.ip });
    res.json({ session: sessionFromUser(user) });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => { clearSessionCookie(res); res.json({ ok: true }); });

router.post('/password', requireAuth, async (req, res, next) => {
  try {
    if (!await verify(req.body.senhaAtual, req.user.senha_hash)) return res.status(400).json({ error: 'A senha atual não confere.' });
    const p = password(req.body.novaSenha, 8);
    db.prepare('UPDATE users SET senha_hash = ?, atualizado_em = ? WHERE id = ?').run(await hash(p), nowISO(), req.user.id);
    audit({ user: req.user, acao: 'troca_senha', entidade: 'user', entidadeId: req.user.id, ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
