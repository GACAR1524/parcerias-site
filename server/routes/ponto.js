/*
 * Controle de ponto — advogados associados e estagiários batem; a administração valida e consulta.
 *
 * Prova de presença (método "cerca virtual + rede do escritório"):
 *   - rede_ok: o IP de origem está entre os IPs autorizados (internet do escritório);
 *   - gps_ok : a posição enviada pelo aparelho está dentro do raio configurado em torno do escritório.
 *   Batida válida = rede_ok OU gps_ok. Fora disso ela NÃO é recusada: fica "pendente" para a administração decidir.
 *   Se nada estiver configurado (nem IP nem coordenadas), a batida vale sem prova (status 'valido') e a tela avisa.
 * O horário gravado é sempre o do servidor, no fuso do escritório.
 */
const express = require('express');
const { db, nowISO, uuid, audit, timeRow, getSetting, setSetting } = require('../db');
const { requireAuth, requireAdmin, requireEmployee } = require('../auth');
const { pontoConfigInput, punchInput, adjustInput } = require('../validate');

const router = express.Router();
router.use(requireAuth);

const DEFAULTS = { endereco: '', lat: null, lng: null, raioM: 150, ips: [], toleranciaMin: 20, exigirProva: true, fuso: 'America/Fortaleza' };
const cfg = () => ({ ...DEFAULTS, ...(getSetting('ponto', {}) || {}) });
const publicCfg = c => ({ endereco: c.endereco, lat: c.lat, lng: c.lng, raioM: c.raioM, toleranciaMin: c.toleranciaMin, exigirProva: c.exigirProva, fuso: c.fuso, temRede: c.ips.length > 0, configurado: c.lat != null || c.ips.length > 0 });

/* Data e hora atuais no fuso do escritório. */
function officeNow(fuso) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date()).map(p => [p.type, p.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return { data: `${parts.year}-${parts.month}-${parts.day}`, hora: `${hour}:${parts.minute}:${parts.second}` };
}
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const clientIp = req => String(req.ip || '').replace(/^::ffff:/, '');
const ipMatches = (ip, list) => list.some(x => x.endsWith('*') ? ip.startsWith(x.slice(0, -1)) : x === ip);

const ONE = db.prepare('SELECT * FROM time_entries WHERE id = ?');
const INS = db.prepare(`INSERT INTO time_entries (id, partner_id, tipo, data, hora, registrado_em, origem, status, lat, lng, precisao, distancia_m, ip, rede_ok, gps_ok, justificativa, decidido_por, decidido_em, observacao, criado_em)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const partnerById = db.prepare('SELECT id, nome, tipo, ativo FROM partners WHERE id = ?');
const sameDay = db.prepare("SELECT 1 FROM time_entries WHERE partner_id = ? AND data = ? AND tipo = ? AND status IN ('valido','aprovado','pendente') LIMIT 1");

/* Período padrão das consultas: do 1º dia do mês anterior em diante (o resto é buscado sob demanda). */
function defaultRange(fuso) {
  const { data } = officeNow(fuso); const [y, m] = data.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return { de: d.toISOString().slice(0, 10), ate: '9999-12-31' };
}
function listEntries({ partnerId, de, ate }) {
  const sql = `SELECT * FROM time_entries WHERE data >= ? AND data <= ?${partnerId ? ' AND partner_id = ?' : ''} ORDER BY data, hora, criado_em`;
  const args = partnerId ? [de, ate, partnerId] : [de, ate];
  return db.prepare(sql).all(...args).map(timeRow);
}

/* ---- configuração (administração) ---- */
router.get('/config', requireAdmin, (req, res) => res.json({ config: cfg(), meuIp: clientIp(req) }));
router.put('/config', requireAdmin, (req, res, next) => {
  try {
    const c = pontoConfigInput(req.body);
    setSetting('ponto', c);
    audit({ user: req.user, acao: 'configurar_ponto', entidade: 'settings', entidadeId: 'ponto', detalhes: { raioM: c.raioM, ips: c.ips.length, lat: c.lat != null }, ip: req.ip });
    res.json({ config: c });
  } catch (e) { next(e); }
});
router.get('/meu-ip', (req, res) => res.json({ ip: clientIp(req) }));

/* ---- consulta ---- */
router.get('/', (req, res, next) => {
  try {
    const c = cfg(), r = defaultRange(c.fuso);
    const de = /^\d{4}-\d{2}-\d{2}$/.test(req.query.de || '') ? req.query.de : (/^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes + '-01' : r.de);
    const ate = /^\d{4}-\d{2}-\d{2}$/.test(req.query.ate || '') ? req.query.ate : (/^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes + '-31' : r.ate);
    const partnerId = req.user.role === 'admin' ? (req.query.partnerId || null) : req.user.partner_id;
    if (req.user.role !== 'admin' && !['associado', 'estagiario'].includes(req.user.partner_tipo)) return res.status(403).json({ error: 'Sem acesso ao ponto.' });
    res.json({ ponto: listEntries({ partnerId, de, ate }), config: req.user.role === 'admin' ? cfg() : publicCfg(c) });
  } catch (e) { next(e); }
});

/* ---- bater ponto (associado/estagiário) ---- */
router.post('/', requireEmployee, (req, res, next) => {
  try {
    const b = punchInput(req.body), c = cfg(), now = officeNow(c.fuso), ip = clientIp(req);
    if (sameDay.get(req.user.partner_id, now.data, b.tipo)) return res.status(400).json({ error: `Você já registrou ${b.tipo === 'entrada' ? 'a entrada' : b.tipo === 'volta' ? 'a volta do almoço' : 'a saída'} hoje.` });
    const redeOk = c.ips.length > 0 && ipMatches(ip, c.ips);
    let dist = null, gpsOk = false;
    if (c.lat != null && b.lat != null) { dist = Math.round(haversine(c.lat, c.lng, b.lat, b.lng)); gpsOk = dist <= c.raioM + Math.min(b.precisao || 0, 50); }
    const configurado = c.lat != null || c.ips.length > 0;
    const status = !c.exigirProva || !configurado || redeOk || gpsOk ? 'valido' : 'pendente';
    const id = uuid(), ts = nowISO();
    INS.run(id, req.user.partner_id, b.tipo, now.data, now.hora, ts, 'app', status, b.lat, b.lng, b.precisao, dist, ip, redeOk ? 1 : 0, gpsOk ? 1 : 0, '', null, null, configurado ? '' : 'sem validação configurada', ts);
    audit({ user: req.user, acao: 'bater_ponto', entidade: 'time_entry', entidadeId: id, detalhes: { tipo: b.tipo, status, redeOk, gpsOk, dist }, ip: req.ip });
    res.status(201).json({ id, entry: timeRow(ONE.get(id)), avaliacao: { redeOk, gpsOk, distanciaM: dist, status, configurado, hora: now.hora.slice(0, 5) } });
  } catch (e) { next(e); }
});

/* ---- pedido de ajuste (esqueci de bater) ---- */
router.post('/ajuste', requireEmployee, (req, res, next) => {
  try {
    const a = adjustInput(req.body), ts = nowISO(), id = uuid();
    INS.run(id, req.user.partner_id, a.tipo, a.data, a.hora, ts, 'ajuste', 'pendente', null, null, null, null, clientIp(req), 0, 0, a.justificativa, null, null, '', ts);
    audit({ user: req.user, acao: 'pedir_ajuste_ponto', entidade: 'time_entry', entidadeId: id, detalhes: { tipo: a.tipo, data: a.data, hora: a.hora }, ip: req.ip });
    res.status(201).json({ id, entry: timeRow(ONE.get(id)) });
  } catch (e) { next(e); }
});

/* ---- administração: batida manual, decisão e exclusão ---- */
router.post('/manual', requireAdmin, (req, res, next) => {
  try {
    const a = adjustInput(req.body, { admin: true });
    const p = partnerById.get(a.partnerId);
    if (!p || !['associado', 'estagiario'].includes(p.tipo)) return res.status(400).json({ error: 'Selecione um associado ou estagiário.' });
    const ts = nowISO(), id = uuid();
    INS.run(id, p.id, a.tipo, a.data, a.hora, ts, 'manual', 'aprovado', null, null, null, null, clientIp(req), 0, 0, '', req.user.id, ts, a.justificativa, ts);
    audit({ user: req.user, acao: 'batida_manual', entidade: 'time_entry', entidadeId: id, detalhes: { partnerId: p.id, tipo: a.tipo, data: a.data, hora: a.hora }, ip: req.ip });
    res.status(201).json({ id, entry: timeRow(ONE.get(id)) });
  } catch (e) { next(e); }
});
router.post('/:id/decisao', requireAdmin, (req, res, next) => {
  try {
    const cur = ONE.get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Registro não encontrado.' });
    const decisao = String(req.body.decisao || '').toLowerCase();
    if (decisao !== 'aprovado' && decisao !== 'recusado') return res.status(400).json({ error: 'Decisão inválida.' });
    db.prepare('UPDATE time_entries SET status = ?, decidido_por = ?, decidido_em = ?, observacao = ? WHERE id = ?').run(decisao, req.user.id, nowISO(), String(req.body.observacao || '').slice(0, 500), cur.id);
    audit({ user: req.user, acao: 'decidir_ponto', entidade: 'time_entry', entidadeId: cur.id, detalhes: { decisao }, ip: req.ip });
    res.json({ entry: timeRow(ONE.get(cur.id)) });
  } catch (e) { next(e); }
});
router.delete('/:id', requireAdmin, (req, res, next) => {
  try {
    const cur = ONE.get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Registro não encontrado.' });
    db.prepare('DELETE FROM time_entries WHERE id = ?').run(cur.id);
    audit({ user: req.user, acao: 'excluir_ponto', entidade: 'time_entry', entidadeId: cur.id, detalhes: timeRow(cur), ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.cfg = cfg;
module.exports.publicCfg = publicCfg;
module.exports.defaultRange = defaultRange;
module.exports.listEntries = listEntries;
module.exports.redeOk = req => { const c = cfg(); return c.ips.length > 0 && ipMatches(clientIp(req), c.ips); };
