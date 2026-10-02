/*
 * Autenticação: bcrypt para senhas, JWT em cookie httpOnly para a sessão.
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('./db');

const COOKIE = 'pc_sessao';
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error('JWT_SECRET ausente ou curto demais (mínimo 32 caracteres). Defina no arquivo .env.');
  process.exit(1);
}
const SECURE = String(process.env.COOKIE_SECURE ?? 'true') !== 'false';
const REMEMBER_DAYS = Number(process.env.SESSION_DAYS || 30);

const hash = pw => bcrypt.hash(String(pw), 12);
const verify = (pw, h) => bcrypt.compare(String(pw), String(h || ''));

function setSessionCookie(res, user, remember) {
  const ttl = remember ? REMEMBER_DAYS * 86400 : 12 * 3600;
  const token = jwt.sign({ sub: user.id, role: user.role, v: 1 }, SECRET, { expiresIn: ttl });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: SECURE, path: '/', ...(remember ? { maxAge: ttl * 1000 } : {}) });
}
function clearSessionCookie(res) { res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: SECURE, path: '/' }); }

const getUser = db.prepare(`SELECT u.*, p.nome AS partner_nome, p.ativo AS partner_ativo, p.tipo AS partner_tipo FROM users u LEFT JOIN partners p ON p.id = u.partner_id WHERE u.id = ?`);
function sessionFromUser(u) {
  return { role: u.role, tipo: u.role === 'admin' ? 'admin' : (u.partner_tipo || 'parceiro'), partnerId: u.partner_id || undefined, usuario: u.usuario, nome: u.role === 'admin' ? 'Administração' : (u.partner_nome || u.usuario) };
}

/* Lê o cookie e coloca req.user (ou null). Nunca bloqueia por si só. */
function attachUser(req, _res, next) {
  req.user = null;
  const token = req.cookies?.[COOKIE];
  if (token) {
    try {
      const payload = jwt.verify(token, SECRET);
      const u = getUser.get(payload.sub);
      if (u && u.ativo && (u.role === 'admin' || u.partner_ativo)) req.user = u;
    } catch { /* token inválido ou expirado */ }
  }
  next();
}
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  next();
}
/* Quem bate ponto: advogados associados e estagiários. */
function requireEmployee(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  if (req.user.role !== 'partner' || !['associado', 'estagiario'].includes(req.user.partner_tipo)) return res.status(403).json({ error: 'Só advogados associados e estagiários registram ponto.' });
  next();
}
/* Estagiários não acessam processos. */
function denyIntern(req, res, next) {
  if (req.user && req.user.partner_tipo === 'estagiario') return res.status(403).json({ error: 'Seu acesso é só ao controle de ponto.' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Somente o administrador pode fazer isto.' });
  next();
}
/* Proteção CSRF simples: exigimos cabeçalho customizado em toda escrita (fetch same-origin). */
function requireFetchHeader(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('X-Requested-With') !== 'fetch') {
    return res.status(403).json({ error: 'Requisição inválida.' });
  }
  next();
}

module.exports = { hash, verify, setSessionCookie, clearSessionCookie, attachUser, requireAuth, requireAdmin, requireEmployee, denyIntern, requireFetchHeader, sessionFromUser, COOKIE };
