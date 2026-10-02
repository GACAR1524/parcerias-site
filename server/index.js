/*
 * Gestão geral — Costa de Araújo
 * Servidor HTTP: serve o front-end estático (public/) e a API JSON (/api).
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const compression = require('compression');

const fs = require('fs');
const os = require('os');
const { db, DB_PATH, audit, partnerRow, caseRow, creditRow, financeRow, contractRow } = require('./db');
const { attachUser, requireAuth, requireAdmin, requireFetchHeader } = require('./auth');
const { ValidationError } = require('./validate');

const app = express();
const PORT = Number(process.env.PORT || 3000);
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1)); // atrás do Caddy/Nginx

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:', 'blob:'],
      'connect-src': ["'self'"],
      'frame-ancestors': ["'none'"]
    }
  },
  referrerPolicy: { policy: 'same-origin' }
}));
app.use(compression());
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(attachUser);

/* ---------- API ---------- */
const api = express.Router();
api.use(requireFetchHeader);
api.use('/', require('./routes/auth'));
api.use('/partners', require('./routes/partners'));
api.use('/cases', require('./routes/cases'));
api.use('/credits', require('./routes/credits'));
api.use('/finance', require('./routes/finance'));
api.use('/contracts', require('./routes/contracts'));
const ponto = require('./routes/ponto');
api.use('/ponto', ponto);

/* Tudo que a tela precisa em uma chamada, já no escopo do usuário. */
api.get('/bootstrap', requireAuth, (req, res) => {
  const c = ponto.cfg(), range = ponto.defaultRange(c.fuso);
  if (req.user.role === 'admin') {
    res.json({
      partners: db.prepare('SELECT p.*, u.usuario FROM partners p LEFT JOIN users u ON u.partner_id = p.id ORDER BY p.nome').all().map(partnerRow),
      cases: db.prepare('SELECT * FROM cases ORDER BY data_protocolo DESC, criado_em DESC').all().map(caseRow),
      credits: db.prepare('SELECT * FROM credits ORDER BY data_compra DESC, criado_em DESC').all().map(creditRow),
      finance: db.prepare('SELECT * FROM finance_entries ORDER BY data DESC, criado_em DESC').all().map(financeRow),
      contracts: db.prepare('SELECT * FROM contracts ORDER BY ativo DESC, empresa').all().map(contractRow),
      ponto: ponto.listEntries({ partnerId: null, ...range }),
      pontoConfig: c
    });
  } else {
    const tipo = req.user.partner_tipo || 'parceiro', employee = tipo === 'associado' || tipo === 'estagiario';
    res.json({
      partners: [partnerRow(db.prepare('SELECT p.*, u.usuario FROM partners p LEFT JOIN users u ON u.partner_id = p.id WHERE p.id = ?').get(req.user.partner_id))].filter(Boolean),
      cases: tipo === 'estagiario' ? [] : db.prepare('SELECT * FROM cases WHERE partner_id = ? ORDER BY data_protocolo DESC, criado_em DESC').all(req.user.partner_id).map(caseRow),
      ...(employee ? { ponto: ponto.listEntries({ partnerId: req.user.partner_id, ...range }), pontoConfig: { ...ponto.publicCfg(c), redeOk: ponto.redeOk(req) } } : {})
    });
  }
});

/* Cópia de segurança do banco para o administrador baixar (consistente, mesmo com o sistema no ar). */
api.get('/backup', requireAdmin, async (req, res, next) => {
  try {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const tmp = path.join(os.tmpdir(), `parcerias-backup-${process.pid}-${Date.now()}.db`);
    await db.backup(tmp);
    audit({ user: req.user, acao: 'baixar_backup', entidade: 'db', ip: req.ip });
    res.download(tmp, `parcerias-backup-${stamp}.db`, () => { fs.unlink(tmp, () => {}); });
  } catch (e) { next(e); }
});
api.get('/health', (_req, res) => res.json({ ok: true, db: path.basename(DB_PATH), time: new Date().toISOString() }));
api.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
api.use((err, _req, res, _next) => {
  if (err instanceof ValidationError || err.status === 400) return res.status(400).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Corpo da requisição inválido.' });
  console.error(err);
  res.status(500).json({ error: 'Erro interno. Tente novamente.' });
});
app.use('/api', api);

/* ---------- front-end ---------- */
const PUBLIC = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC, { maxAge: '1h', etag: true, index: 'index.html' }));
app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

app.listen(PORT, () => console.log(`Gestão geral Costa de Araújo rodando na porta ${PORT} (banco: ${DB_PATH})`));
