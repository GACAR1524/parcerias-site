/*
 * Adaptador de dados — versão SITE (API REST própria).
 *
 * O front-end (app.js) só conhece este contrato; a implementação pode ser
 * trocada sem tocar na interface. Existem dois adaptadores:
 *   - api-rest.js   → fala com o servidor Node/Express deste projeto (site próprio)
 *   - api-claude.js → usa o banco de dados do artifact do Claude (versão atual)
 *
 * Contrato (window.ParceriasAPI):
 *   mode: 'rest' | 'claude'
 *   features: { export: bool, changePassword: bool }
 *   init()                       → { ok, message?, configured, canSetup, canResetAdmin, session, canWrite }
 *   login(usuario, senha, lembrar) → Session   (lança Error(message) se inválido)
 *   logout()
 *   setupAdmin(usuario, senha)   → Session     (primeiro acesso / redefinição)
 *   changePassword(atual, nova)
 *   subscribe(onData)            → unsubscribe  (onData({ partners, cases, loaded }))
 *   createCase(d, opts) / updateCase(id, d, opts) / deleteCase(id)
 *       opts = { lancarFinanceiro: bool, lancamentos: [...], removerLancamentos: bool, statusAtual: 'nao'|'pendente'|'lancado' }
 *       (no site o servidor calcula os lançamentos; no artifact o adaptador usa `lancamentos` já calculados pela tela)
 *   createPartner(d, senha) / updatePartner(id, d) / setPartnerPassword(id, senha) / setPartnerActive(id, ativo)
 *   createCredit(d) / updateCredit(id, d) / deleteCredit(id)     (compra de créditos — só administração)
 *   createFinance(d) / updateFinance(id, d) / deleteFinance(id)  (financeiro do escritório — só administração)
 *   createFinanceMany([d...]) → { ids }   (lote: despesa/receita recorrente, um lançamento por mês)
 *   updateFinanceGroup(grupoId, 'valor'|'excluir', desdeISO, valor?) → { quantidade }  (meses a pagar seguintes do mesmo grupo)
 *   createContract(d) / updateContract(id, d) / deleteContract(id) (contratos com empresas — só administração)
 *   punch({ tipo, lat, lng, precisao }) → { entry, avaliacao }   (associados e estagiários)
 *   requestAdjust({ data, hora, tipo, justificativa })            (associados e estagiários)
 *   manualPunch({ partnerId, data, hora, tipo, observacao }) / decidePunch(id, decisao, observacao) / deletePunch(id)  (administração)
 *   loadPonto(de, ate) → carrega mais registros no cache (meses antigos); getPontoConfig() → { config, meuIp }; savePontoConfig(c); myIp()
 *   features.ip: true quando a checagem por rede do escritório existe (site)
 *   createCredit/updateCredit aceitam opts { lancarCompra, lancarRecebimento, lancamentos, statusCompra, statusRecebimento }
 *   exportCSV(filename, csvText) → bool
 *
 * Session = { role: 'admin' | 'partner', partnerId?: string, usuario: string, nome: string }
 * Erros de escrita chegam como Error com .code ('read_only' | 'quota' | 'rate' | 'auth' | 'validation' | 'unknown').
 */
(() => {
  'use strict';
  const POLL_MS = 20000;

  async function call(method, path, body) {
    const res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Erro ${res.status}`);
      err.code = res.status === 401 ? 'auth' : res.status === 403 ? 'read_only' : res.status === 429 ? 'rate' : res.status === 400 ? 'validation' : 'unknown';
      err.status = res.status;
      throw err;
    }
    return data;
  }

  let listeners = [];
  let cache = { partners: [], cases: [], credits: [], finance: [], contracts: [], ponto: [], pontoConfig: null, loaded: false };
  let extraPonto = []; // registros de meses antigos carregados sob demanda (fora do período do bootstrap)
  const mergePonto = (base, extra) => { const seen = new Set(base.map(e => e.id)); return base.concat(extra.filter(e => !seen.has(e.id))); };
  let timer = null;
  let loading = null;

  /* Após uma gravação, garante uma leitura iniciada DEPOIS dela (um poll em andamento traria dados antigos). */
  async function reload() {
    if (loading) { try { await loading; } catch {} }
    return load();
  }
  async function load() {
    if (loading) return loading;
    loading = call('GET', '/bootstrap').then(d => {
      cache = { partners: d.partners || [], cases: d.cases || [], credits: d.credits || [], finance: d.finance || [], contracts: d.contracts || [], ponto: mergePonto(d.ponto || [], extraPonto), pontoConfig: d.pontoConfig || null, loaded: true };
      listeners.forEach(fn => { try { fn(cache); } catch (e) { console.error(e); } });
      return cache;
    }).catch(err => {
      if (err.code === 'auth') { listeners.forEach(fn => fn({ ...cache, sessionLost: true })); }
      else console.error(err);
    }).finally(() => { loading = null; });
    return loading;
  }
  function startPolling() {
    stopPolling();
    timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
  }
  function onVisible() { if (document.visibilityState === 'visible') load(); }
  function stopPolling() { if (timer) clearInterval(timer); timer = null; document.removeEventListener('visibilitychange', onVisible); }

  window.ParceriasAPI = {
    mode: 'rest',
    features: { export: true, changePassword: true, ip: true, serverClock: true, backup: true },

    async init() {
      try {
        const d = await call('GET', '/session');
        return { ok: true, configured: d.configured, canSetup: !d.configured, canResetAdmin: false, session: d.session, canWrite: true };
      } catch (err) {
        return { ok: false, message: 'Não foi possível conectar ao servidor. Tente novamente em instantes.' };
      }
    },
    async login(usuario, senha, lembrar) { const d = await call('POST', '/login', { usuario, senha, lembrar: !!lembrar }); return d.session; },
    async logout() { stopPolling(); listeners = []; try { await call('POST', '/logout'); } catch {} },
    async setupAdmin(usuario, senha) { const d = await call('POST', '/setup', { usuario, senha }); return d.session; },
    async changePassword(atual, nova) { await call('POST', '/password', { senhaAtual: atual, novaSenha: nova }); },

    subscribe(onData) {
      listeners.push(onData);
      if (listeners.length === 1) startPolling();
      load();
      return () => { listeners = listeners.filter(f => f !== onData); if (!listeners.length) stopPolling(); };
    },

    async createCase(d, opts = {}) { const r = await call('POST', '/cases', { ...d, lancarFinanceiro: !!opts.lancarFinanceiro }); await reload(); return r; },
    async updateCase(id, d, opts = {}) { await call('PUT', '/cases/' + encodeURIComponent(id), { ...d, lancarFinanceiro: !!opts.lancarFinanceiro }); await reload(); },
    async deleteCase(id) { await call('DELETE', '/cases/' + encodeURIComponent(id)); await reload(); },

    async createPartner(d, senha) { const r = await call('POST', '/partners', { ...d, senha }); await reload(); return r; },
    async updatePartner(id, d) { await call('PUT', '/partners/' + encodeURIComponent(id), d); await reload(); },
    async setPartnerPassword(id, senha) { await call('POST', '/partners/' + encodeURIComponent(id) + '/password', { senha }); },
    async setPartnerActive(id, ativo) { await call('POST', '/partners/' + encodeURIComponent(id) + '/ativo', { ativo: !!ativo }); await reload(); },

    async createCredit(d, opts = {}) { const r = await call('POST', '/credits', { ...d, lancarCompra: !!opts.lancarCompra, lancarRecebimento: !!opts.lancarRecebimento }); await reload(); return r; },
    async updateCredit(id, d, opts = {}) { await call('PUT', '/credits/' + encodeURIComponent(id), { ...d, lancarCompra: !!opts.lancarCompra, lancarRecebimento: !!opts.lancarRecebimento }); await reload(); },
    async deleteCredit(id) { await call('DELETE', '/credits/' + encodeURIComponent(id)); await reload(); },

    async createFinance(d) { const r = await call('POST', '/finance', d); await reload(); return r; },
    async updateFinance(id, d) { await call('PUT', '/finance/' + encodeURIComponent(id), d); await reload(); },
    async deleteFinance(id) { await call('DELETE', '/finance/' + encodeURIComponent(id)); await reload(); },
    async createFinanceMany(list) { const ids = []; for (let i = 0; i < list.length; i += 100) { const r = await call('POST', '/finance/lote', { lancamentos: list.slice(i, i + 100) }); ids.push(...(r.ids || [])); } await reload(); return { ids }; },
    async updateFinanceGroup(grupoId, acao, desde, valor) { const r = await call('POST', '/finance/grupo/' + encodeURIComponent(grupoId), { acao, desde, valor }); await reload(); return r; },

    async createContract(d) { const r = await call('POST', '/contracts', d); await reload(); return r; },

    async punch(d) { const r = await call('POST', '/ponto', d); await reload(); return r; },
    async requestAdjust(d) { const r = await call('POST', '/ponto/ajuste', d); await reload(); return r; },
    async manualPunch(d) { const r = await call('POST', '/ponto/manual', d); await reload(); return r; },
    async decidePunch(id, decisao, observacao) { await call('POST', '/ponto/' + encodeURIComponent(id) + '/decisao', { decisao, observacao: observacao || '' }); await reload(); },
    async deletePunch(id) { await call('DELETE', '/ponto/' + encodeURIComponent(id)); await reload(); },
    async loadPonto(de, ate) {
      const d = await call('GET', `/ponto?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`);
      extraPonto = mergePonto(extraPonto, d.ponto || []);
      cache = { ...cache, ponto: mergePonto(cache.ponto, extraPonto) };
      listeners.forEach(fn => { try { fn(cache); } catch (e) { console.error(e); } });
      return d.ponto || [];
    },
    async getPontoConfig() { return call('GET', '/ponto/config'); },
    async savePontoConfig(c) { const r = await call('PUT', '/ponto/config', c); await reload(); return r; },
    async myIp() { try { return (await call('GET', '/ponto/meu-ip')).ip; } catch { return null; } },
    async updateContract(id, d) { await call('PUT', '/contracts/' + encodeURIComponent(id), d); await reload(); },
    async deleteContract(id) { await call('DELETE', '/contracts/' + encodeURIComponent(id)); await reload(); },

    async exportCSV(filename, csvText) {
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
      return true;
    }
  };
})();
