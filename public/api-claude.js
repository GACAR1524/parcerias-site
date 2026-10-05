/*
 * Adaptador de dados — versão ARTIFACT (banco de dados do Claude).
 * Mesmo contrato de api-rest.js (veja o cabeçalho daquele arquivo).
 *
 * Diferenças em relação ao site:
 *  - a autenticação é feita no navegador: as senhas ficam guardadas como hash
 *    PBKDF2-SHA256 (150 mil iterações, salt aleatório) nos documentos do banco;
 *  - só o proprietário do artifact grava em `config` e `partners`, e só ele lê e grava
 *    em `credits`, `finance` e `contracts` (regras do db declaradas na publicação);
 *  - a sessão fica no navegador (localStorage/sessionStorage) por conveniência.
 */
(() => {
  'use strict';
  const SKEY = 'ca_parcerias_sessao';
  const toHex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  const randomHex = n => toHex(crypto.getRandomValues(new Uint8Array(n)));
  async function hashPassword(pw, saltHex) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(String(pw)), 'PBKDF2', false, ['deriveBits']);
    const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150000 }, key, 256);
    return toHex(bits);
  }
  const normUser = u => String(u ?? '').trim().toLowerCase().replace(/\s+/g, '.');
  function loadSession() { try { return JSON.parse(localStorage.getItem(SKEY) || sessionStorage.getItem(SKEY) || 'null'); } catch { return null; } }
  function saveSession(s, remember) { try { localStorage.removeItem(SKEY); sessionStorage.removeItem(SKEY); (remember ? localStorage : sessionStorage).setItem(SKEY, JSON.stringify(s)); } catch {} }
  function clearSession() { try { localStorage.removeItem(SKEY); sessionStorage.removeItem(SKEY); } catch {} }

  const st = { db: null, user: null, downloads: null, isOwner: false, config: null, pontoConfig: null, session: null, unsubs: [], extraPonto: [] };
  const wrap = err => {
    const e = new Error(err?.message || String(err));
    e.code = err?.code === 'invalid_argument' ? 'read_only' : err?.code === 'quota_exceeded' ? 'quota' : err?.code === 'resource_exhausted' ? 'rate' : 'unknown';
    e.raw = err; return e;
  };
  const guard = p => p.catch(err => { throw wrap(err); });

  async function validateSession(s) {
    try {
      if (s.role === 'admin') return s.usuario === st.config.adminUser;
      if (s.role === 'partner' && s.partnerId) { const d = await st.db.doc('partners/' + s.partnerId).get(); return d.exists && d.data().ativo !== false; }
    } catch {}
    return false;
  }

  /* ---- ponto (versão artifact: só GPS; horário do aparelho) ---- */
  const PONTO_DEFAULTS = { endereco: '', lat: null, lng: null, raioM: 150, ips: [], toleranciaMin: 20, exigirProva: true, fuso: 'America/Fortaleza' };
  const pontoCfg = () => ({ ...PONTO_DEFAULTS, ...(st.pontoConfig || {}) });
  const publicCfg = c => ({ endereco: c.endereco, lat: c.lat, lng: c.lng, raioM: c.raioM, toleranciaMin: c.toleranciaMin, exigirProva: c.exigirProva, fuso: c.fuso, temRede: false, configurado: c.lat != null });
  function haversine(lat1, lng1, lat2, lng2) { const R = 6371000, r = d => d * Math.PI / 180; const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(a)); }
  function officeNow(fuso) {
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date()).map(p => [p.type, p.value]));
      return { data: `${parts.year}-${parts.month}-${parts.day}`, hora: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}:${parts.second}` };
    } catch { const d = new Date(), z = n => String(n).padStart(2, '0'); return { data: `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`, hora: `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}` }; }
  }
  const firstOfPrevMonth = () => { const d = new Date(); const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear(), m = d.getMonth() === 0 ? 12 : d.getMonth(); return `${y}-${String(m).padStart(2, '0')}-01`; };
  const mapDoc = d => ({ id: d.id, ...d.data() });

  window.ParceriasAPI = {
    mode: 'claude',
    features: { export: false, changePassword: false, ip: false, serverClock: false, backup: false },

    async init() {
      if (typeof window.claude?.use !== 'function') return { ok: false, message: 'Abra o sistema pelo link do Claude para conectar ao banco de dados.' };
      const [db, user, downloads] = await Promise.all([window.claude.use('db'), window.claude.use('user'), window.claude.use('downloads')]);
      st.db = db; st.user = user; st.downloads = downloads; this.features.export = !!downloads;
      if (!db) return { ok: false, message: 'Sem acesso ao banco de dados. Entre na sua conta Claude com o e-mail convidado pelo escritório e recarregue a página.' };
      st.isOwner = (await user?.isOwner?.()) ?? false;
      const cw = await user?.can?.('data.write');
      try { const snap = await db.doc('config/settings').get(); st.config = snap.exists ? snap.data() : null; }
      catch (e) { return { ok: false, message: 'Falha ao ler a configuração: ' + (e?.message || e) }; }
      try { const ps = await db.doc('config/ponto').get(); st.pontoConfig = ps.exists ? ps.data() : null; } catch { st.pontoConfig = null; }
      let session = null;
      if (st.config) { const saved = loadSession(); if (saved && await validateSession(saved)) session = saved; else clearSession(); }
      st.session = session;
      return { ok: true, configured: !!st.config, canSetup: st.isOwner, canResetAdmin: st.isOwner && !!st.config, session, canWrite: cw !== false };
    },

    async login(usuario, senha, lembrar) {
      const u = normUser(usuario);
      let sess = null;
      if (st.config && u === st.config.adminUser) {
        const h = await hashPassword(senha, st.config.adminSalt);
        if (h !== st.config.adminHash) throw new Error('Usuário ou senha incorretos.');
        sess = { role: 'admin', tipo: 'admin', usuario: u, nome: 'Administração' };
      } else {
        const snap = await guard(st.db.collection('partners').where('usuario', '==', u).limit(1).get());
        if (snap.empty) throw new Error('Usuário ou senha incorretos.');
        const doc = snap.docs[0], d = doc.data();
        const h = await hashPassword(senha, d.salt);
        if (h !== d.hash) throw new Error('Usuário ou senha incorretos.');
        if (d.ativo === false) throw new Error('Este acesso foi desativado. Fale com o escritório Costa de Araújo.');
        sess = { role: 'partner', tipo: d.tipo || 'parceiro', partnerId: doc.id, usuario: u, nome: d.nome };
      }
      st.session = sess; saveSession(sess, lembrar); return sess;
    },
    async logout() { st.unsubs.forEach(u => { try { u(); } catch {} }); st.unsubs = []; clearSession(); st.session = null; },

    async setupAdmin(usuario, senha) {
      const u = normUser(usuario), salt = randomHex(16), hash = await hashPassword(senha, salt);
      const data = { adminUser: u, adminSalt: salt, adminHash: hash, criadoEm: st.config?.criadoEm || new Date().toISOString(), atualizadoEm: new Date().toISOString() };
      await guard(st.db.doc('config/settings').set(data));
      st.config = data;
      const sess = { role: 'admin', tipo: 'admin', usuario: u, nome: 'Administração' };
      st.session = sess; saveSession(sess, true); return sess;
    },
    async changePassword() { throw new Error('Nesta versão, a troca de senha é feita pelo escritório.'); },

    subscribe(onData) {
      const s = st.session; if (!s) return () => {};
      const data = { partners: [], cases: [], credits: [], finance: [], contracts: [], ponto: [], pontoConfig: s.role === 'admin' ? pontoCfg() : publicCfg(pontoCfg()), loaded: false };
      let gotP = false, gotC = false;
      const tipo = s.tipo || 'parceiro', employee = tipo === 'associado' || tipo === 'estagiario';
      const emit = () => { data.loaded = gotP && gotC; onData({ ...data }); };
      const onErr = e => { if (e?.code === 'revoked') onData({ ...data, sessionLost: true }); else console.error(e); };
      const unsubs = [];
      if (s.role === 'admin') {
        unsubs.push(st.db.collection('partners').onSnapshot(q => { data.partners = q.docs.map(d => ({ id: d.id, ...d.data() })); gotP = true; emit(); }, onErr));
        unsubs.push(st.db.collection('cases').onSnapshot(q => { data.cases = q.docs.map(d => ({ id: d.id, ...d.data() })); gotC = true; emit(); }, onErr));
        unsubs.push(st.db.collection('credits').onSnapshot(q => { data.credits = q.docs.map(d => ({ id: d.id, ...d.data() })); emit(); }, onErr));
        unsubs.push(st.db.collection('finance').onSnapshot(q => { data.finance = q.docs.map(d => ({ id: d.id, ...d.data() })); emit(); }, onErr));
        unsubs.push(st.db.collection('contracts').onSnapshot(q => { data.contracts = q.docs.map(d => ({ id: d.id, ...d.data() })); emit(); }, onErr));
        unsubs.push(st.db.doc('config/ponto').onSnapshot(d => { st.pontoConfig = d.exists ? d.data() : null; data.pontoConfig = pontoCfg(); emit(); }, onErr));
        unsubs.push(this._subPonto(st.db.collection('ponto'), q => { data.ponto = q.docs.map(mapDoc).concat(st.extraPonto.filter(e => !q.docs.some(d => d.id === e.id))); emit(); }, onErr));
      } else {
        unsubs.push(st.db.doc('partners/' + s.partnerId).onSnapshot(d => {
          if (!d.exists || d.data().ativo === false) { onData({ ...data, sessionLost: true }); return; }
          data.partners = [{ id: d.id, ...d.data() }]; gotP = true; emit();
        }, onErr));
        if (tipo === 'estagiario') { gotC = true; }
        else unsubs.push(st.db.collection('cases').where('parceiroId', '==', s.partnerId).onSnapshot(q => { data.cases = q.docs.map(d => ({ id: d.id, ...d.data() })); gotC = true; emit(); }, onErr));
        if (employee) {
          unsubs.push(st.db.doc('config/ponto').onSnapshot(d => { st.pontoConfig = d.exists ? d.data() : null; data.pontoConfig = publicCfg(pontoCfg()); emit(); }, onErr));
          unsubs.push(this._subPonto(st.db.collection('ponto').where('partnerId', '==', s.partnerId), q => { data.ponto = q.docs.map(mapDoc).concat(st.extraPonto.filter(e => !q.docs.some(d => d.id === e.id))); emit(); }, onErr));
        }
      }
      st.unsubs.push(...unsubs);
      return () => unsubs.forEach(u => { try { u(); } catch {} });
    },

    /* Situação financeira do processo: 'nao' | 'pendente' (recebido, aguardando o escritório) | 'lancado'.
       Só o administrador grava em `finance`; o parceiro deixa como pendente. */
    async createCase(d, opts = {}) {
      const now = new Date().toISOString(), admin = st.session.role === 'admin';
      const fin = d.resultado === 'recebido' ? 'pendente' : 'nao';
      const ref = await guard(st.db.collection('cases').add({ ...d, financeiroStatus: fin, financeiroEm: null, criadoPor: admin ? 'admin' : st.session.partnerId, criadoEm: now, atualizadoEm: now }));
      if (admin && d.resultado === 'recebido' && opts.lancarFinanceiro && opts.lancamentos?.length) await this._postFinance(ref.id, opts.lancamentos);
      return { id: ref.id };
    },
    async updateCase(id, d, opts = {}) {
      const now = new Date().toISOString(), admin = st.session.role === 'admin';
      const patch = { ...d, atualizadoEm: now, atualizadoPor: admin ? 'admin' : st.session.partnerId };
      const prev = opts.statusAtual || 'nao';
      if (d.resultado !== 'recebido') {
        if (prev === 'lancado' && admin) { const q = await guard(st.db.collection('finance').where('caseId', '==', id).get()); for (const doc of q.docs) await guard(st.db.doc('finance/' + doc.id).delete()); }
        patch.financeiroStatus = 'nao'; patch.financeiroEm = null;
      } else if (prev !== 'lancado') patch.financeiroStatus = 'pendente';
      await guard(st.db.doc('cases/' + id).update(patch));
      if (admin && d.resultado === 'recebido' && prev !== 'lancado' && opts.lancarFinanceiro && opts.lancamentos?.length) await this._postFinance(id, opts.lancamentos);
    },
    async _postFinance(caseId, lancamentos) {
      const now = new Date().toISOString();
      for (const e of lancamentos) await guard(st.db.collection('finance').add({ ...e, caseId, observacoes: e.observacoes || '', criadoEm: now, atualizadoEm: now }));
      await guard(st.db.doc('cases/' + caseId).update({ financeiroStatus: 'lancado', financeiroEm: now }));
    },
    async deleteCase(id) { await guard(st.db.doc('cases/' + id).delete()); },

    async createPartner(d, senha) {
      const salt = randomHex(16), hash = await hashPassword(senha, salt), now = new Date().toISOString();
      const ref = await guard(st.db.collection('partners').add({ ...d, usuario: normUser(d.usuario), salt, hash, ativo: true, criadoEm: now, atualizadoEm: now }));
      return { id: ref.id };
    },
    async updatePartner(id, d) { await guard(st.db.doc('partners/' + id).update({ ...d, usuario: normUser(d.usuario), atualizadoEm: new Date().toISOString() })); },
    async setPartnerPassword(id, senha) { const salt = randomHex(16), hash = await hashPassword(senha, salt); await guard(st.db.doc('partners/' + id).update({ salt, hash, atualizadoEm: new Date().toISOString() })); },
    async setPartnerActive(id, ativo) { await guard(st.db.doc('partners/' + id).update({ ativo: !!ativo, atualizadoEm: new Date().toISOString() })); },

    /* Créditos: a compra pode entrar como despesa e o recebimento como receita no financeiro (opts.lancamentos vem da tela). */
    async createCredit(d, opts = {}) {
      const now = new Date().toISOString();
      const ref = await guard(st.db.collection('credits').add({ ...d, financeiroCompra: 'nao', financeiroRecebimento: 'nao', criadoEm: now, atualizadoEm: now }));
      await this._settleCredit(ref.id, d, { ...opts, statusCompra: 'nao', statusRecebimento: 'nao' });
      return { id: ref.id };
    },
    async updateCredit(id, d, opts = {}) {
      await guard(st.db.doc('credits/' + id).update({ ...d, atualizadoEm: new Date().toISOString() }));
      await this._settleCredit(id, d, opts);
    },
    async _settleCredit(id, d, opts) {
      const now = new Date().toISOString(), patch = {};
      let compra = opts.statusCompra || 'nao', receb = opts.statusRecebimento || 'nao';
      if (compra !== 'lancado' && opts.lancarCompra && opts.lancamentos?.compra) { await guard(st.db.collection('finance').add({ ...opts.lancamentos.compra, creditId: id, observacoes: '', criadoEm: now, atualizadoEm: now })); patch.financeiroCompra = 'lancado'; }
      if (!d.recebido) {
        if (receb === 'lancado') { const q = await guard(st.db.collection('finance').where('creditId', '==', id).get()); for (const doc of q.docs) if (doc.data().tipo === 'receita') await guard(st.db.doc('finance/' + doc.id).delete()); }
        if (receb !== 'nao') patch.financeiroRecebimento = 'nao';
      } else if (receb !== 'lancado' && opts.lancarRecebimento && opts.lancamentos?.recebimento) { await guard(st.db.collection('finance').add({ ...opts.lancamentos.recebimento, creditId: id, observacoes: '', criadoEm: now, atualizadoEm: now })); patch.financeiroRecebimento = 'lancado'; }
      if (Object.keys(patch).length) await guard(st.db.doc('credits/' + id).update(patch));
    },
    async deleteCredit(id) { await guard(st.db.doc('credits/' + id).delete()); },

    /* Assina só o período recente (do mês anterior em diante); se o banco não aceitar o filtro por intervalo, assina tudo. */
    _subPonto(col, cb, onErr) {
      let un = null, fallen = false;
      const fallback = () => { if (fallen) return; fallen = true; try { un && un(); } catch {} un = col.onSnapshot(cb, onErr); };
      try { un = col.where('data', '>=', firstOfPrevMonth()).onSnapshot(cb, e => { if (!fallen) fallback(); else onErr(e); }); } catch { fallback(); }
      return () => { try { un && un(); } catch {} };
    },
    async punch(d) {
      const c = pontoCfg(), now = officeNow(c.fuso), s = st.session;
      if (!s || s.role !== 'partner' || !['associado', 'estagiario'].includes(s.tipo)) throw new Error('Só advogados associados e estagiários registram ponto.');
      const dup = await guard(st.db.collection('ponto').where('partnerId', '==', s.partnerId).where('data', '==', now.data).get());
      if (dup.docs.some(x => x.data().tipo === d.tipo && x.data().status !== 'recusado')) throw new Error(`Você já registrou ${d.tipo === 'entrada' ? 'a entrada' : d.tipo === 'volta' ? 'a volta do almoço' : 'a saída'} hoje.`);
      let dist = null, gpsOk = false;
      if (c.lat != null && d.lat != null) { dist = Math.round(haversine(c.lat, c.lng, d.lat, d.lng)); gpsOk = dist <= c.raioM + Math.min(d.precisao || 0, 50); }
      const configurado = c.lat != null;
      const status = !c.exigirProva || !configurado || gpsOk ? 'valido' : 'pendente';
      const ts = new Date().toISOString();
      const entry = { partnerId: s.partnerId, tipo: d.tipo, data: now.data, hora: now.hora, registradoEm: ts, origem: 'app', status, lat: d.lat ?? null, lng: d.lng ?? null, precisao: d.precisao ?? null, distanciaM: dist, ip: null, redeOk: false, gpsOk, justificativa: '', decididoPor: null, decididoEm: null, observacao: configurado ? 'horário do aparelho' : 'sem validação configurada · horário do aparelho', criadoEm: ts };
      const ref = await guard(st.db.collection('ponto').add(entry));
      return { id: ref.id, entry: { id: ref.id, ...entry }, avaliacao: { redeOk: false, gpsOk, distanciaM: dist, status, configurado, hora: now.hora.slice(0, 5) } };
    },
    async requestAdjust(d) {
      const s = st.session, ts = new Date().toISOString();
      const entry = { partnerId: s.partnerId, tipo: d.tipo, data: d.data, hora: d.hora.length === 5 ? d.hora + ':00' : d.hora, registradoEm: ts, origem: 'ajuste', status: 'pendente', lat: null, lng: null, precisao: null, distanciaM: null, ip: null, redeOk: false, gpsOk: false, justificativa: d.justificativa || '', decididoPor: null, decididoEm: null, observacao: '', criadoEm: ts };
      const ref = await guard(st.db.collection('ponto').add(entry)); return { id: ref.id, entry: { id: ref.id, ...entry } };
    },
    async manualPunch(d) {
      const ts = new Date().toISOString();
      const entry = { partnerId: d.partnerId, tipo: d.tipo, data: d.data, hora: d.hora.length === 5 ? d.hora + ':00' : d.hora, registradoEm: ts, origem: 'manual', status: 'aprovado', lat: null, lng: null, precisao: null, distanciaM: null, ip: null, redeOk: false, gpsOk: false, justificativa: '', decididoPor: 'admin', decididoEm: ts, observacao: d.observacao || '', criadoEm: ts };
      const ref = await guard(st.db.collection('ponto').add(entry)); return { id: ref.id, entry: { id: ref.id, ...entry } };
    },
    async decidePunch(id, decisao, observacao) { await guard(st.db.doc('ponto/' + id).update({ status: decisao, decididoPor: 'admin', decididoEm: new Date().toISOString(), observacao: observacao || '' })); },
    async deletePunch(id) { await guard(st.db.doc('ponto/' + id).delete()); },
    async loadPonto(de, ate) {
      const s = st.session; let q = st.db.collection('ponto');
      if (s.role !== 'admin') q = q.where('partnerId', '==', s.partnerId);
      let docs;
      try { docs = (await guard(q.where('data', '>=', de).where('data', '<=', ate).get())).docs; }
      catch { docs = (await guard(q.get())).docs.filter(d => d.data().data >= de && d.data().data <= ate); }
      const list = docs.map(mapDoc);
      st.extraPonto = st.extraPonto.filter(e => !list.some(x => x.id === e.id)).concat(list);
      return list;
    },
    async getPontoConfig() { return { config: pontoCfg(), meuIp: null }; },
    async savePontoConfig(c) { const data = { ...PONTO_DEFAULTS, ...c, ips: [], atualizadoEm: new Date().toISOString() }; await guard(st.db.doc('config/ponto').set(data)); st.pontoConfig = data; return { config: data }; },
    async myIp() { return null; },

    async createContract(d) { const now = new Date().toISOString(); const ref = await guard(st.db.collection('contracts').add({ ...d, criadoEm: now, atualizadoEm: now })); return { id: ref.id }; },
    async updateContract(id, d) { await guard(st.db.doc('contracts/' + id).update({ ...d, atualizadoEm: new Date().toISOString() })); },
    async deleteContract(id) { await guard(st.db.doc('contracts/' + id).delete()); },

    async createFinance(d) { const now = new Date().toISOString(); const ref = await guard(st.db.collection('finance').add({ ...d, criadoEm: now, atualizadoEm: now })); return { id: ref.id }; },
    async updateFinance(id, d) { await guard(st.db.doc('finance/' + id).update({ ...d, atualizadoEm: new Date().toISOString() })); },
    async deleteFinance(id) { await guard(st.db.doc('finance/' + id).delete()); },

    async exportCSV(filename, csvText) {
      if (!st.downloads) throw new Error('Exportação indisponível nesta visualização.');
      try { await st.downloads.save({ filename, data: csvText }); return true; }
      catch (err) { if (err?.code === 'declined') return false; throw new Error(err?.message || 'Não foi possível exportar.'); }
    }
  };
})();
