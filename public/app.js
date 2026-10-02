/*
 * Gestão geral — Costa de Araújo
 * Interface (login, painel, processos, parceiros). Toda leitura/gravação passa por
 * window.ParceriasAPI (api-rest.js no site, api-claude.js no artifact).
 */
(() => {
'use strict';
const api = window.ParceriasAPI;

/* ============ utilidades ============ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = n => fmtBRL.format(num(n));
const brlShort = n => {
  n = num(n); const a = Math.abs(n); const sign = n < 0 ? '−' : '';
  if (a >= 1e6) return sign + 'R$ ' + (a / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mi';
  if (a >= 1e4) return sign + 'R$ ' + (a / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
  return brl(n);
};
const pct = (a, b) => b > 0 ? Math.round(a / b * 100) : 0;
const fmtDate = iso => iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('/') : '—';
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const parseMoney = s => {
  if (typeof s === 'number') return s;
  s = String(s ?? '').trim().replace(/[R$\s ]/g, '');
  if (!s) return 0;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else s = s.replace(',', '.');
  return num(parseFloat(s));
};
const moneyInput = n => num(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cnj = raw => {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 20) return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`;
  return String(raw ?? '').trim();
};
const normUser = u => String(u ?? '').trim().toLowerCase().replace(/\s+/g, '.');
const natOf = c => c.natureza === 'administrativo' ? 'administrativo' : 'judicial';
const faseOf = c => c.fase === 'julgado' ? 'julgado' : 'em_curso';
const resultadoOf = c => c.resultado || (c.recebido ? 'recebido' : 'em_andamento');
const honLabel = c => faseOf(c) === 'julgado' ? 'Honorários da condenação' : (isOffice(c) ? 'Honorários previstos' : 'Honorários pretendidos');
/* Base dos honorários do escritório: valor da condenação (julgado) ou valor pretendido da ação (em curso). */
const honBase = c => faseOf(c) === 'julgado' && c.valorCondenacao != null && c.valorCondenacao !== '' ? num(c.valorCondenacao) : num(c.valorAcao);
const honCalc = c => round2(honBase(c) * num(c.pctHonorarios) / 100);
const numFmt = c => natOf(c) === 'judicial' ? cnj(c.numeroProcesso) : String(c.numeroProcesso || '');
const round2 = v => Math.round(num(v) * 100) / 100;
const natTag = c => (natOf(c) === 'administrativo' ? '<span class="tag adm">ADM</span>' : '<span class="tag jud">JUD</span>') + (isOffice(c) ? '<span class="tag esc" title="Processo só do escritório">ESCRITÓRIO</span>' : '');
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const TIPOS = ['Indenizatória (danos morais e materiais)', 'Ação contra casa de apostas', 'Revisional de contrato bancário', 'Declaratória de inexistência de débito', 'Repetição de indébito', 'Superendividamento', 'Busca e apreensão (defesa)', 'Execução / cumprimento de sentença', 'Embargos', 'Outra'];
function genPassword() {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const v = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(v).map(b => alpha[b % alpha.length]).join('');
}
let toastTimer;
function toast(msg, bad) {
  let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 5000 : 2600);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copiado.'); return true; }
  catch { toast('Não foi possível copiar automaticamente. Selecione o texto e copie.', true); return false; }
}
function loadPref(k, d) { try { const v = localStorage.getItem('ca_pref_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function savePref(k, v) { try { localStorage.setItem('ca_pref_' + k, JSON.stringify(v)); } catch {} }

/* ============ estado ============ */
const S = {
  session: null, canWrite: true, readOnly: false, partners: [], cases: [], credits: [], finance: [], contracts: [], ponto: [], pontoConfig: null, loaded: false,
  seg: loadPref('seg', 'all'), fp: '', fct: { ano: String(new Date().getFullYear()) }, fpt: { mes: new Date().toISOString().slice(0, 7), pessoa: '' }, geo: { state: 'idle' },
  tab: loadPref('tab', 'overview'), f: { q: '', partner: '', tipo: '', status: '', natureza: '', fase: '', period: loadPref('period', 'all') },
  fc: { q: '', status: '', period: 'all' }, ff: { ano: String(new Date().getFullYear()), mes: '', tipo: '', categoria: '', sit: '', q: '' }, unsub: null
};
const partnerById = id => S.partners.find(p => p.id === id);
const partnerName = id => partnerById(id)?.nome || (id ? 'Parceiro removido' : 'Escritório');
const isOffice = c => c.titularidade === 'escritorio' || !c.parceiroId;
const isAdmin = () => S.session?.role === 'admin';
const caseOptions = sel => S.cases.slice().sort((a, b) => (b.dataProtocolo || '').localeCompare(a.dataProtocolo || '') || (b.criadoEm || '').localeCompare(a.criadoEm || '')).map(c => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.cliente)} — ${esc(numFmt(c))}${isOffice(c) ? ' (escritório)' : ' (' + esc(partnerName(c.parceiroId)) + ')'}</option>`).join('');
const caseTitle = id => { const c = S.cases.find(x => x.id === id); return c ? `Processo ${numFmt(c)} — ${c.cliente}` : 'Processo removido'; };
const isAssoc = p => !!p && p.tipo === 'associado';
const isIntern = p => !!p && p.tipo === 'estagiario';
const isEmployee = p => isAssoc(p) || isIntern(p);
const myTipo = () => S.session?.tipo || (S.session?.role === 'admin' ? 'admin' : 'parceiro');
const tipoLabel = p => isIntern(p) ? 'Estagiário' : isAssoc(p) ? 'Advogado associado' : 'Advogado parceiro';
const partnerKind = p => isIntern(p) ? `Estagiário${p.curso ? ' · ' + p.curso : ''}` : isAssoc(p) ? `Advogado associado${p.areaAtuacao ? ' · ' + p.areaAtuacao : ''}` : 'Advogado parceiro';
const shareLabel = (p, who) => isAssoc(p) ? (who === 'partner' ? 'Bonificação do associado' : 'Escritório') : (who === 'partner' ? 'Parte do parceiro' : 'Parte do escritório');
const myPartnerId = () => S.session?.role === 'partner' ? S.session.partnerId : null;

/* ============ inicialização ============ */
const lgStatus = $('#lg-status'), lgBtn = $('#lg-btn');
function setStatus(msg, bad) { lgStatus.textContent = msg; lgStatus.className = 'status' + (bad ? ' bad' : ''); }

async function boot() {
  let info;
  try { info = await api.init(); } catch (e) { info = { ok: false, message: 'Falha ao iniciar: ' + (e?.message || e) }; }
  if (!info.ok) { setStatus(info.message || 'Não foi possível conectar.', true); return; }
  S.canWrite = info.canWrite !== false;
  if (!info.configured) {
    if (info.canSetup) { showSetup(false); return; }
    setStatus('O sistema ainda não foi configurado pelo escritório. Tente novamente mais tarde.', true);
    return;
  }
  if (info.canResetAdmin) $('#owner-tools').hidden = false;
  if (info.session) { S.session = info.session; enterApp(); return; }
  setStatus('');
  lgBtn.disabled = false;
  $('#lg-user').focus();
}

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const u = normUser($('#lg-user').value), p = $('#lg-pass').value, remember = $('#lg-remember').checked;
  if (!u || !p) return;
  lgBtn.disabled = true; setStatus('Verificando…');
  try { S.session = await api.login(u, p, remember); enterApp(); }
  catch (err) { setStatus(err?.message || 'Não foi possível entrar.', true); lgBtn.disabled = false; }
});

function showSetup(resetMode) {
  const body = $('#login-body');
  body.innerHTML = `
    <h1>${resetMode ? 'Redefinir acesso' : 'Configuração inicial'}</h1>
    <p class="lead">${resetMode ? 'Defina um novo usuário e senha para o login de controle geral.' : 'Crie o login de controle geral do escritório. Este passo só acontece uma vez.'}</p>
    <form id="setup-form" autocomplete="off">
      <div class="field"><label for="st-user">Usuário do administrador</label><input type="text" id="st-user" value="admin" autocapitalize="none" spellcheck="false" required></div>
      <div class="field"><label for="st-pass">Senha <small>(mínimo 8 caracteres)</small></label><input type="password" id="st-pass" minlength="8" autocomplete="new-password" required></div>
      <div class="field"><label for="st-pass2">Confirmar senha</label><input type="password" id="st-pass2" minlength="8" autocomplete="new-password" required></div>
      <button class="btn btn-primary" type="submit" id="st-btn">${resetMode ? 'Salvar nova senha' : 'Criar acesso e entrar'}</button>
      <p class="status" id="st-status"></p>
    </form>
    ${resetMode ? '<div style="text-align:center;margin-top:8px"><button class="btn-link" type="button" id="st-cancel">Voltar ao login</button></div>' : ''}`;
  $('#st-cancel')?.addEventListener('click', () => location.reload());
  $('#setup-form').addEventListener('submit', async e => {
    e.preventDefault();
    const st = $('#st-status'), u = normUser($('#st-user').value), p1 = $('#st-pass').value, p2 = $('#st-pass2').value;
    const fail = m => { st.textContent = m; st.className = 'status bad'; };
    if (!u) return fail('Informe um usuário.');
    if (p1.length < 8) return fail('A senha precisa ter pelo menos 8 caracteres.');
    if (p1 !== p2) return fail('As senhas não conferem.');
    $('#st-btn').disabled = true; st.textContent = 'Salvando…'; st.className = 'status';
    try { S.session = await api.setupAdmin(u, p1); enterApp(); }
    catch (err) { fail('Não foi possível salvar: ' + (err?.message || err)); $('#st-btn').disabled = false; }
  });
}
$('#btn-reset-admin').addEventListener('click', () => showSetup(true));

/* ============ casca do app ============ */
async function logout() {
  if (S.unsub) { try { S.unsub(); } catch {} S.unsub = null; }
  try { await api.logout(); } catch {}
  S.session = null;
  location.reload();
}

function enterApp() {
  $('#login-screen').hidden = true;
  const shell = $('#shell'); shell.hidden = false;
  const admin = isAdmin(), tipo = myTipo(), intern = tipo === 'estagiario', employee = intern || tipo === 'associado';
  const tabsAllowed = admin ? ['overview', 'cases', 'partners', 'credits', 'contracts', 'finance', 'ponto'] : intern ? ['ponto'] : employee ? ['overview', 'cases', 'ponto'] : ['overview', 'cases'];
  if (!tabsAllowed.includes(S.tab)) S.tab = tabsAllowed[0];
  const whoLabel = admin ? 'Controle geral' : intern ? 'Estagiário' : tipo === 'associado' ? 'Advogado associado' : 'Parceiro';
  shell.innerHTML = `
    <header class="band"><div class="band-in">
      <div class="brand"><img src="img/mono.png" alt="" width="160" height="185"><div><div class="brand-name">Costa de Araújo</div><div class="brand-sub">Gestão geral</div></div></div>
      <div class="band-right">
        <div class="who"><b>${esc(S.session.nome || S.session.usuario)}</b><span>${whoLabel}</span></div>
        ${admin && api.features.backup ? '<a class="btn btn-ghost btn-sm" id="btn-backup" href="api/backup" title="Baixar uma cópia de segurança do banco de dados">Backup</a>' : ''}
        ${api.features.changePassword ? '<button class="btn btn-ghost btn-sm" id="btn-pass" type="button" title="Alterar minha senha">Senha</button>' : ''}
        <button class="btn btn-ghost btn-sm" id="btn-logout" type="button">Sair</button>
      </div>
    </div></header>
    <nav class="nav" aria-label="Seções"><div class="nav-in" role="tablist" id="tabs">
      ${intern ? '' : `<button role="tab" data-tab="overview">Visão geral</button><button role="tab" data-tab="cases">${admin ? 'Processos' : 'Meus processos'}</button>`}
      ${admin ? '<button role="tab" data-tab="partners">Parceiros e associados</button><button role="tab" data-tab="credits">Compra de créditos</button><button role="tab" data-tab="contracts">Contratos com empresas</button><button role="tab" data-tab="finance">Financeiro</button><button role="tab" data-tab="ponto">Controle de horário</button>' : ''}
      ${employee ? '<button role="tab" data-tab="ponto">Meu horário</button>' : ''}
    </div></nav>
    <main class="wrap" id="view"></main>`;
  $('#btn-logout').addEventListener('click', logout);
  $('#btn-pass')?.addEventListener('click', openPasswordForm);
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { S.tab = b.dataset.tab; savePref('tab', S.tab); render(); } });
  bindViewOnce($('#view'));
  S.unsub = api.subscribe(data => {
    if (data.sessionLost) { toast('Sua sessão expirou ou o acesso foi alterado. Entre novamente.', true); setTimeout(logout, 1500); return; }
    S.partners = data.partners || []; S.cases = data.cases || []; S.credits = data.credits || []; S.finance = data.finance || []; S.contracts = data.contracts || []; S.ponto = data.ponto || []; S.pontoConfig = data.pontoConfig || S.pontoConfig; S.loaded = !!data.loaded; render();
  });
  render();
}

/* ============ cálculos ============ */
function metrics(c) {
  const res = resultadoOf(c), isRec = res === 'recebido', perdido = res === 'perdido';
  const pretendido = num(c.honorariosPretendidos);
  const recebido = isRec ? num(c.valorRecebido == null || c.valorRecebido === '' ? pretendido : c.valorRecebido) : 0;
  const base = isRec ? recebido : (perdido ? 0 : pretendido);
  const pN = num(c.pctNosso), pP = num(c.pctParceiro);
  const corretor = c.temCorretor ? num(c.valorCorretor) : 0;
  return {
    pretendido, recebido, base, perdido, aReceber: (!isRec && !perdido) ? pretendido : 0,
    nossaParte: base * pN / 100, parteParceiro: base * pP / 100,
    nossaRecebida: recebido * pN / 100, parceiroRecebido: recebido * pP / 100,
    custoLead: num(c.custoLead), corretor, corretorPendente: c.temCorretor && !c.corretorPago ? corretor : 0
  };
}
function totals(list) {
  const t = { n: list.length, nRecebidos: 0, nPerdidos: 0, pretendido: 0, recebido: 0, aReceber: 0, perdido: 0, nossaParte: 0, parteParceiro: 0, nossaRecebida: 0, parceiroRecebido: 0, custoLead: 0, corretor: 0, corretorPendente: 0, nCorretor: 0 };
  for (const c of list) {
    const m = metrics(c), res = resultadoOf(c);
    t.pretendido += m.pretendido; t.recebido += m.recebido; t.aReceber += m.aReceber;
    if (res === 'recebido') t.nRecebidos++; else if (res === 'perdido') { t.nPerdidos++; t.perdido += m.pretendido; }
    t.nossaParte += m.nossaParte; t.parteParceiro += m.parteParceiro; t.nossaRecebida += m.nossaRecebida; t.parceiroRecebido += m.parceiroRecebido;
    t.custoLead += m.custoLead; t.corretor += m.corretor; t.corretorPendente += m.corretorPendente; if (c.temCorretor) t.nCorretor++;
  }
  t.nAndamento = t.n - t.nRecebidos - t.nPerdidos;
  t.liquido = t.nossaRecebida - t.custoLead - t.corretor;
  return t;
}
/* Lançamentos que um recebimento gera no financeiro (o servidor aplica a mesma regra). */
function financeEntriesFor(c) {
  const m = metrics(c), pObj = partnerById(c.parceiroId), p = partnerName(c.parceiroId), assoc = isAssoc(pObj), ref = `Processo ${numFmt(c)} — ${c.cliente}`;
  if (isOffice(c)) return m.recebido > 0 ? [{ tipo: 'receita', categoria: faseOf(c) === 'julgado' ? 'Alvará de honorários finais' : 'Honorários de êxito', descricao: `${ref} (escritório)`, valor: round2(m.recebido), data: c.dataRecebimento }] : [];
  const categoria = faseOf(c) === 'julgado' ? 'Alvará de honorários finais' : (assoc ? 'Honorários de êxito' : 'Honorários de parceria');
  const out = [];
  if (!assoc && c.fluxoRecebimento === 'parceiro') out.push({ tipo: 'receita', categoria, descricao: `${ref} (parte do escritório, repassada por ${p})`, valor: round2(m.nossaRecebida), data: c.dataRecebimento });
  else {
    out.push({ tipo: 'receita', categoria, descricao: `${ref} (valor total recebido)`, valor: round2(m.recebido), data: c.dataRecebimento });
    if (assoc) out.push({ tipo: 'despesa', categoria: 'Bonificação de associado', descricao: `Bonificação de ${p} — ${ref}`, valor: round2(m.parceiroRecebido), data: c.dataRecebimento, associadoId: pObj.id });
    else out.push({ tipo: 'despesa', categoria: 'Repasse a parceiro', descricao: `Repasse a ${p} — ${ref}`, valor: round2(m.parceiroRecebido), data: c.dataRecebimento });
  }
  return out.filter(e => e.valor > 0);
}
const finPendentes = () => S.cases.filter(c => resultadoOf(c) === 'recebido' && c.financeiroStatus === 'pendente');
function inPeriod(c, period) {
  if (period === 'all') return true;
  const d = c.dataProtocolo; if (!d) return false;
  const now = new Date(), dt = new Date(d.slice(0, 10) + 'T00:00:00');
  if (period === 'year') return dt.getFullYear() === now.getFullYear();
  if (period === '12m') { const lim = new Date(now); lim.setMonth(lim.getMonth() - 12); return dt >= lim; }
  if (period === '30d') { const lim = new Date(now); lim.setDate(lim.getDate() - 30); return dt >= lim; }
  return true;
}
function filtered(useAll) {
  const f = S.f, q = f.q.trim().toLowerCase(), qd = q.replace(/\D/g, '');
  return S.cases.filter(c => {
    if (!inPeriod(c, f.period)) return false;
    if (isAdmin() && f.partner === '_escritorio' && !isOffice(c)) return false;
    if (isAdmin() && f.partner && f.partner !== '_escritorio' && c.parceiroId !== f.partner) return false;
    if (useAll) {
      if (f.tipo && (c.tipoAcao || '') !== f.tipo) return false;
      if (f.natureza && natOf(c) !== f.natureza) return false;
      if (f.fase && faseOf(c) !== f.fase) return false;
      const res = resultadoOf(c);
      if (f.status === 'recebido' && res !== 'recebido') return false;
      if (f.status === 'pendente' && res !== 'em_andamento') return false;
      if (f.status === 'perdido' && res !== 'perdido') return false;
      if (f.status === 'fin_pendente' && !(res === 'recebido' && c.financeiroStatus === 'pendente')) return false;
      if (f.status === 'corretor' && !(c.temCorretor && !c.corretorPago)) return false;
      if (q) {
        const hay = [c.numeroProcesso, c.cliente, c.tipoAcao, partnerName(c.parceiroId), c.nomeCorretor, c.observacoes].join(' ').toLowerCase();
        const hayD = String(c.numeroProcesso || '').replace(/\D/g, '');
        if (!hay.includes(q) && !(qd.length >= 4 && hayD.includes(qd))) return false;
      }
    }
    return true;
  }).sort((a, b) => (b.dataProtocolo || '').localeCompare(a.dataProtocolo || '') || (b.criadoEm || '').localeCompare(a.criadoEm || ''));
}

/* ============ renderização ============ */
function render() {
  const view = $('#view'); if (!view) return;
  $$('#tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)));
  const ro = S.readOnly ? `<div class="ro-banner">Seu acesso está em modo somente leitura: você consegue consultar, mas não salvar. Peça ao escritório para conceder permissão de edição.</div>` : '';
  if (S.tab === 'partners' && isAdmin()) view.innerHTML = ro + renderPartners();
  else if (S.tab === 'credits' && isAdmin()) view.innerHTML = ro + renderCredits();
  else if (S.tab === 'finance' && isAdmin()) view.innerHTML = ro + renderFinance();
  else if (S.tab === 'contracts' && isAdmin()) view.innerHTML = ro + renderContracts();
  else if (S.tab === 'ponto') view.innerHTML = ro + (isAdmin() ? renderPonto() : renderMyPonto());
  else if (S.tab === 'cases' && myTipo() !== 'estagiario') view.innerHTML = ro + renderCases();
  else view.innerHTML = ro + renderOverview();
  afterRender(view);
}
function periodSelect(id) {
  const o = [['all', 'Todo o período'], ['year', 'Este ano'], ['12m', 'Últimos 12 meses'], ['30d', 'Últimos 30 dias']];
  return `<select id="${id}" data-f="period" aria-label="Período">${o.map(([v, l]) => `<option value="${v}" ${S.f.period === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
}
function partnerSelect(id, any) {
  return `<select id="${id}" data-f="partner" aria-label="Parceiro"><option value="">${any || 'Todos (parceiros, associados e escritório)'}</option><option value="_escritorio" ${S.f.partner === '_escritorio' ? 'selected' : ''}>Só do escritório</option>${S.partners.slice().sort((a, b) => (a.nome || '').localeCompare(b.nome || '')).map(p => `<option value="${esc(p.id)}" ${S.f.partner === p.id ? 'selected' : ''}>${esc(p.nome)}${p.ativo === false ? ' (inativo)' : ''}</option>`).join('')}</select>`;
}
function tile(lbl, val, sub, cls) { return `<div class="tile"><div class="lbl">${lbl}</div><div class="val ${cls || ''}">${val}</div><div class="sub">${sub}</div></div>`; }

const inPeriodDate = (d, period) => inPeriod({ dataProtocolo: d }, period);
function armTotals(period) {
  const out = { parcerias: 0, contratos: 0, creditos: 0, proprio: 0, total: 0, desp: 0 };
  for (const e of S.finance) { if (isProv(e) || !inPeriodDate(e.data, period)) continue; if (e.tipo === 'receita') { out[armOf(e)] += num(e.valor); out.total += num(e.valor); } else out.desp += num(e.valor); }
  return out;
}
function armsChart(container) {
  const W = Math.max(280, container.clientWidth || 600), H = 240, padL = 62, padR = 10, padT = 18, padB = 30;
  const now = new Date(), months = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, m: d.getMonth(), y: d.getFullYear(), parcerias: 0, contratos: 0, creditos: 0, proprio: 0, total: 0 }); }
  for (const e of S.finance) { if (e.tipo !== 'receita' || isProv(e)) continue; const b = months.find(x => x.ym === ymOf(e.data)); if (b) { b[armOf(e)] += num(e.valor); b.total += num(e.valor); } }
  const maxV = Math.max(1, ...months.map(x => x.total));
  const mag = Math.pow(10, Math.floor(Math.log10(maxV / 4))), cand = [1, 2, 2.5, 5, 10].map(k => k * mag);
  const step = cand.find(s => maxV / s <= 5) || cand[cand.length - 1], top = Math.ceil(maxV / step) * step;
  const iw = W - padL - padR, ih = H - padT - padB, slot = iw / 12, bw = Math.min(28, slot * 0.62);
  const y = v => padT + ih - (v / top) * ih;
  const ORDER = ['parcerias', 'contratos', 'creditos', 'proprio'], CLS = { parcerias: 's1', contratos: 's2', creditos: 's3', proprio: 's4' };
  let g = ''; for (let v = 0; v <= top + 1e-9; v += step) g += `<line class="gl" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${v === 0 ? '0' : esc(brlShort(v).replace(/^R\$\s*/, ''))}</text>`;
  let bars = '', labels = '';
  months.forEach((mo, i) => {
    const x0 = padL + slot * i, x = x0 + (slot - bw) / 2;
    const tip = `${MONTHS[mo.m]}/${mo.y}&#10;Total ${esc(brl(mo.total))}` + ORDER.filter(k => mo[k] > 0).map(k => `&#10;${ARMS[k]}: ${esc(brl(mo[k]))}`).join('');
    bars += `<rect class="hit" x="${x0}" y="${padT}" width="${slot}" height="${ih}" data-tip="${tip}"/>`;
    let acc = 0;
    ORDER.forEach(k => { if (mo[k] <= 0) return; const y1 = y(acc + mo[k]), y0 = y(acc); const h = Math.max(0, y0 - y1 - (acc > 0 ? 2 : 0)); if (h > 0) bars += `<rect class="seg ${CLS[k]}" x="${x}" y="${y1}" width="${bw}" height="${h}" rx="${acc + mo[k] >= mo.total - 1e-9 ? 3 : 0}"/>`; acc += mo[k]; });
    if (mo.total > 0 && slot >= 54) labels += `<text x="${x + bw / 2}" y="${y(mo.total) - 6}" text-anchor="middle" style="fill:var(--fg-2);font-weight:600">${esc(brlShort(mo.total).replace(/^R\$\s*/, ''))}</text>`;
    labels += `<text x="${x0 + slot / 2}" y="${H - 9}" text-anchor="middle">${MONTHS[mo.m]}</text>`;
  });
  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Receitas por braço, mês a mês">${g}<line class="ax" x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}"/>${bars}${labels}</svg>
    <div class="legend" style="margin-top:8px">${ORDER.map(k => `<span><i style="background:var(--${CLS[k]})"></i>${ARMS[k]}</span>`).join('')}</div>`;
}
function renderOverview() {
  const admin = isAdmin();
  if (admin && S.seg !== 'parcerias') return renderOverviewSeg();
  const list = filtered(false);
  const t = totals(list);
  const me = admin ? null : partnerById(myPartnerId());
  const heroSub = t.pretendido > 0 ? `${pct(t.recebido, t.pretendido)}% de ${brl(t.pretendido)} pretendidos` : 'Nenhum honorário pretendido cadastrado';
  const pend = t.nAndamento;
  const hero = `
    <section class="hero" aria-label="Resumo">
      <div><div class="lbl">${admin ? 'Honorários recebidos' : 'Honorários recebidos nos seus processos'}</div><div class="val">${brlShort(t.recebido)}</div><div class="sub">${heroSub}</div>
        <div class="meter" aria-hidden="true"><i style="width:${Math.min(100, pct(t.recebido, t.pretendido))}%"></i></div></div>
      <div class="hero-side">
        <div><span class="lbl">Em carteira</span><b>${brlShort(t.pretendido)}</b><small>${t.n} processo${t.n === 1 ? '' : 's'}</small></div>
        <div><span class="lbl">A receber</span><b>${brlShort(t.aReceber)}</b><small>${pend} em andamento${t.nPerdidos ? ` · ${t.nPerdidos} perdido${t.nPerdidos === 1 ? '' : 's'}` : ''}</small></div>
        <div><span class="lbl">Recebidos</span><b>${t.nRecebidos} processo${t.nRecebidos === 1 ? '' : 's'}</b><small>${t.n ? pct(t.nRecebidos, t.n) + '% do total' : '—'} · ${list.filter(c => natOf(c) === 'judicial').length} judiciais, ${list.filter(c => natOf(c) === 'administrativo').length} administrativos</small></div>
      </div>
    </section>`;
  const tiles = admin ? `
    ${tile('Nossa parte', brlShort(t.nossaParte), `${brlShort(t.nossaRecebida)} já recebida`)}
    ${tile('Parte dos parceiros', brlShort(t.parteParceiro), `${brlShort(t.parceiroRecebido)} já recebida`)}
    ${tile('Custo de leads', brlShort(t.custoLead), t.n ? `média de ${brl(t.custoLead / t.n)} por processo` : 'sem processos')}
    ${tile('Corretores a pagar', brlShort(t.corretorPendente), `${brlShort(t.corretor)} no total · ${t.nCorretor} caso${t.nCorretor === 1 ? '' : 's'}`)}
    ${tile('Resultado líquido', brlShort(t.liquido), 'nossa parte recebida − leads − corretores', t.liquido < 0 ? 'neg' : (t.liquido > 0 ? 'pos' : ''))}`
  : `
    ${tile(isAssoc(me) ? 'Sua bonificação' : 'Sua parte', brlShort(t.parteParceiro), `${brlShort(t.parceiroRecebido)} já recebida`)}
    ${tile('Parte do escritório', brlShort(t.nossaParte), `${brlShort(t.nossaRecebida)} já recebida`)}
    ${tile('Custo de leads', brlShort(t.custoLead), t.n ? `média de ${brl(t.custoLead / t.n)} por processo` : 'sem processos')}
    ${tile('Corretores a pagar', brlShort(t.corretorPendente), `${t.nCorretor} caso${t.nCorretor === 1 ? '' : 's'} com corretor`)}`;
  const now = new Date(), m0 = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const range = `${MONTHS[m0.getMonth()]}/${m0.getFullYear()} – ${MONTHS[now.getMonth()]}/${now.getFullYear()}`;
  const recent = list.slice(0, 8);
  return `
    <div class="page-h"><div><h1>${admin ? 'Visão geral do escritório' : 'Olá, ' + esc((me?.nome || '').split(' ')[0] || 'advogado')}</h1>
      <p>${admin ? 'Processos com advogados parceiros, associados e do próprio escritório.' : esc(me?.escritorio || (isAssoc(me) ? partnerKind(me) : 'Seus processos em parceria com o escritório Costa de Araújo.'))}</p></div>
      <div class="toolbar">${admin ? partnerSelect('ov-partner') : ''}${periodSelect('ov-period')}
        ${S.canWrite ? '<button class="btn btn-primary" type="button" data-act="new-case">+ Novo processo</button>' : ''}</div></div>
    ${admin ? segControl() : ''}
    ${!S.loaded ? '<div class="empty" style="margin-bottom:12px"><b>Carregando processos…</b></div>' : ''}
    ${admin && finPendentes().length ? finBanner() : ''}${admin ? pontoBanner() : ''}
    ${hero}
    <div class="tiles">${tiles}</div>
    <div class="grid-2">
      ${admin ? `<div class="card"><div class="card-h"><h2>Recebido vs. pretendido por parceiro</h2><small>barra cheia = tudo recebido</small></div>${meterList(list)}</div>` : ''}
      <div class="card"><div class="card-h"><h2>Processos protocolados por mês</h2><small>${range}</small></div><div class="chart" id="chart-months"></div></div>
      <div class="card"><div class="card-h"><h2>Por tipo de ação</h2><small>quantidade · honorários pretendidos</small></div>${typeList(list)}</div>
    </div>
    <div class="card-h"><h2>Processos recentes</h2><button class="btn-link" type="button" data-act="go-cases">Ver todos</button></div>
    ${casesTable(recent)}`;
}
function segControl() {
  const segs = [['all', 'Todos os braços'], ['parcerias', 'Processos e parcerias'], ['creditos', 'Compra de créditos'], ['contratos', 'Contratos com empresas']];
  return `<div class="seg" role="tablist" aria-label="Braço do escritório">${segs.map(([v, l]) => `<button role="tab" type="button" data-act="seg" data-id="${v}" aria-selected="${S.seg === v}">${l}</button>`).join('')}</div>`;
}
function renderOverviewSeg() {
  const period = S.f.period, a = armTotals(period);
  const head = `
    <div class="page-h"><div><h1>Visão geral do escritório</h1><p>Receitas e resultados por braço: parcerias, créditos, contratos com empresas e honorários próprios.</p></div>
      <div class="toolbar">${periodSelect('ov-period')}</div></div>
    ${segControl()}
    ${!S.loaded ? '<div class="empty" style="margin-bottom:12px"><b>Carregando…</b></div>' : ''}
    ${finPendentes().length ? finBanner() : ''}${pontoBanner()}`;
  if (S.seg === 'creditos') {
    const t = creditTotals(S.credits);
    return head + creditsHero(t) + `<div class="card" style="margin-bottom:14px"><div class="card-h"><h2>Linha do tempo dos recebimentos previstos</h2><button class="btn-link" type="button" data-act="go-credits">Abrir compra de créditos</button></div><div class="chart" id="chart-timeline"></div></div>
      ${tilesRow([['Investido no período', brlShort(S.credits.filter(c => inPeriodDate(c.dataCompra, period)).reduce((s, c) => s + num(c.valorCompra), 0)), 'compras realizadas no período'], ['Recebido no período', brlShort(S.credits.filter(c => c.recebido && inPeriodDate(c.dataRecebimento, period)).reduce((s, c) => s + creditMetrics(c).recebido, 0)), 'créditos pagos no período'], ['Lucro realizado no período', brlShort(S.credits.filter(c => c.recebido && inPeriodDate(c.dataRecebimento, period)).reduce((s, c) => s + creditMetrics(c).lucroRealizado, 0)), 'recebido − comprado'], ['Atrasados', String(S.credits.filter(c => creditMetrics(c).atrasado).length), 'com data prevista já passada']])}`;
  }
  if (S.seg === 'contratos') {
    const ano = String(new Date().getFullYear()), y = contractYear(ano);
    return head + contractsHero(y.t, ano) + `<div class="card-h"><h2>Recebimentos de ${ano}</h2><button class="btn-link" type="button" data-act="go-contracts">Abrir contratos com empresas</button></div>${contractsGrid(y, true)}`;
  }
  // todos os braços
  const rows = [['parcerias', 's1'], ['contratos', 's2'], ['creditos', 's3'], ['proprio', 's4']].map(([k, cls]) => ({ k, cls, v: a[k] }));
  const res = a.total - a.desp;
  const tCases = totals(S.cases.filter(c => inPeriod(c, period))), tCred = creditTotals(S.credits), yC = contractYear(String(new Date().getFullYear()));
  return head + `
    <section class="hero" aria-label="Receitas do escritório">
      <div><div class="lbl">Receitas realizadas${period === 'all' ? '' : ' no período'}</div><div class="val">${brlShort(a.total)}</div><div class="sub">${a.total || a.desp ? `${brl(a.desp)} de despesas · resultado ${res < 0 ? '−' : ''}${brl(Math.abs(res))}` : 'Nenhum lançamento no período'}</div>
        <div class="meter" aria-hidden="true"><i style="width:${a.total > 0 ? Math.min(100, pct(a.desp, a.total)) : 0}%"></i></div></div>
      <div class="hero-side">
        <div><span class="lbl">Processos</span><b>${brlShort(a.parcerias)}</b><small>${pct(a.parcerias, a.total)}% das receitas</small></div>
        <div><span class="lbl">Contratos</span><b>${brlShort(a.contratos)}</b><small>${pct(a.contratos, a.total)}% das receitas</small></div>
        <div><span class="lbl">Créditos</span><b>${brlShort(a.creditos)}</b><small>${pct(a.creditos, a.total)}% das receitas</small></div>
      </div>
    </section>
    ${provisionedBox(true)}
    <div class="card" style="margin-bottom:12px"><div class="card-h"><h2>Receitas por braço, mês a mês</h2><small>últimos 12 meses · valores realizados</small></div><div class="chart" id="chart-arms"></div></div>
    <div class="grid-2">
      <div class="card"><div class="card-h"><h2>Participação de cada braço</h2><small>${period === 'all' ? 'todo o período' : 'período selecionado'}</small></div>${a.total ? `<div class="barlist">${rows.map(r => `<div class="barrow"><div class="n">${ARMS[r.k]}</div><div class="v">${brl(r.v)} <small>· ${pct(r.v, a.total)}%</small></div><div class="track" style="background:color-mix(in srgb, var(--${r.cls}) 22%, transparent)" data-tip="${ARMS[r.k]}&#10;${esc(brl(r.v))} · ${pct(r.v, a.total)}% das receitas"><i style="width:${pct(r.v, a.total)}%;background:var(--${r.cls})"></i></div></div>`).join('')}</div>` : '<div class="empty"><b>Sem receitas realizadas</b>Os lançamentos do Financeiro alimentam esta visão.</div>'}</div>
      <div class="card"><div class="card-h"><h2>Despesas por categoria</h2><small>${period === 'all' ? 'todo o período' : 'período selecionado'}</small></div>${categoryList(S.finance.filter(e => inPeriodDate(e.data, period)), 'despesa')}</div>
    </div>
    <div class="section-t">Cada braço em um olhar</div>
    <div class="tiles arms">
      <button class="tile arm" type="button" data-act="seg" data-id="parcerias"><div class="lbl">Processos e parcerias</div><div class="val">${brlShort(tCases.recebido)}</div><div class="sub">${tCases.n} processo${tCases.n === 1 ? '' : 's'} · ${brlShort(tCases.aReceber)} a receber · nossa parte recebida ${brlShort(tCases.nossaRecebida)}</div></button>
      <button class="tile arm" type="button" data-act="seg" data-id="creditos"><div class="lbl">Compra de créditos</div><div class="val">${brlShort(tCred.lucroPrevisto)}</div><div class="sub">lucro previsto · ${brlShort(tCred.aReceber)} a receber de ${tCred.n - tCred.nRecebidos} crédito${tCred.n - tCred.nRecebidos === 1 ? '' : 's'}</div></button>
      <button class="tile arm" type="button" data-act="seg" data-id="contratos"><div class="lbl">Contratos com empresas</div><div class="val">${brlShort(yC.t.mrr)}</div><div class="sub">por mês em ${yC.t.ativos} contrato${yC.t.ativos === 1 ? '' : 's'} ativo${yC.t.ativos === 1 ? '' : 's'} · ${brlShort(yC.t.pendente)} em aberto</div></button>
      <button class="tile arm" type="button" data-act="go-finance"><div class="lbl">Financeiro do escritório</div><div class="val ${res < 0 ? 'neg' : 'pos'}">${res < 0 ? '−' : ''}${brlShort(Math.abs(res))}</div><div class="sub">resultado${period === 'all' ? ' acumulado' : ' no período'} · ${brlShort(a.proprio)} de honorários próprios e outras receitas</div></button>
    </div>`;
}
function tilesRow(items) { return `<div class="tiles">${items.map(([l, v, sub]) => tile(l, v, sub)).join('')}</div>`; }
function meterList(list) {
  const by = new Map();
  for (const c of list) { const m = metrics(c); const k = c.parceiroId || '_'; const o = by.get(k) || { pret: 0, rec: 0, n: 0 }; o.pret += m.pretendido; o.rec += m.recebido; o.n++; by.set(k, o); }
  const rows = Array.from(by, ([id, o]) => ({ id, ...o })).sort((a, b) => b.pret - a.pret);
  if (!rows.length) return `<div class="empty"><b>Sem dados ainda</b>Os parceiros aparecem aqui assim que houver processos cadastrados.</div>`;
  return `<div class="barlist">${rows.map(r => `<div class="barrow"><div class="n" title="${esc(partnerName(r.id))}">${esc(partnerName(r.id))}</div>
    <div class="v">${brlShort(r.rec)} <small>/ ${brlShort(r.pret)}</small></div>
    <div class="track" data-tip="${esc(partnerName(r.id))}&#10;${r.n} processo${r.n === 1 ? '' : 's'}&#10;Recebido ${esc(brl(r.rec))} de ${esc(brl(r.pret))} (${pct(r.rec, r.pret)}%)"><i style="width:${Math.min(100, pct(r.rec, r.pret))}%"></i></div></div>`).join('')}</div>`;
}
function typeList(list) {
  const by = new Map();
  for (const c of list) { const k = c.tipoAcao || 'Não informado'; const o = by.get(k) || { n: 0, pret: 0 }; o.n++; o.pret += metrics(c).pretendido; by.set(k, o); }
  const rows = Array.from(by, ([k, o]) => ({ k, ...o })).sort((a, b) => b.n - a.n).slice(0, 8);
  if (!rows.length) return `<div class="empty"><b>Sem dados ainda</b>Cadastre o primeiro processo para ver a distribuição por tipo de ação.</div>`;
  const max = Math.max(...rows.map(r => r.n));
  return `<div class="barlist">${rows.map(r => `<div class="barrow"><div class="n" title="${esc(r.k)}">${esc(r.k)}</div>
    <div class="v">${r.n} <small>· ${brlShort(r.pret)}</small></div>
    <div class="track" data-tip="${esc(r.k)}&#10;${r.n} processo${r.n === 1 ? '' : 's'}&#10;${esc(brl(r.pret))} pretendidos"><i style="width:${pct(r.n, max)}%"></i></div></div>`).join('')}</div>`;
}
function monthChart(container, list) {
  const W = Math.max(280, container.clientWidth || 600), H = 200, padL = 34, padR = 8, padT = 12, padB = 26;
  const now = new Date(); const months = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ y: d.getFullYear(), m: d.getMonth(), n: 0, pret: 0 }); }
  for (const c of list) { if (!c.dataProtocolo) continue; const y = +c.dataProtocolo.slice(0, 4), m = +c.dataProtocolo.slice(5, 7) - 1; const b = months.find(x => x.y === y && x.m === m); if (b) { b.n++; b.pret += metrics(c).pretendido; } }
  const maxN = Math.max(1, ...months.map(x => x.n));
  const step = maxN <= 5 ? 1 : maxN <= 10 ? 2 : maxN <= 25 ? 5 : Math.ceil(maxN / 5 / 10) * 10;
  const top = Math.ceil(maxN / step) * step;
  const iw = W - padL - padR, ih = H - padT - padB, slot = iw / 12, bw = Math.min(24, slot * 0.6);
  const y = v => padT + ih - (v / top) * ih;
  let g = '';
  for (let v = 0; v <= top; v += step) g += `<line class="gl" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  let bars = '', labels = '';
  months.forEach((mo, i) => {
    const x = padL + slot * i + (slot - bw) / 2, h = (mo.n / top) * ih, yy = y(mo.n);
    const tip = `${MONTHS[mo.m]}/${mo.y}&#10;${mo.n} processo${mo.n === 1 ? '' : 's'}&#10;${esc(brl(mo.pret))} pretendidos`;
    bars += `<rect class="hit" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${ih}" data-tip="${tip}"/>`;
    if (mo.n > 0) bars += `<path class="col" d="${roundedTop(x, yy, bw, h, 4)}"/>`;
    if (mo.n > 0) labels += `<text x="${x + bw / 2}" y="${yy - 5}" text-anchor="middle" style="fill:var(--fg-2);font-weight:600">${mo.n}</text>`;
    labels += `<text x="${padL + slot * i + slot / 2}" y="${H - 8}" text-anchor="middle">${MONTHS[mo.m]}</text>`;
  });
  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Processos protocolados por mês">${g}<line class="ax" x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}"/>${bars}${labels}</svg>`;
}
function roundedTop(x, y, w, h, r) {
  if (h <= 0) return ''; r = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
function statusPill(c) { const r = resultadoOf(c); return r === 'recebido' ? '<span class="pill ok">Recebido</span>' : r === 'perdido' ? '<span class="pill off">Perdido</span>' : '<span class="pill wait">Em andamento</span>'; }
function pontoBanner() {
  const n = pontoPendentes().length; if (!n) return '';
  const aj = pontoPendentes().filter(e => e.origem === 'ajuste').length, fora = n - aj;
  return `<div class="ro-banner" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span style="flex:1 1 260px"><b>Controle de horário:</b> ${fora ? `${fora} registro${fora === 1 ? '' : 's'} fora do escritório` : ''}${fora && aj ? ' e ' : ''}${aj ? `${aj} pedido${aj === 1 ? '' : 's'} de ajuste` : ''} aguardam sua decisão.</span><button class="btn btn-sm btn-primary" type="button" data-act="go-ponto">Ver pendências</button></div>`;
}
function finBanner() {
  const n = finPendentes().length, v = finPendentes().reduce((s, c) => s + metrics(c).recebido, 0);
  return `<div class="ro-banner" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span style="flex:1 1 260px"><b>${n} recebimento${n === 1 ? '' : 's'}</b> informado${n === 1 ? '' : 's'} pelos parceiros (${brl(v)}) aguardam lançamento no Financeiro.</span><button class="btn btn-sm btn-primary" type="button" data-act="go-fin-pending">Ver e lançar</button></div>`;
}
function casesTable(list) {
  const admin = isAdmin();
  if (!S.loaded) return `<div class="empty"><b>Carregando…</b></div>`;
  if (!list.length) return `<div class="empty"><b>Nenhum processo ${S.cases.length ? 'encontrado com esses filtros' : 'cadastrado ainda'}</b>${S.cases.length ? 'Ajuste a busca ou o período.' : 'Use “Novo processo” para cadastrar o primeiro.'}</div>`;
  const rows = list.map(c => { const m = metrics(c); return `<tr data-id="${esc(c.id)}" tabindex="0">
    <td><span class="mono">${fmtDate(c.dataProtocolo)}</span></td>
    <td>${natTag(c)} <span class="mono">${esc(numFmt(c))}</span><span class="sub">${esc(c.tipoAcao || '')}</span></td>
    <td>${esc(c.cliente)}${admin ? `<span class="sub">${isOffice(c) ? 'Só do escritório' + (c.pctHonorarios != null ? ' · ' + num(c.pctHonorarios) + '% de honorários' : '') : esc(partnerName(c.parceiroId))}</span>` : ''}</td>
    <td class="num">${brl(m.pretendido)}<span class="sub">${faseOf(c) === 'julgado' ? 'hon. da condenação' + (c.valorCondenacao ? ' · condenação ' + brlShort(c.valorCondenacao) : '') : 'hon. previstos' + (c.valorAcao ? ' · ação de ' + brlShort(c.valorAcao) : '')} · lead ${brl(m.custoLead)}</span></td>
    <td>${statusPill(c)}${resultadoOf(c) === 'recebido' ? `<span class="sub">${brl(m.recebido)} em ${fmtDate(c.dataRecebimento)}${admin ? (c.financeiroStatus === 'lancado' ? ' · no financeiro' : c.financeiroStatus === 'pendente' ? ' · <b style="color:var(--warn)">lançar no financeiro</b>' : '') : ''}</span>` : resultadoOf(c) === 'perdido' ? `<span class="sub">encerrado em ${fmtDate(c.dataEncerramento)}</span>` : `<span class="sub">${faseOf(c) === 'julgado' ? 'julgado, aguardando' : 'em curso'}</span>`}</td>
    <td class="num">${isOffice(c) ? '100% escritório' : `${num(c.pctParceiro)}% / ${num(c.pctNosso)}%`}<span class="sub">${isOffice(c) ? brlShort(m.nossaParte) : brlShort(m.parteParceiro) + ' / ' + brlShort(m.nossaParte)}</span></td>
    <td>${c.temCorretor ? (c.corretorPago ? `<span class="pill ok">Pago</span>` : `<span class="pill warn">A pagar</span>`) + `<span class="sub">${brl(c.valorCorretor)}${c.nomeCorretor ? ' · ' + esc(c.nomeCorretor) : ''}</span>` : '<span class="muted">—</span>'}</td>
  </tr>`; }).join('');
  return `<div class="table-wrap"><table><thead><tr><th>Protocolo</th><th>Processo</th><th>Cliente${admin ? ' · parceiro' : ''}</th><th class="num">Valor</th><th>Situação</th><th class="num">Advogado / escritório</th><th>Corretor</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function renderCases() {
  const admin = isAdmin();
  const list = filtered(true);
  const t = totals(list);
  const tipos = Array.from(new Set(S.cases.map(c => c.tipoAcao).filter(Boolean))).sort();
  return `
    <div class="page-h"><div><h1>${admin ? 'Processos' : 'Meus processos'}</h1><p>${list.length} processo${list.length === 1 ? '' : 's'} · ${brl(t.pretendido)} pretendidos · ${brl(t.recebido)} recebidos</p></div>
      <div class="toolbar">
        ${api.features.export ? '<button class="btn" type="button" data-act="export">Exportar CSV</button>' : ''}
        ${S.canWrite ? '<button class="btn btn-primary" type="button" data-act="new-case">+ Novo processo</button>' : ''}
      </div></div>
    ${admin && finPendentes().length && S.f.status !== 'fin_pendente' ? finBanner() : ''}
    <div class="toolbar" style="margin-bottom:14px">
      <div class="field grow"><input type="text" id="f-q" data-f="q" value="${esc(S.f.q)}" placeholder="Buscar por processo, cliente, corretor…" aria-label="Buscar"></div>
      ${admin ? partnerSelect('f-partner') : ''}
      <select id="f-nat" data-f="natureza" aria-label="Natureza"><option value="">Judiciais e administrativos</option><option value="judicial" ${S.f.natureza === 'judicial' ? 'selected' : ''}>Só judiciais</option><option value="administrativo" ${S.f.natureza === 'administrativo' ? 'selected' : ''}>Só administrativos</option></select>
      <select id="f-tipo" data-f="tipo" aria-label="Tipo de ação"><option value="">Todos os tipos</option>${tipos.map(x => `<option ${S.f.tipo === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <select id="f-fase" data-f="fase" aria-label="Fase"><option value="">Em curso e julgados</option><option value="em_curso" ${S.f.fase === 'em_curso' ? 'selected' : ''}>Só em curso</option><option value="julgado" ${S.f.fase === 'julgado' ? 'selected' : ''}>Só julgados</option></select>
      <select id="f-status" data-f="status" aria-label="Situação"><option value="">Qualquer situação</option><option value="pendente" ${S.f.status === 'pendente' ? 'selected' : ''}>Em andamento</option><option value="recebido" ${S.f.status === 'recebido' ? 'selected' : ''}>Recebidos</option><option value="perdido" ${S.f.status === 'perdido' ? 'selected' : ''}>Perdidos</option>${admin ? `<option value="fin_pendente" ${S.f.status === 'fin_pendente' ? 'selected' : ''}>Recebidos sem lançar no financeiro</option>` : ''}<option value="corretor" ${S.f.status === 'corretor' ? 'selected' : ''}>Corretor a pagar</option></select>
      ${periodSelect('f-period')}
    </div>
    ${casesTable(list)}
    <div class="tfoot"><span>Clique em um processo para editar.</span><span>Nossa parte estimada: <b>${brl(t.nossaParte)}</b> · leads: ${brl(t.custoLead)} · corretores pendentes: ${brl(t.corretorPendente)}</span></div>`;
}
function renderPartners() {
  const all = S.partners.slice().sort((a, b) => (a.ativo === false) - (b.ativo === false) || (a.nome || '').localeCompare(b.nome || ''));
  const ps = all.filter(p => !S.fp || (S.fp === 'associado' ? isAssoc(p) : S.fp === 'estagiario' ? isIntern(p) : (!isAssoc(p) && !isIntern(p))));
  const nAss = all.filter(isAssoc).length, nEst = all.filter(isIntern).length, nPar = all.length - nAss - nEst;
  const ymNow = new Date().toISOString().slice(0, 7);
  const cards = ps.map(p => {
    const t = totals(S.cases.filter(c => c.parceiroId === p.id)), assoc = isAssoc(p), est = isIntern(p);
    const mc = isEmployee(p) ? monthCalc(p, ymNow) : null;
    return `<div class="pcard">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><h3>${esc(p.nome)}</h3><div class="kind ${assoc ? 'assoc' : est ? 'est' : ''}">${est ? 'Estagiário' + (p.curso ? ' · ' + esc(p.curso) : '') : assoc ? 'Advogado associado' + (p.areaAtuacao ? ' ' + esc(p.areaAtuacao) : '') : 'Advogado parceiro'}</div></div>${p.ativo === false ? '<span class="pill off">Inativo</span>' : '<span class="pill ok">Ativo</span>'}</div>
      <div class="firm">${est ? esc(p.instituicao || '') + (p.supervisor ? (p.instituicao ? ' · ' : '') + 'supervisão: ' + esc(p.supervisor) : '') : assoc ? esc(p.especializacao || '') : esc(p.escritorio || '')}${p.oab ? (assoc && p.especializacao || !assoc && !est && p.escritorio ? ' · ' : '') + 'OAB ' + esc(p.oab) : ''}</div>
      <div class="login-id">Login: <code>${esc(p.usuario)}</code> · ${est ? `bolsa ${brl(p.bolsa)}/mês · jornada ${jornadaLabel(jornadaOf(p))}` : assoc ? `salário fixo ${brl(p.salarioFixo)}/mês · bonificação ${num(p.pctBonificacaoPadrao)}% · jornada ${jornadaLabel(jornadaOf(p))}` : `divisão padrão ${num(p.pctParceiroPadrao)}% / ${num(p.pctNossoPadrao)}%`}</div>
      ${est && (p.inicioEstagio || p.fimEstagio) ? `<div class="sub muted" style="font-size:.82rem">Estágio ${p.inicioEstagio ? 'de ' + fmtDate(p.inicioEstagio) : ''}${p.fimEstagio ? ' até ' + fmtDate(p.fimEstagio) : ''}</div>` : ''}
      ${(assoc || est) && p.termos ? `<div class="sub muted" style="font-size:.82rem">${esc(p.termos)}</div>` : ''}
      ${est ? `<div class="stats"><div><span>Horas no mês</span><b>${fmtMin(mc.feito)}</b></div><div><span>Previstas</span><b>${fmtMin(mc.previsto)}</b></div><div><span>Faltas</span><b>${mc.faltas}</b></div><div><span>Atrasos</span><b>${mc.atrasos}</b></div></div>`
      : `<div class="stats"><div><span>Processos</span><b>${t.n}</b></div><div><span>Recebido</span><b>${brlShort(t.recebido)}</b></div><div><span>${assoc ? 'Horas no mês' : 'Pretendido'}</span><b>${assoc ? fmtMin(mc.feito) : brlShort(t.pretendido)}</b></div><div><span>${assoc ? 'Bonificação' : 'Parte do parceiro'}</span><b>${brlShort(t.parteParceiro)}</b></div></div>`}
      <div class="acts"><button class="btn btn-sm" type="button" data-act="edit-partner" data-id="${esc(p.id)}">Editar</button><button class="btn btn-sm" type="button" data-act="reset-partner" data-id="${esc(p.id)}">Nova senha</button><button class="btn btn-sm btn-ghost" type="button" data-act="toggle-partner" data-id="${esc(p.id)}">${p.ativo === false ? 'Reativar' : 'Desativar'}</button></div>
    </div>`;
  }).join('');
  const chip = (v, l) => `<button class="btn btn-sm ${S.fp === v ? 'btn-primary' : ''}" type="button" data-act="fp" data-id="${v}">${l}</button>`;
  return `
    <div class="page-h"><div><h1>Parceiros, associados e estagiários</h1><p>Parceiros dividem honorários por percentual e veem só os próprios processos. Associados têm salário fixo, bonificação e registram horário. Estagiários têm bolsa e acesso somente ao controle de horário.</p></div>
      <div class="toolbar"><button class="btn" type="button" data-act="new-estagiario">+ Novo estagiário</button><button class="btn" type="button" data-act="new-associado">+ Novo associado</button><button class="btn btn-primary" type="button" data-act="new-partner">+ Novo parceiro</button></div></div>
    <div class="toolbar" style="margin-bottom:14px">${chip('', `Todos (${all.length})`)}${chip('parceiro', `Parceiros (${nPar})`)}${chip('associado', `Associados (${nAss})`)}${chip('estagiario', `Estagiários (${nEst})`)}</div>
    ${!S.loaded ? '<div class="empty"><b>Carregando…</b></div>' : (ps.length ? `<div class="partner-grid">${cards}</div>` : `<div class="empty"><b>Nenhum ${S.fp === 'associado' ? 'associado' : S.fp === 'estagiario' ? 'estagiário' : S.fp === 'parceiro' ? 'parceiro' : 'cadastro'}</b>Crie o primeiro login e envie usuário e senha à pessoa.</div>`)}`;
}

/* ============ compra de créditos (só administração) ============ */
function creditMetrics(c) {
  const compra = num(c.valorCompra), receber = num(c.valorReceber);
  const recebido = c.recebido ? num(c.valorRecebido == null || c.valorRecebido === '' ? receber : c.valorRecebido) : 0;
  const lucroPrevisto = receber - compra;
  const lucroRealizado = c.recebido ? recebido - compra : 0;
  const atrasado = !c.recebido && !!c.dataPrevista && c.dataPrevista.slice(0, 10) < todayISO();
  return { compra, receber, recebido, lucroPrevisto, lucroRealizado, atrasado, margem: compra > 0 ? lucroPrevisto / compra * 100 : 0 };
}
/* Linha do tempo dos recebimentos previstos (créditos ainda não recebidos), por mês. */
function creditTimeline(container, credits) {
  const today = todayISO();
  const pend = credits.filter(c => !c.recebido);
  if (!pend.length) { container.innerHTML = `<div class="empty"><b>Nenhum recebimento pendente</b>Os créditos ainda não recebidos aparecem aqui, mês a mês, pela possível data de recebimento.</div>`; return; }
  const now = new Date(), y0 = now.getFullYear(), m0 = now.getMonth();
  const monthIdx = iso => (+iso.slice(0, 4) - y0) * 12 + (+iso.slice(5, 7) - 1 - m0);
  const CAP = 17;
  const mk = (key, label, kind) => ({ key, label, kind, total: 0, items: [] });
  const late = mk('late', 'Atrasados', 'late'), later = mk('later', 'Depois', 'month'), none = mk('none', 'Sem data', 'none');
  let span = 5;
  for (const c of pend) if (c.dataPrevista && c.dataPrevista >= today) span = Math.max(span, Math.min(CAP, monthIdx(c.dataPrevista)));
  const months = [];
  for (let i = 0; i <= span; i++) { const d = new Date(y0, m0 + i, 1); months.push({ ...mk('m' + i, MONTHS[d.getMonth()], 'month'), year: d.getFullYear(), showYear: i === 0 || d.getMonth() === 0, tipLabel: `${MONTHS[d.getMonth()]}/${d.getFullYear()}` }); }
  for (const c of pend) {
    const v = num(c.valorReceber);
    const b = !c.dataPrevista ? none : c.dataPrevista < today ? late : (monthIdx(c.dataPrevista) > CAP ? later : months[monthIdx(c.dataPrevista)]);
    b.total += v; b.items.push(c);
  }
  const cols = [...(late.items.length ? [late] : []), ...months, ...(later.items.length ? [later] : []), ...(none.items.length ? [none] : [])];
  const W = Math.max(280, container.clientWidth || 600), H = 230, padL = 62, padR = 10, padT = 24, padB = 36;
  const maxV = Math.max(1, ...cols.map(c => c.total));
  const mag = Math.pow(10, Math.floor(Math.log10(maxV / 4))), cand = [1, 2, 2.5, 5, 10].map(k => k * mag);
  const step = cand.find(s => maxV / s <= 5) || cand[cand.length - 1];
  const top = Math.ceil(maxV / step) * step;
  const iw = W - padL - padR, ih = H - padT - padB, slot = iw / cols.length, bw = Math.min(28, slot * 0.62);
  const y = v => padT + ih - (v / top) * ih;
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step) g += `<line class="gl" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${v === 0 ? '0' : esc(brlShort(v).replace(/^R\$\s*/, ''))}</text>`;
  let bars = '', labels = '';
  cols.forEach((b, i) => {
    const x0 = padL + slot * i, x = x0 + (slot - bw) / 2, h = (b.total / top) * ih, yy = y(b.total);
    const lines = b.items.slice(0, 4).map(c => `${cnj(c.numeroProcesso)} · ${brl(c.valorReceber)}${c.dataPrevista ? ' · ' + fmtDate(c.dataPrevista) : ''}`);
    const tip = `${esc(b.tipLabel || b.label)}&#10;${b.items.length} crédito${b.items.length === 1 ? '' : 's'} · ${esc(brl(b.total))}${lines.length ? '&#10;' + esc(lines.join('\n')) : ''}${b.items.length > 4 ? `&#10;+ ${b.items.length - 4} outro(s)` : ''}`;
    bars += `<rect class="hit" x="${x0}" y="${padT}" width="${slot}" height="${ih}" data-tip="${tip}"/>`;
    if (b.total > 0) bars += `<path class="col ${b.kind}" d="${roundedTop(x, yy, bw, h, 4)}"/>`;
    if (b.total > 0 && slot >= 54) labels += `<text x="${x + bw / 2}" y="${yy - 6}" text-anchor="middle" style="fill:var(--fg-2);font-weight:600">${esc(brlShort(b.total).replace(/^R\$\s*/, ''))}</text>`;
    const cx = x0 + slot / 2, lab = b.kind === 'month' && b.key !== 'later' ? b.label : (slot >= 54 ? b.label : (b.kind === 'late' ? 'atr.' : b.key === 'later' ? '+' : 's/d'));
    labels += `<text x="${cx}" y="${H - 20}" text-anchor="middle" ${b.kind !== 'month' ? 'style="font-weight:600"' : ''}>${lab}</text>`;
    if (b.showYear) labels += `<text x="${cx}" y="${H - 7}" text-anchor="middle" style="font-size:10px">${b.year}</text>`;
  });
  const totalPend = pend.reduce((s, c) => s + num(c.valorReceber), 0);
  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Recebimentos previstos por mês">${g}<line class="ax" x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}"/>${bars}${labels}</svg>
    <div class="legend" style="margin-top:8px"><span><i style="background:var(--s1)"></i>Previsto no mês</span>${late.items.length ? '<span><i style="background:var(--warn)"></i>Atrasado (data já passou)</span>' : ''}${none.items.length ? '<span><i style="background:var(--muted);opacity:.6"></i>Sem data prevista</span>' : ''}<span style="margin-left:auto">Pendente:&nbsp;<b>${brl(totalPend)}</b>&nbsp;em ${pend.length} crédito${pend.length === 1 ? '' : 's'}</span></div>`;
}
function creditTotals(list) {
  const t = { n: list.length, nRecebidos: 0, investido: 0, aReceber: 0, recebido: 0, lucroPrevisto: 0, lucroRealizado: 0, investidoPendente: 0 };
  for (const c of list) {
    const m = creditMetrics(c);
    t.investido += m.compra; t.lucroPrevisto += m.lucroPrevisto;
    if (c.recebido) { t.nRecebidos++; t.recebido += m.recebido; t.lucroRealizado += m.lucroRealizado; }
    else { t.aReceber += m.receber; t.investidoPendente += m.compra; }
  }
  t.margem = t.investido > 0 ? t.lucroPrevisto / t.investido * 100 : 0;
  return t;
}
function filteredCredits() {
  const f = S.fc, q = f.q.trim().toLowerCase(), qd = q.replace(/\D/g, '');
  return S.credits.filter(c => {
    if (!inPeriod({ dataProtocolo: c.dataCompra }, f.period)) return false;
    if (f.status === 'recebido' && !c.recebido) return false;
    if (f.status === 'pendente' && c.recebido) return false;
    if (q) {
      const hay = [c.numeroProcesso, c.cedente, c.observacoes].join(' ').toLowerCase();
      const hayD = String(c.numeroProcesso || '').replace(/\D/g, '');
      if (!hay.includes(q) && !(qd.length >= 4 && hayD.includes(qd))) return false;
    }
    return true;
  }).sort((a, b) => (b.dataCompra || '').localeCompare(a.dataCompra || '') || (b.criadoEm || '').localeCompare(a.criadoEm || ''));
}
const pctFmt = v => (Math.round(v * 10) / 10).toLocaleString('pt-BR') + '%';
function renderCredits() {
  const list = filteredCredits();
  const t = creditTotals(list);
  const rows = list.map(c => { const m = creditMetrics(c); return `<tr data-credit="${esc(c.id)}" tabindex="0">
    <td><span class="mono">${fmtDate(c.dataCompra)}</span></td>
    <td><span class="mono">${esc(cnj(c.numeroProcesso))}</span>${c.cedente ? `<span class="sub">${esc(c.cedente)}</span>` : ''}</td>
    <td class="num">${brl(m.compra)}</td>
    <td class="num">${brl(m.receber)}</td>
    <td class="num ${m.lucroPrevisto < 0 ? 'neg' : ''}">${brl(m.lucroPrevisto)}<span class="sub">${pctFmt(m.margem)} sobre o investido</span></td>
    <td>${c.recebido ? `<span class="pill ok">Recebido</span><span class="sub">${brl(m.recebido)} em ${fmtDate(c.dataRecebimento)}${c.financeiroRecebimento === 'lancado' ? ' · no financeiro' : ''}</span>`
      : m.atrasado ? `<span class="pill warn">Atrasado</span><span class="sub">previsto para ${fmtDate(c.dataPrevista)}</span>`
      : `<span class="pill wait">A receber</span><span class="sub">${c.dataPrevista ? 'previsto para ' + fmtDate(c.dataPrevista) : 'sem data prevista'}</span>`}</td>
  </tr>`; }).join('');
  const table = !S.loaded ? `<div class="empty"><b>Carregando…</b></div>`
    : !list.length ? `<div class="empty"><b>Nenhuma compra de crédito ${S.credits.length ? 'encontrada com esses filtros' : 'cadastrada ainda'}</b>${S.credits.length ? 'Ajuste a busca ou o período.' : 'Use “Nova compra” para registrar a primeira.'}</div>`
    : `<div class="table-wrap"><table><thead><tr><th>Compra</th><th>Processo · cedente</th><th class="num">Valor comprado</th><th class="num">Valor a receber</th><th class="num">Lucro</th><th>Situação</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  return `
    <div class="page-h"><div><h1>Compra de créditos</h1><p>Créditos judiciais adquiridos pelo escritório. Visível apenas para a administração.</p></div>
      <div class="toolbar">
        ${api.features.export ? '<button class="btn" type="button" data-act="export-credits">Exportar CSV</button>' : ''}
        ${S.canWrite ? '<button class="btn btn-primary" type="button" data-act="new-credit">+ Nova compra</button>' : ''}
      </div></div>
    ${creditsHero(t)}
    <div class="card" style="margin-bottom:14px"><div class="card-h"><h2>Linha do tempo dos recebimentos previstos</h2><small>créditos ainda não recebidos, pela possível data de recebimento</small></div><div class="chart" id="chart-timeline"></div></div>
    <div class="toolbar" style="margin:6px 0 14px">
      <div class="field grow"><input type="text" id="fc-q" data-fc="q" value="${esc(S.fc.q)}" placeholder="Buscar por processo ou cedente…" aria-label="Buscar"></div>
      <select id="fc-status" data-fc="status" aria-label="Situação"><option value="">Qualquer situação</option><option value="pendente" ${S.fc.status === 'pendente' ? 'selected' : ''}>A receber</option><option value="recebido" ${S.fc.status === 'recebido' ? 'selected' : ''}>Recebidos</option></select>
      <select id="fc-period" data-fc="period" aria-label="Período da compra">${[['all', 'Todo o período'], ['year', 'Compras deste ano'], ['12m', 'Últimos 12 meses'], ['30d', 'Últimos 30 dias']].map(([v, l]) => `<option value="${v}" ${S.fc.period === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    ${table}
    <div class="tfoot"><span>Clique em um crédito para editar.</span><span>Lucro = valor a receber − valor comprado. Recebimento parcial pode ser informado ao marcar como recebido.</span></div>`;
}
function creditsHero(t) {
  return `<section class="hero" aria-label="Resumo dos créditos">
      <div><div class="lbl">Lucro previsto</div><div class="val ${t.lucroPrevisto < 0 ? 'neg' : ''}">${brlShort(t.lucroPrevisto)}</div><div class="sub">${t.investido > 0 ? `${pctFmt(t.margem)} sobre ${brl(t.investido)} investidos` : 'Nenhuma compra cadastrada'}</div>
        <div class="meter" aria-hidden="true"><i style="width:${Math.min(100, pct(t.lucroRealizado, t.lucroPrevisto))}%"></i></div></div>
      <div class="hero-side">
        <div><span class="lbl">Investido</span><b>${brlShort(t.investido)}</b><small>${t.n} crédito${t.n === 1 ? '' : 's'}</small></div>
        <div><span class="lbl">A receber</span><b>${brlShort(t.aReceber)}</b><small>${t.n - t.nRecebidos} pendente${t.n - t.nRecebidos === 1 ? '' : 's'} · ${brlShort(t.investidoPendente)} investidos</small></div>
        <div><span class="lbl">Lucro realizado</span><b>${brlShort(t.lucroRealizado)}</b><small>${brlShort(t.recebido)} recebidos em ${t.nRecebidos}</small></div>
      </div>
    </section>`;
}
/* Lançamentos que um crédito gera no financeiro (o servidor aplica a mesma regra). */
function creditFinanceEntries(c) {
  const ref = `Crédito — processo ${cnj(c.numeroProcesso)}${c.cedente ? ' (' + c.cedente + ')' : ''}`;
  return {
    compra: { tipo: 'despesa', categoria: 'Compra de créditos', descricao: `${ref} — aquisição`, valor: round2(c.valorCompra), data: c.dataCompra },
    recebimento: c.recebido ? { tipo: 'receita', categoria: 'Créditos comprados', descricao: `${ref} — recebimento`, valor: round2(c.valorRecebido == null ? c.valorReceber : c.valorRecebido), data: c.dataRecebimento } : null
  };
}
function openCreditForm(c) {
  const isNew = !c;
  const d = c || { dataCompra: todayISO(), recebido: false };
  openSheet(isNew ? 'Nova compra de crédito' : 'Editar compra de crédito', `
    <form id="cr-form" autocomplete="off" novalidate>
      <div class="field"><label for="cr-num">Número do processo <small>(CNJ)</small></label><input type="text" id="cr-num" inputmode="numeric" placeholder="0000000-00.0000.0.00.0000" value="${esc(c?.numeroProcesso || '')}" required></div>
      <div class="row">
        <div class="field"><label for="cr-data">Data da compra</label><input type="date" id="cr-data" value="${esc((d.dataCompra || '').slice(0, 10))}" required></div>
        <div class="field"><label for="cr-dp">Possível data de recebimento <small>(estimativa)</small></label><input type="date" id="cr-dp" value="${esc((c?.dataPrevista || '').slice(0, 10))}"></div>
      </div>
      <div class="field"><label for="cr-ced">Cedente <small>(de quem o crédito foi comprado — opcional)</small></label><input type="text" id="cr-ced" value="${esc(c?.cedente || '')}"></div>
      <div class="row">
        <div class="field"><label for="cr-vc">Valor comprado <small>(R$)</small></label><input type="text" class="money" id="cr-vc" inputmode="decimal" value="${c ? moneyInput(c.valorCompra) : ''}" placeholder="0,00" required></div>
        <div class="field"><label for="cr-vr">Valor a receber <small>(R$)</small></label><input type="text" class="money" id="cr-vr" inputmode="decimal" value="${c ? moneyInput(c.valorReceber) : ''}" placeholder="0,00" required></div>
      </div>
      <fieldset><legend>Recebimento</legend>
        <label class="check" for="cr-rec"><input type="checkbox" id="cr-rec" ${d.recebido ? 'checked' : ''}><span>Valor já recebido<small>Marque quando o crédito for pago</small></span></label>
        <div class="row" id="cr-rec-fields" ${d.recebido ? '' : 'hidden'}>
          <div class="field"><label for="cr-vrec">Valor recebido <small>(R$)</small></label><input type="text" class="money" id="cr-vrec" inputmode="decimal" value="${c && c.recebido ? moneyInput(c.valorRecebido == null ? c.valorReceber : c.valorRecebido) : ''}" placeholder="0,00"></div>
          <div class="field"><label for="cr-drec">Data do recebimento</label><input type="date" id="cr-drec" value="${esc((c?.dataRecebimento || '').slice(0, 10))}"></div>
        </div>
      </fieldset>
      <fieldset><legend>Financeiro</legend>
        ${(c?.financeiroCompra || 'nao') === 'lancado' ? '<p class="hint">A compra já está lançada como despesa no Financeiro.</p>' : `<label class="check" for="cr-lc"><input type="checkbox" id="cr-lc" checked><span>Lançar a compra como despesa<small>categoria “Compra de créditos”, na data da compra</small></span></label>`}
        <div id="cr-fin-rec" ${d.recebido ? '' : 'hidden'}>${(c?.financeiroRecebimento || 'nao') === 'lancado' ? '<p class="hint">O recebimento já está lançado como receita no Financeiro.</p>' : `<label class="check" for="cr-lr"><input type="checkbox" id="cr-lr" checked><span>Lançar o recebimento como receita<small>categoria “Créditos comprados”, na data do recebimento</small></span></label>`}</div>
      </fieldset>
      <div class="field"><label for="cr-obs">Observações</label><textarea id="cr-obs">${esc(c?.observacoes || '')}</textarea></div>
      <div class="summary" id="cr-summary"></div>
      <p class="err" id="cr-err"></p>
      <div class="form-actions">
        ${!isNew ? '<button class="btn btn-danger left" type="button" id="cr-del">Excluir</button>' : ''}
        <button class="btn" type="button" id="cr-cancel">Cancelar</button>
        <button class="btn btn-primary" type="submit" id="cr-save">${isNew ? 'Registrar compra' : 'Salvar alterações'}</button>
      </div>
      <div id="cr-confirm"></div>
    </form>`);
  const f = $('#cr-form'), g = id => $('#' + id, f);
  g('cr-num').addEventListener('blur', () => { g('cr-num').value = cnj(g('cr-num').value); });
  $$('.money', f).forEach(i => i.addEventListener('blur', () => { if (i.value.trim()) i.value = moneyInput(parseMoney(i.value)); }));
  g('cr-rec').addEventListener('change', () => { g('cr-rec-fields').hidden = !g('cr-rec').checked; g('cr-fin-rec').hidden = !g('cr-rec').checked; if (g('cr-rec').checked) { if (!g('cr-vrec').value.trim()) g('cr-vrec').value = g('cr-vr').value; if (!g('cr-drec').value) g('cr-drec').value = todayISO(); } summary(); });
  f.addEventListener('input', summary);
  function collect() {
    return {
      numeroProcesso: cnj(g('cr-num').value), cedente: g('cr-ced').value.trim(), dataCompra: g('cr-data').value, dataPrevista: g('cr-dp').value || null,
      valorCompra: parseMoney(g('cr-vc').value), valorReceber: parseMoney(g('cr-vr').value),
      recebido: g('cr-rec').checked, valorRecebido: g('cr-rec').checked ? parseMoney(g('cr-vrec').value) : null, dataRecebimento: g('cr-rec').checked ? g('cr-drec').value : null,
      observacoes: g('cr-obs').value.trim()
    };
  }
  function summary() {
    const m = creditMetrics(collect());
    g('cr-summary').innerHTML = `<div><div class="lbl">Lucro previsto</div><div class="v">${brl(m.lucroPrevisto)}</div></div><div><div class="lbl">Margem</div><div class="v">${pctFmt(m.margem)}</div></div>${m.recebido ? `<div><div class="lbl">Lucro realizado</div><div class="v">${brl(m.lucroRealizado)}</div></div>` : ''}`;
  }
  summary();
  g('cr-cancel').addEventListener('click', closeSheet);
  g('cr-del')?.addEventListener('click', () => {
    g('cr-confirm').innerHTML = `<div class="confirm"><p>Excluir a compra do crédito <b>${esc(cnj(c.numeroProcesso))}</b>? Esta ação não pode ser desfeita.</p><button class="btn btn-danger btn-sm" type="button" id="cr-del-yes">Excluir definitivamente</button><button class="btn btn-sm" type="button" id="cr-del-no">Manter</button></div>`;
    $('#cr-del-no').addEventListener('click', () => { g('cr-confirm').innerHTML = ''; });
    $('#cr-del-yes').addEventListener('click', async () => { try { await api.deleteCredit(c.id); toast('Crédito excluído.'); closeSheet(); } catch (err) { g('cr-err').textContent = writeError(err); } });
  });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const data = collect(), err = g('cr-err');
    if (!data.numeroProcesso) return err.textContent = 'Informe o número do processo.';
    if (!data.dataCompra) return err.textContent = 'Informe a data da compra.';
    if (!(data.valorCompra > 0)) return err.textContent = 'Informe o valor comprado.';
    if (!(data.valorReceber > 0)) return err.textContent = 'Informe o valor a receber.';
    if (data.recebido && !data.dataRecebimento) return err.textContent = 'Informe a data do recebimento.';
    err.textContent = ''; g('cr-save').disabled = true;
    const opts = { lancarCompra: !!g('cr-lc')?.checked, lancarRecebimento: data.recebido && !!g('cr-lr')?.checked, lancamentos: creditFinanceEntries(data), statusCompra: c?.financeiroCompra || 'nao', statusRecebimento: c?.financeiroRecebimento || 'nao' };
    try {
      if (isNew) { await api.createCredit(data, opts); toast('Compra registrada.'); } else { await api.updateCredit(c.id, data, opts); toast('Alterações salvas.'); }
      closeSheet();
    } catch (e2) { err.textContent = writeError(e2); g('cr-save').disabled = false; }
  });
}
async function exportCreditsCSV() {
  const list = filteredCredits();
  const n = v => num(v).toFixed(2).replace('.', ',');
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = ['Data da compra', 'Número do processo', 'Cedente', 'Valor comprado', 'Valor a receber', 'Lucro previsto', 'Margem %', 'Possível data de recebimento', 'Recebido', 'Valor recebido', 'Data do recebimento', 'Lucro realizado', 'Observações'];
  const rows = list.map(c => { const m = creditMetrics(c); return [fmtDate(c.dataCompra), cnj(c.numeroProcesso), c.cedente || '', n(m.compra), n(m.receber), n(m.lucroPrevisto), n(m.margem), c.dataPrevista ? fmtDate(c.dataPrevista) : '', c.recebido ? 'Sim' : 'Não', c.recebido ? n(m.recebido) : '', c.recebido ? fmtDate(c.dataRecebimento) : '', c.recebido ? n(m.lucroRealizado) : '', c.observacoes || ''].map(q).join(';'); });
  const csv = '﻿' + head.map(q).join(';') + '\r\n' + rows.join('\r\n');
  try { const ok = await api.exportCSV(`compra-de-creditos-${todayISO()}.csv`, csv); if (ok) toast('Arquivo exportado.'); }
  catch (err) { toast(err?.message || 'Não foi possível exportar.', true); }
}


/* ============ contratos de prestação de serviços para empresas (só administração) ============ */
const ymOf = d => String(d || '').slice(0, 7);
const ymLabel = ym => { const [y, m] = ym.split('-'); return `${MONTHS_FULL[+m - 1].toLowerCase()}/${y}`; };
const lastDay = (y, m) => new Date(+y, +m, 0).getDate();
function inVigencia(c, ym) { return ym >= ymOf(c.dataInicio) && (!c.dataFim || ym <= ymOf(c.dataFim)); }
const contractReceipt = (cid, ym) => S.finance.find(e => e.contractId === cid && e.competencia === ym && e.tipo === 'receita');
function contractYear(ano) {
  const now = todayISO().slice(0, 7);
  const months = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`);
  const rows = S.contracts.slice().sort((a, b) => (b.ativo === true) - (a.ativo === true) || (a.empresa || '').localeCompare(b.empresa || '')).map(c => {
    const cells = months.map(ym => { const vig = inVigencia(c, ym); const r = vig ? contractReceipt(c.id, ym) : null; return { ym, vig, r, due: vig && !r && ym <= now, future: vig && !r && ym > now }; });
    const recebido = cells.reduce((s, x) => s + (x.r ? num(x.r.valor) : 0), 0);
    const previsto = cells.filter(x => x.vig).length * num(c.valorMensal);
    const pendente = cells.filter(x => x.due).length * num(c.valorMensal);
    return { c, cells, recebido, previsto, pendente, nRec: cells.filter(x => x.r).length, nDue: cells.filter(x => x.due).length };
  });
  const t = { recebido: 0, previsto: 0, pendente: 0, nDue: 0, n: rows.length, ativos: S.contracts.filter(c => c.ativo !== false && inVigencia(c, now)).length, mrr: S.contracts.filter(c => c.ativo !== false && inVigencia(c, now)).reduce((s, c) => s + num(c.valorMensal), 0) };
  for (const r of rows) { t.recebido += r.recebido; t.previsto += r.previsto; t.pendente += r.pendente; t.nDue += r.nDue; }
  return { months, rows, t };
}
const contractYears = () => Array.from(new Set([String(new Date().getFullYear()), ...S.contracts.flatMap(c => [c.dataInicio, c.dataFim].filter(Boolean).map(d => d.slice(0, 4))), ...S.finance.filter(e => e.contractId).map(e => String(e.data).slice(0, 4))])).sort((a, b) => b.localeCompare(a));
function contractsHero(t, ano) {
  return `<section class="hero" aria-label="Resumo dos contratos">
      <div><div class="lbl">Recebido de contratos em ${ano}</div><div class="val">${brlShort(t.recebido)}</div><div class="sub">${t.previsto > 0 ? `${pct(t.recebido, t.previsto)}% de ${brl(t.previsto)} previstos no ano` : 'Nenhum contrato vigente no ano'}</div>
        <div class="meter" aria-hidden="true"><i style="width:${Math.min(100, pct(t.recebido, t.previsto))}%"></i></div></div>
      <div class="hero-side">
        <div><span class="lbl">Contratos ativos</span><b>${t.ativos}</b><small>${t.n} cadastrado${t.n === 1 ? '' : 's'}</small></div>
        <div><span class="lbl">Receita mensal</span><b>${brlShort(t.mrr)}</b><small>soma dos contratos vigentes</small></div>
        <div><span class="lbl">Em aberto</span><b class="${t.pendente > 0 ? 'neg' : ''}">${brlShort(t.pendente)}</b><small>${t.nDue} mês${t.nDue === 1 ? '' : 'es'} sem recebimento até hoje</small></div>
      </div>
    </section>`;
}
function contractsGrid(y, compact) {
  if (!S.loaded) return `<div class="empty"><b>Carregando…</b></div>`;
  if (!y.rows.length) return `<div class="empty"><b>Nenhum contrato cadastrado</b>Use “+ Novo contrato” para registrar a primeira empresa atendida.</div>`;
  const head = y.months.map(ym => `<th class="num" style="text-align:center">${MONTHS[+ym.slice(5) - 1]}</th>`).join('');
  const rows = y.rows.map(({ c, cells, recebido }) => `<tr>
    <td><button class="btn-link" type="button" data-act="edit-contract" data-id="${esc(c.id)}" style="text-decoration:none;color:var(--fg);font-weight:600">${esc(c.empresa)}</button>${c.ativo === false ? ' <span class="pill off" style="margin-left:4px">Encerrado</span>' : ''}<span class="sub">${esc(c.servico || '')}${c.servico ? ' · ' : ''}${brl(c.valorMensal)}/mês</span></td>
    ${cells.map(x => `<td class="cell ${x.r ? 'ok' : x.due ? 'due' : x.future ? 'wait' : 'off'}" ${x.vig ? `data-ct="${esc(c.id)}" data-ym="${x.ym}" tabindex="0" title="${esc(c.empresa)} — ${ymLabel(x.ym)}"` : ''}>${x.r ? `<b>${brlShort(num(x.r.valor)).replace(/^R\$\s*/, '')}</b>` : x.due ? '<span>em aberto</span>' : x.future ? '<span>previsto</span>' : ''}</td>`).join('')}
    <td class="num"><b>${brl(recebido)}</b></td></tr>`).join('');
  return `<div class="table-wrap grid-ct"><table style="min-width:${compact ? 900 : 1060}px"><thead><tr><th>Empresa · contrato</th>${head}<th class="num">Total ${esc(S.fct.ano)}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function renderContracts() {
  const ano = S.fct.ano, y = contractYear(ano);
  const byCompany = y.rows.filter(r => r.recebido > 0).sort((a, b) => b.recebido - a.recebido);
  const max = byCompany[0]?.recebido || 1;
  return `
    <div class="page-h"><div><h1>Contratos com empresas</h1><p>Prestação de serviços com valor mensal. Cada recebimento registrado aqui entra como receita no Financeiro.</p></div>
      <div class="toolbar">
        <select id="fct-ano" data-fct="ano" aria-label="Ano">${contractYears().map(a => `<option ${a === ano ? 'selected' : ''}>${a}</option>`).join('')}</select>
        ${api.features.export ? '<button class="btn" type="button" data-act="export-contracts">Exportar CSV</button>' : ''}
        ${S.canWrite ? '<button class="btn btn-primary" type="button" data-act="new-contract">+ Novo contrato</button>' : ''}
      </div></div>
    ${contractsHero(y.t, ano)}
    <div class="card-h"><h2>Recebimentos mês a mês</h2><small>clique em um mês para registrar ou corrigir o recebimento</small></div>
    ${contractsGrid(y)}
    <div class="legend" style="margin:10px 0 18px"><span><i style="background:var(--good)"></i>Recebido</span><span><i style="background:var(--warn)"></i>Em aberto (mês já passou)</span><span><i style="background:var(--muted);opacity:.5"></i>Previsto</span></div>
    ${byCompany.length ? `<div class="card" style="margin-bottom:14px"><div class="card-h"><h2>Recebido por empresa em ${ano}</h2><small>${byCompany.length} empresa${byCompany.length === 1 ? '' : 's'}</small></div><div class="barlist">${byCompany.map(r => `<div class="barrow"><div class="n">${esc(r.c.empresa)}</div><div class="v">${brl(r.recebido)} <small>· ${pct(r.recebido, y.t.recebido)}%</small></div><div class="track track-2" data-tip="${esc(r.c.empresa)}&#10;${esc(brl(r.recebido))} em ${r.nRec} mês${r.nRec === 1 ? '' : 'es'}"><i style="width:${pct(r.recebido, max)}%"></i></div></div>`).join('')}</div></div>` : ''}
    <div class="tfoot"><span>Clique no nome da empresa para editar o contrato.</span><span>Previsto = valor mensal × meses de vigência no ano.</span></div>`;
}
function openContractForm(c) {
  const isNew = !c;
  openSheet(isNew ? 'Novo contrato com empresa' : 'Editar contrato', `
    <form id="ct-form" autocomplete="off" novalidate>
      <div class="row">
        <div class="field"><label for="ct-emp">Empresa</label><input type="text" id="ct-emp" value="${esc(c?.empresa || '')}" required></div>
        <div class="field"><label for="ct-cnpj">CNPJ <small>(opcional)</small></label><input type="text" id="ct-cnpj" value="${esc(c?.cnpj || '')}" placeholder="00.000.000/0000-00"></div>
      </div>
      <div class="field"><label for="ct-serv">Serviço contratado</label><input type="text" id="ct-serv" value="${esc(c?.servico || '')}" placeholder="ex.: assessoria jurídica mensal, consultoria trabalhista, defesa em cobranças"></div>
      <div class="row">
        <div class="field"><label for="ct-cont">Contato na empresa <small>(opcional)</small></label><input type="text" id="ct-cont" value="${esc(c?.contato || '')}"></div>
        <div class="field"><label for="ct-dia">Dia de vencimento <small>(opcional)</small></label><input type="number" id="ct-dia" min="1" max="31" value="${c?.diaVencimento || ''}"></div>
      </div>
      <div class="row">
        <div class="field"><label for="ct-val">Valor mensal <small>(R$)</small></label><input type="text" class="money" id="ct-val" inputmode="decimal" value="${c ? moneyInput(c.valorMensal) : ''}" placeholder="0,00" required></div>
        <div class="field"><label for="ct-ini">Início da vigência</label><input type="date" id="ct-ini" value="${esc((c?.dataInicio || todayISO()).slice(0, 10))}" required></div>
        <div class="field"><label for="ct-fim">Término <small>(em branco = vigente)</small></label><input type="date" id="ct-fim" value="${esc((c?.dataFim || '').slice(0, 10))}"></div>
      </div>
      ${!isNew ? `<label class="check" for="ct-ativo"><input type="checkbox" id="ct-ativo" ${c.ativo !== false ? 'checked' : ''}><span>Contrato ativo<small>desmarque para encerrar sem apagar o histórico</small></span></label>` : ''}
      <div class="field"><label for="ct-obs">Observações</label><textarea id="ct-obs">${esc(c?.observacoes || '')}</textarea></div>
      <p class="err" id="ct-err"></p>
      <div class="form-actions">
        ${!isNew ? '<button class="btn btn-danger left" type="button" id="ct-del">Excluir</button>' : ''}
        <button class="btn" type="button" id="ct-cancel">Cancelar</button>
        <button class="btn btn-primary" type="submit" id="ct-save">${isNew ? 'Cadastrar contrato' : 'Salvar alterações'}</button>
      </div>
      <div id="ct-confirm"></div>
    </form>`, { narrow: true });
  const f = $('#ct-form'), g = id => $('#' + id, f);
  $$('.money', f).forEach(i => i.addEventListener('blur', () => { if (i.value.trim()) i.value = moneyInput(parseMoney(i.value)); }));
  g('ct-cancel').addEventListener('click', closeSheet);
  g('ct-del')?.addEventListener('click', () => {
    g('ct-confirm').innerHTML = `<div class="confirm"><p>Excluir o contrato com <b>${esc(c.empresa)}</b>? Os recebimentos já lançados continuam no Financeiro, sem o vínculo.</p><button class="btn btn-danger btn-sm" type="button" id="ct-del-yes">Excluir</button><button class="btn btn-sm" type="button" id="ct-del-no">Manter</button></div>`;
    $('#ct-del-no').addEventListener('click', () => { g('ct-confirm').innerHTML = ''; });
    $('#ct-del-yes').addEventListener('click', async () => { try { await api.deleteContract(c.id); toast('Contrato excluído.'); closeSheet(); } catch (err) { g('ct-err').textContent = writeError(err); } });
  });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const err = g('ct-err');
    const data = { empresa: g('ct-emp').value.trim(), cnpj: g('ct-cnpj').value.trim(), servico: g('ct-serv').value.trim(), contato: g('ct-cont').value.trim(), diaVencimento: g('ct-dia').value ? +g('ct-dia').value : null,
      valorMensal: parseMoney(g('ct-val').value), dataInicio: g('ct-ini').value, dataFim: g('ct-fim').value || null, ativo: isNew ? true : g('ct-ativo').checked, observacoes: g('ct-obs').value.trim() };
    if (!data.empresa) return err.textContent = 'Informe o nome da empresa.';
    if (!(data.valorMensal > 0)) return err.textContent = 'Informe o valor mensal.';
    if (!data.dataInicio) return err.textContent = 'Informe o início da vigência.';
    if (data.dataFim && data.dataFim < data.dataInicio) return err.textContent = 'O término não pode ser anterior ao início.';
    err.textContent = ''; g('ct-save').disabled = true;
    try { if (isNew) { await api.createContract(data); toast('Contrato cadastrado.'); } else { await api.updateContract(c.id, data); toast('Contrato atualizado.'); } closeSheet(); }
    catch (e2) { err.textContent = writeError(e2); g('ct-save').disabled = false; }
  });
}
function openReceiptSheet(c, ym) {
  const r = contractReceipt(c.id, ym), [y, m] = ym.split('-');
  const defDate = ym === todayISO().slice(0, 7) || ym > todayISO().slice(0, 7) ? todayISO() : `${y}-${m}-${String(Math.min(c.diaVencimento || lastDay(y, m), lastDay(y, m))).padStart(2, '0')}`;
  openSheet(`${esc(c.empresa)} — ${ymLabel(ym)}`, `
    <p class="hint">${r ? 'Recebimento já registrado. Ajuste o valor ou a data, ou remova o registro.' : `Registre o recebimento da mensalidade de ${ymLabel(ym)}. Ele entra no Financeiro como receita “Contratos com empresas”.`}</p>
    <form id="rc-form" autocomplete="off" novalidate>
      <div class="row">
        <div class="field"><label for="rc-val">Valor recebido <small>(R$)</small></label><input type="text" class="money" id="rc-val" inputmode="decimal" value="${moneyInput(r ? r.valor : c.valorMensal)}" required></div>
        <div class="field"><label for="rc-data">Data do recebimento</label><input type="date" id="rc-data" value="${esc((r ? r.data : defDate).slice(0, 10))}" required></div>
      </div>
      <div class="field"><label for="rc-obs">Observação <small>(opcional)</small></label><input type="text" id="rc-obs" value="${esc(r?.observacoes || '')}" placeholder="ex.: NF 123, pago com atraso"></div>
      <p class="err" id="rc-err"></p>
      <div class="form-actions">
        ${r ? '<button class="btn btn-danger left" type="button" id="rc-del">Remover recebimento</button>' : ''}
        <button class="btn" type="button" id="rc-cancel">Cancelar</button>
        <button class="btn btn-primary" type="submit" id="rc-save">${r ? 'Salvar' : 'Registrar recebimento'}</button>
      </div>
    </form>`, { narrow: true });
  const f = $('#rc-form'), g = id => $('#' + id, f);
  $$('.money', f).forEach(i => i.addEventListener('blur', () => { if (i.value.trim()) i.value = moneyInput(parseMoney(i.value)); }));
  g('rc-cancel').addEventListener('click', closeSheet);
  g('rc-del')?.addEventListener('click', async () => { try { await api.deleteFinance(r.id); toast('Recebimento removido.'); closeSheet(); } catch (err) { g('rc-err').textContent = writeError(err); } });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const valor = parseMoney(g('rc-val').value), data = g('rc-data').value, err = g('rc-err');
    if (!(valor > 0)) return err.textContent = 'Informe o valor recebido.';
    if (!data) return err.textContent = 'Informe a data.';
    const entry = { tipo: 'receita', categoria: 'Contratos com empresas', descricao: `${c.empresa} — mensalidade de ${ymLabel(ym)}${c.servico ? ' · ' + c.servico : ''}`, valor, data, observacoes: g('rc-obs').value.trim(), contractId: c.id, competencia: ym };
    g('rc-save').disabled = true;
    try { if (r) { await api.updateFinance(r.id, entry); toast('Recebimento atualizado.'); } else { await api.createFinance(entry); toast('Recebimento registrado no Financeiro.'); } closeSheet(); }
    catch (e2) { err.textContent = writeError(e2); g('rc-save').disabled = false; }
  });
}
async function exportContractsCSV() {
  const y = contractYear(S.fct.ano);
  const n = v => num(v).toFixed(2).replace('.', ',');
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = ['Empresa', 'CNPJ', 'Serviço', 'Valor mensal', 'Início', 'Término', 'Ativo', ...y.months.map(ym => MONTHS[+ym.slice(5) - 1] + '/' + ym.slice(0, 4)), 'Total recebido no ano', 'Em aberto'];
  const rows = y.rows.map(({ c, cells, recebido, pendente }) => [c.empresa, c.cnpj || '', c.servico || '', n(c.valorMensal), fmtDate(c.dataInicio), c.dataFim ? fmtDate(c.dataFim) : '', c.ativo === false ? 'Não' : 'Sim', ...cells.map(x => x.r ? n(x.r.valor) : (x.due ? 'em aberto' : '')), n(recebido), n(pendente)].map(q).join(';'));
  const csv = '﻿' + head.map(q).join(';') + '\r\n' + rows.join('\r\n');
  try { const ok = await api.exportCSV(`contratos-empresas-${S.fct.ano}.csv`, csv); if (ok) toast('Arquivo exportado.'); }
  catch (err) { toast(err?.message || 'Não foi possível exportar.', true); }
}

/* ============ financeiro do escritório (só administração) ============ */
const CAT_DESPESA = ['Aluguel', 'Energia', 'Água', 'Internet e telefone', 'Limpeza', 'Funcionários', 'Advogados associados (salário)', 'Estagiários (bolsa)', 'Bonificação de associado', 'Repasse a parceiro', 'Pró-labore', 'Tráfego pago', 'Marketing e conteúdo', 'Sistemas e software', 'Contabilidade', 'Impostos e taxas', 'OAB e anuidades', 'Material de escritório', 'Custas processuais', 'Compra de créditos', 'Deslocamento', 'Outras despesas'];
const CAT_RECEITA = ['Honorários iniciais', 'Alvará de honorários finais', 'Honorários de êxito', 'Honorários de parceria', 'Contratos com empresas', 'Consultoria', 'Repasse de parceria', 'Créditos comprados', 'Outras receitas'];
/* Braço do escritório de cada lançamento (para a visão geral por braço). */
const armOf = e => e.caseId ? 'parcerias' : e.contractId ? 'contratos' : e.creditId ? 'creditos' : 'proprio';
const ARMS = { parcerias: 'Processos e parcerias', contratos: 'Contratos com empresas', creditos: 'Compra de créditos', proprio: 'Honorários próprios e outras' };
/* Salários fixos dos associados do mês selecionado (idempotente: pula quem já tem lançamento na competência). */
/* Salário fixo dos associados e bolsa dos estagiários: uma despesa por pessoa e competência (idempotente). */
const payCat = p => isIntern(p) ? 'Estagiários (bolsa)' : 'Advogados associados (salário)';
const payValue = p => isIntern(p) ? num(p.bolsa) : num(p.salarioFixo);
function pendingSalaries(ym) {
  const [y, m] = ym.split('-'), first = ym + '-01', last = `${ym}-${String(lastDay(y, m)).padStart(2, '0')}`;
  return S.partners.filter(p => isEmployee(p) && p.ativo !== false && payValue(p) > 0
    && (!p.criadoEm || p.criadoEm.slice(0, 10) <= last)
    && (!isIntern(p) || ((!p.inicioEstagio || p.inicioEstagio <= last) && (!p.fimEstagio || p.fimEstagio >= first)))
    && !S.finance.some(e => e.associadoId === p.id && e.competencia === ym && e.categoria === payCat(p)));
}
async function postSalaries(ym) {
  const list = pendingSalaries(ym); if (!list.length) return toast('Salários e bolsas deste mês já estão lançados.');
  const [y, m] = ym.split('-'), data = `${y}-${m}-${String(lastDay(y, m)).padStart(2, '0')}`;
  try {
    for (const p of list) await api.createFinance({ tipo: 'despesa', categoria: payCat(p), descricao: `${isIntern(p) ? 'Bolsa de estágio' : 'Salário fixo'} — ${p.nome}${p.areaAtuacao ? ' (' + p.areaAtuacao + ')' : ''} · ${ymLabel(ym)}`, valor: round2(payValue(p)), data, observacoes: '', associadoId: p.id, competencia: ym });
    toast(`${list.length} lançamento${list.length === 1 ? '' : 's'} de salário/bolsa em ${ymLabel(ym)}.`);
  } catch (err) { toast(writeError(err), true); }
}
const MONTHS_FULL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const financeYears = () => Array.from(new Set([String(new Date().getFullYear()), ...S.finance.map(e => String(e.data || '').slice(0, 4)).filter(y => /^\d{4}$/.test(y))])).sort((a, b) => b.localeCompare(a));
const financeOfYear = ano => S.finance.filter(e => String(e.data || '').startsWith(ano));
const isProv = e => e.status === 'provisionado';
const isLate = e => isProv(e) && String(e.vencimento || e.data).slice(0, 10) < todayISO();
function financeTotals(list) {
  const t = { rec: 0, desp: 0, nRec: 0, nDesp: 0, prov: 0, nProv: 0, atraso: 0, nAtraso: 0 };
  for (const e of list) {
    if (isProv(e)) { t.prov += num(e.valor); t.nProv++; if (isLate(e)) { t.atraso += num(e.valor); t.nAtraso++; } continue; }
    if (e.tipo === 'receita') { t.rec += num(e.valor); t.nRec++; } else { t.desp += num(e.valor); t.nDesp++; }
  }
  t.res = t.rec - t.desp; t.margem = t.rec > 0 ? t.res / t.rec * 100 : 0;
  return t;
}
function financeMonthly(list) {
  const m = Array.from({ length: 12 }, (_, i) => ({ i, rec: 0, desp: 0, n: 0 }));
  for (const e of list) { if (isProv(e)) continue; const mi = +String(e.data).slice(5, 7) - 1; if (mi >= 0 && mi < 12) { m[mi][e.tipo === 'receita' ? 'rec' : 'desp'] += num(e.valor); m[mi].n++; } }
  m.forEach(x => { x.res = x.rec - x.desp; });
  return m;
}
const signed = v => `<span class="${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${v < 0 ? '−' : ''}${brl(Math.abs(v))}</span>`;
function filteredFinance() {
  const f = S.ff, q = f.q.trim().toLowerCase();
  return financeOfYear(f.ano).filter(e => {
    if (f.mes && String(e.data).slice(5, 7) !== f.mes) return false;
    if (f.tipo && e.tipo !== f.tipo) return false;
    if (f.categoria && e.categoria !== f.categoria) return false;
    if (f.sit === 'realizado' && isProv(e)) return false;
    if (f.sit === 'provisionado' && !isProv(e)) return false;
    if (f.sit === 'atraso' && !isLate(e)) return false;
    if (q && ![e.categoria, e.descricao, e.observacoes].join(' ').toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => (b.data || '').localeCompare(a.data || '') || (b.criadoEm || '').localeCompare(a.criadoEm || ''));
}
/* ---- créditos provisionados: parcelas futuras, meses de contrato em aberto e créditos comprados a receber ---- */
function provisionedItems() {
  const today = todayISO(), ym = today.slice(0, 7), items = [];
  for (const e of S.finance) if (isProv(e)) items.push({ kind: 'parcela', id: e.id, origem: e.descricao || e.categoria, natureza: e.categoria, valor: num(e.valor), venc: (e.vencimento || e.data).slice(0, 10), late: isLate(e), ref: e });
  for (const c of S.contracts) {
    if (c.ativo === false) continue;
    let cur = ymOf(c.dataInicio); const end = c.dataFim ? ymOf(c.dataFim) : ym;
    while (cur <= ym && cur <= end) {
      if (!contractReceipt(c.id, cur)) { const [y, m] = cur.split('-'); const venc = `${y}-${m}-${String(Math.min(c.diaVencimento || lastDay(y, m), lastDay(y, m))).padStart(2, '0')}`; items.push({ kind: 'contrato', id: c.id + ':' + cur, origem: `${c.empresa} — mensalidade de ${ymLabel(cur)}`, natureza: 'Contratos com empresas', valor: num(c.valorMensal), venc, late: venc < today, ref: c, ym: cur }); }
      const [y, m] = cur.split('-'); const d = new Date(+y, +m, 1); cur = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
  }
  for (const c of S.credits) if (!c.recebido) items.push({ kind: 'credito', id: c.id, origem: `Crédito — processo ${cnj(c.numeroProcesso)}${c.cedente ? ' (' + c.cedente + ')' : ''}`, natureza: 'Créditos comprados', valor: num(c.valorReceber), venc: c.dataPrevista ? c.dataPrevista.slice(0, 10) : null, late: !!c.dataPrevista && c.dataPrevista.slice(0, 10) < today, ref: c });
  // processos em andamento: a parte do escritório prevista (estimativa — a baixa é feita no próprio processo, ao informar o julgamento e o recebimento)
  for (const c of S.cases) {
    if (resultadoOf(c) !== 'em_andamento') continue;
    const m = metrics(c); if (!(m.nossaParte > 0)) continue;
    const julg = faseOf(c) === 'julgado';
    items.push({ kind: 'processo', id: 'case:' + c.id, origem: `Processo ${numFmt(c)} — ${c.cliente}${isOffice(c) ? ' (escritório)' : ' (' + partnerName(c.parceiroId) + ')'}`, natureza: julg ? 'Honorários da condenação — aguardando recebimento' : 'Honorários previstos — estimativa', valor: round2(m.nossaParte), venc: null, late: false, estimate: !julg, ref: c });
  }
  return items.sort((a, b) => (a.kind === 'processo') - (b.kind === 'processo') || (a.venc || '9999').localeCompare(b.venc || '9999'));
}
const provSplit = items => { const proc = items.filter(x => x.kind === 'processo'), firm = items.filter(x => x.kind !== 'processo'); return { proc, firm, total: items.reduce((s, x) => s + x.valor, 0), firmV: firm.reduce((s, x) => s + x.valor, 0), procV: proc.reduce((s, x) => s + x.valor, 0) }; };
function provisionedBox(compact) {
  const items = provisionedItems(), sp = provSplit(items), total = sp.total, late = items.filter(x => x.late), lateV = late.reduce((s, x) => s + x.valor, 0);
  return `<button class="provbox ${late.length ? 'has-late' : ''}" type="button" data-act="open-prov" title="Ver créditos provisionados e dar baixa">
    <span class="pb-main"><span class="lbl">Créditos provisionados</span><b>${brlShort(total)}</b><small>${items.length} ${items.length === 1 ? 'item' : 'itens'} a receber${sp.proc.length ? ` · ${brlShort(sp.procV)} em ${sp.proc.length} processo${sp.proc.length === 1 ? '' : 's'} (estimativa)` : ''}${compact ? '' : ' · parcelas, contratos, créditos e processos'}</small></span>
    <span class="pb-side">${late.length ? `<span class="pill warn">Em atraso: ${brlShort(lateV)}</span><small>${late.length} vencido${late.length === 1 ? '' : 's'}</small>` : '<span class="pill ok">Nada em atraso</span>'}<span class="pb-cta">Ver e dar baixa →</span></span>
  </button>`;
}
function openProvisionedSheet() {
  const items = provisionedItems(), sp = provSplit(items);
  const total = sp.total;
  const procRows = sp.proc.map(x => `<div class="prov-row proc">
    <span class="pr-main"><b>${esc(x.origem)}</b><small>${esc(x.natureza)} · ${faseOf(x.ref) === 'julgado' ? 'julgado' : 'em curso'}${isOffice(x.ref) ? (x.ref.pctHonorarios != null ? ` · ${num(x.ref.pctHonorarios)}% de ${brl(honBase(x.ref))}` : '') : ` · ${num(x.ref.pctNosso)}% de ${brl(num(x.ref.honorariosPretendidos))}`}</small></span>
    <span class="pr-side"><b>${brl(x.valor)}</b><button class="btn btn-sm" type="button" data-pv-case="${esc(x.ref.id)}">${faseOf(x.ref) === 'julgado' ? 'Informar recebimento' : 'Informar resultado'}</button></span></div>`).join('');
  const rows = sp.firm.map(x => `<label class="prov-row ${x.late ? 'late' : ''}" for="pv-${esc(x.id)}">
    <input type="checkbox" id="pv-${esc(x.id)}" data-pv="${esc(x.id)}">
    <span class="pr-main"><b>${esc(x.origem)}</b><small>${esc(x.natureza)} · ${x.kind === 'parcela' ? 'parcela' + (x.ref.parcela ? ' ' + esc(x.ref.parcela) : '') : x.kind === 'contrato' ? 'mensalidade de contrato' : 'crédito comprado'}</small></span>
    <span class="pr-side"><b>${brl(x.valor)}</b><small>${x.venc ? (x.late ? '<span class="neg">venceu em ' + fmtDate(x.venc) + '</span>' : 'vence em ' + fmtDate(x.venc)) : 'sem data prevista'}</small></span></label>`).join('');
  openSheet('Créditos provisionados', `
    <p class="hint">Valores que o escritório tem a receber e ainda não entraram. Marque o que já foi recebido e confirme: cada item vira receita realizada no Financeiro.</p>
    ${items.length ? `<div class="summary" style="margin-bottom:12px"><div><div class="lbl">Total provisionado</div><div class="v">${brl(total)}</div></div><div><div class="lbl">Em atraso</div><div class="v neg">${brl(items.filter(x => x.late).reduce((s, x) => s + x.valor, 0))}</div></div><div><div class="lbl">Processos (estimativa)</div><div class="v">${brl(sp.procV)}</div></div></div>
    ${sp.firm.length ? `<div class="row" style="margin-bottom:8px"><div class="field"><label for="pv-data">Data do recebimento <small>(aplicada aos itens marcados)</small></label><input type="date" id="pv-data" value="${todayISO()}"></div><div class="field" style="justify-content:flex-end"><button class="btn btn-sm" type="button" id="pv-all">Marcar todos os vencidos</button></div></div>
    <div class="prov-list">${rows}</div>` : '<p class="hint">Nenhuma parcela, mensalidade ou crédito comprado pendente.</p>'}
    ${sp.proc.length ? `<div class="card-h" style="margin-top:14px"><h2>Processos em andamento</h2><small>${sp.proc.length} · ${brl(sp.procV)} previstos</small></div>
    <p class="hint">Previsão da parte do escritório (valor pretendido × nossa %). O valor final pode ser maior ou menor: a baixa é feita no próprio processo — marque <b>Julgado</b>, informe o valor da condenação e, quando o dinheiro entrar, <b>Finalizado e recebido</b> com quanto recebemos.</p>
    <div class="prov-list">${procRows}</div>` : ''}
    <p class="err" id="pv-err"></p>
    <div class="form-actions"><button class="btn" type="button" id="pv-cancel">Fechar</button>${sp.firm.length ? '<button class="btn btn-primary" type="button" id="pv-ok" disabled>Confirmar recebimento</button>' : ''}</div>`
    : `<div class="empty"><b>Nenhum crédito provisionado</b>Parcelas futuras de receitas, mensalidades de contratos em aberto, créditos comprados a receber e honorários previstos de processos em andamento aparecem aqui.</div><div class="form-actions"><button class="btn" type="button" id="pv-cancel">Fechar</button></div>`}`);
  $('#pv-cancel').addEventListener('click', closeSheet);
  const sheet = $('#sheet-b'); if (!items.length) return;
  sheet.addEventListener('click', e => { const b = e.target.closest('[data-pv-case]'); if (!b) return; const cs = S.cases.find(x => x.id === b.dataset.pvCase); if (cs) { closeSheet(); openCaseForm(cs); } });
  if (!sp.firm.length) return;
  const checked = () => $$('input[data-pv]:checked', sheet).map(i => sp.firm.find(x => x.id === i.dataset.pv)).filter(Boolean);
  const refresh = () => { const c = checked(); $('#pv-ok').disabled = !c.length; $('#pv-ok').textContent = c.length ? `Confirmar recebimento de ${brl(c.reduce((s, x) => s + x.valor, 0))} (${c.length})` : 'Confirmar recebimento'; };
  sheet.addEventListener('change', e => { if (e.target.matches('input[data-pv]')) refresh(); });
  $('#pv-all').addEventListener('click', () => { sp.firm.filter(x => x.late).forEach(x => { const i = sheet.querySelector(`input[data-pv="${CSS.escape(x.id)}"]`); if (i) i.checked = true; }); refresh(); });
  $('#pv-ok').addEventListener('click', async () => {
    const list = checked(), data = $('#pv-data').value || todayISO(), err = $('#pv-err'); $('#pv-ok').disabled = true;
    try {
      for (const x of list) {
        if (x.kind === 'parcela') await api.updateFinance(x.ref.id, { tipo: 'receita', categoria: x.ref.categoria, descricao: x.ref.descricao, valor: x.ref.valor, data, observacoes: x.ref.observacoes || '', status: 'realizado', vencimento: x.ref.vencimento, parcela: x.ref.parcela, grupoId: x.ref.grupoId, caseId: x.ref.caseId, contractId: x.ref.contractId, competencia: x.ref.competencia, creditId: x.ref.creditId, associadoId: x.ref.associadoId });
        else if (x.kind === 'contrato') await api.createFinance({ tipo: 'receita', categoria: 'Contratos com empresas', descricao: `${x.ref.empresa} — mensalidade de ${ymLabel(x.ym)}${x.ref.servico ? ' · ' + x.ref.servico : ''}`, valor: x.valor, data, observacoes: '', contractId: x.ref.id, competencia: x.ym });
        else if (x.kind === 'credito') { const d = { ...x.ref, recebido: true, valorRecebido: x.valor, dataRecebimento: data }; delete d.id; await api.updateCredit(x.ref.id, d, { lancarRecebimento: true, lancamentos: creditFinanceEntries(d), statusCompra: x.ref.financeiroCompra || 'nao', statusRecebimento: x.ref.financeiroRecebimento || 'nao' }); }
      }
      toast(`${list.length} recebimento${list.length === 1 ? '' : 's'} confirmado${list.length === 1 ? '' : 's'}.`); closeSheet();
    } catch (e2) { err.textContent = writeError(e2); $('#pv-ok').disabled = false; }
  });
}
function categoryList(list, tipo) {
  const by = new Map();
  for (const e of list) if (e.tipo === tipo && !isProv(e)) by.set(e.categoria, (by.get(e.categoria) || 0) + num(e.valor));
  const rows = Array.from(by, ([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v).slice(0, 10);
  if (!rows.length) return `<div class="empty"><b>Nenhuma ${tipo} lançada</b>Use “+ ${tipo === 'receita' ? 'Receita' : 'Despesa'}” para registrar a primeira.</div>`;
  const total = rows.reduce((s, r) => s + r.v, 0), max = rows[0].v;
  return `<div class="barlist">${rows.map(r => `<div class="barrow"><div class="n" title="${esc(r.k)}">${esc(r.k)}</div><div class="v">${brl(r.v)} <small>· ${pct(r.v, total)}%</small></div>
    <div class="track ${tipo === 'despesa' ? 'track-2' : ''}" data-tip="${esc(r.k)}&#10;${esc(brl(r.v))} · ${pct(r.v, total)}% das ${tipo}s"><i style="width:${pct(r.v, max)}%"></i></div></div>`).join('')}</div>`;
}
function renderFinance() {
  const ano = S.ff.ano, year = financeOfYear(ano), t = financeTotals(year), monthly = financeMonthly(year);
  const withData = monthly.filter(m => m.n > 0);
  const mediaRes = withData.length ? withData.reduce((s, m) => s + m.res, 0) / withData.length : 0;
  const cats = Array.from(new Set(year.map(e => e.categoria))).sort();
  const entries = filteredFinance();
  const ft = financeTotals(entries);
  let acc = 0; const lastWithData = Math.max(-1, ...monthly.filter(m => m.n).map(m => m.i));
  const monthRows = monthly.map(m => { acc += m.res; return `<tr data-fmes="${String(m.i + 1).padStart(2, '0')}" tabindex="0" ${S.ff.mes === String(m.i + 1).padStart(2, '0') ? 'style="background:var(--gold-wash)"' : ''}>
    <td>${MONTHS_FULL[m.i]}${m.n ? `<span class="sub">${m.n} lançamento${m.n === 1 ? '' : 's'}</span>` : '<span class="sub muted">—</span>'}</td>
    <td class="num">${m.n ? brl(m.rec) : '<span class="muted">—</span>'}</td><td class="num">${m.n ? brl(m.desp) : '<span class="muted">—</span>'}</td>
    <td class="num">${m.n ? signed(m.res) : '<span class="muted">—</span>'}</td><td class="num">${m.i <= lastWithData ? signed(acc) : '<span class="muted">—</span>'}</td></tr>`; }).join('');
  const entryRows = entries.map(e => `<tr data-fin="${esc(e.id)}" tabindex="0">
    <td><span class="mono">${fmtDate(e.data)}</span></td>
    <td><span class="pill ${e.tipo === 'receita' ? 'rec' : 'desp'}">${e.tipo === 'receita' ? 'Receita' : 'Despesa'}</span>${isProv(e) ? (isLate(e) ? '<span class="pill warn" style="margin-left:4px">Em atraso</span>' : '<span class="pill wait" style="margin-left:4px">Provisionado</span>') : ''}${e.parcela ? `<span class="sub">parcela ${esc(e.parcela)}${e.vencimento ? ' · venc. ' + fmtDate(e.vencimento) : ''}</span>` : ''}</td>
    <td>${esc(e.categoria)}${e.caseId ? ` <span class="tag jud" title="${esc(caseTitle(e.caseId))}">PROCESSO</span>` : e.contractId ? ' <span class="tag adm" title="Mensalidade de contrato com empresa">CONTRATO</span>' : e.creditId ? ' <span class="tag" title="Compra de crédito">CRÉDITO</span>' : e.associadoId ? (isIntern(partnerById(e.associadoId)) ? ' <span class="tag" title="Estagiário">ESTAGIÁRIO</span>' : ' <span class="tag" title="Advogado associado">ASSOCIADO</span>') : ''}${e.descricao ? `<span class="sub">${esc(e.descricao)}</span>` : ''}</td>
    <td class="num ${isProv(e) ? 'muted' : ''}">${e.tipo === 'receita' ? '' : '− '}${brl(e.valor)}</td></tr>`).join('');
  return `
    <div class="page-h"><div><h1>Financeiro do escritório</h1><p>Receitas e despesas mês a mês. Visível apenas para a administração.</p></div>
      <div class="toolbar">
        <select id="ff-ano" data-ff="ano" aria-label="Ano">${financeYears().map(y => `<option ${y === ano ? 'selected' : ''}>${y}</option>`).join('')}</select>
        ${api.features.export ? '<button class="btn" type="button" data-act="export-finance">Exportar CSV</button>' : ''}
        ${S.canWrite ? '<button class="btn" type="button" data-act="new-receita">+ Receita</button><button class="btn btn-primary" type="button" data-act="new-despesa">+ Despesa</button>' : ''}
      </div></div>
    <section class="hero" aria-label="Resultado do ano">
      <div><div class="lbl">${t.res < 0 ? 'Prejuízo' : 'Lucro'} em ${ano}</div><div class="val ${t.res < 0 ? 'neg' : ''}">${t.res < 0 ? '−' : ''}${brlShort(Math.abs(t.res))}</div>
        <div class="sub">${year.length ? `${brl(t.rec)} de receitas − ${brl(t.desp)} de despesas` : 'Nenhum lançamento neste ano ainda'}</div>
        <div class="meter" aria-hidden="true"><i style="width:${t.rec > 0 ? Math.min(100, pct(t.desp, t.rec)) : 0}%"></i></div><div class="sub" style="margin-top:4px">${t.rec > 0 ? `as despesas consomem ${pct(t.desp, t.rec)}% das receitas` : ''}</div></div>
      <div class="hero-side">
        <div><span class="lbl">Receitas</span><b>${brlShort(t.rec)}</b><small>${t.nRec} lançamento${t.nRec === 1 ? '' : 's'}</small></div>
        <div><span class="lbl">Despesas</span><b>${brlShort(t.desp)}</b><small>${t.nDesp} lançamento${t.nDesp === 1 ? '' : 's'}</small></div>
        <div><span class="lbl">Margem</span><b class="${t.res < 0 ? 'neg' : ''}">${t.rec > 0 ? pctFmt(t.margem) : '—'}</b><small>média mensal ${mediaRes < 0 ? '−' : ''}${brlShort(Math.abs(mediaRes))}</small></div>
      </div>
    </section>
    ${provisionedBox()}
    <div class="card" style="margin-bottom:12px"><div class="card-h"><h2>Receitas × despesas por mês</h2><small>${ano} · só valores realizados · a linha é o resultado do mês</small></div><div class="chart" id="chart-finance"></div></div>
    <div class="grid-2">
      <div class="card"><div class="card-h"><h2>Despesas por categoria</h2><small>${ano}</small></div>${categoryList(year, 'despesa')}</div>
      <div class="card"><div class="card-h"><h2>Receitas por categoria</h2><small>${ano}</small></div>${categoryList(year, 'receita')}</div>
    </div>
    <div class="card-h"><h2>Mês a mês</h2><small>clique em um mês para ver os lançamentos</small></div>
    <div class="table-wrap" style="margin-bottom:18px"><table><thead><tr><th>Mês</th><th class="num">Receitas</th><th class="num">Despesas</th><th class="num">Resultado</th><th class="num">Acumulado</th></tr></thead><tbody>${monthRows}</tbody>
      <tfoot><tr><td><b>Total ${ano}</b></td><td class="num"><b>${brl(t.rec)}</b></td><td class="num"><b>${brl(t.desp)}</b></td><td class="num"><b>${signed(t.res)}</b></td><td></td></tr></tfoot></table></div>
    <div class="card-h" id="fin-entries"><h2>Lançamentos${S.ff.mes ? ' de ' + MONTHS_FULL[+S.ff.mes - 1].toLowerCase() : ''}</h2><small>${entries.length} · receitas ${brl(ft.rec)} · despesas ${brl(ft.desp)}${S.ff.mes && S.canWrite && pendingSalaries(ano + '-' + S.ff.mes).length ? ` · <button class="btn-link" type="button" data-act="post-salaries">lançar salários e bolsas (${pendingSalaries(ano + '-' + S.ff.mes).length})</button>` : ''}</small></div>
    <div class="toolbar" style="margin-bottom:12px">
      <div class="field grow"><input type="text" id="ff-q" data-ff="q" value="${esc(S.ff.q)}" placeholder="Buscar por categoria ou descrição…" aria-label="Buscar"></div>
      <select id="ff-mes" data-ff="mes" aria-label="Mês"><option value="">Todos os meses</option>${MONTHS_FULL.map((n, i) => `<option value="${String(i + 1).padStart(2, '0')}" ${S.ff.mes === String(i + 1).padStart(2, '0') ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <select id="ff-tipo" data-ff="tipo" aria-label="Tipo"><option value="">Receitas e despesas</option><option value="receita" ${S.ff.tipo === 'receita' ? 'selected' : ''}>Só receitas</option><option value="despesa" ${S.ff.tipo === 'despesa' ? 'selected' : ''}>Só despesas</option></select>
      <select id="ff-cat" data-ff="categoria" aria-label="Categoria"><option value="">Todas as categorias</option>${cats.map(c => `<option ${S.ff.categoria === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select id="ff-sit" data-ff="sit" aria-label="Situação"><option value="">Realizados e provisionados</option><option value="realizado" ${S.ff.sit === 'realizado' ? 'selected' : ''}>Só realizados</option><option value="provisionado" ${S.ff.sit === 'provisionado' ? 'selected' : ''}>Só provisionados</option><option value="atraso" ${S.ff.sit === 'atraso' ? 'selected' : ''}>Em atraso</option></select>
    </div>
    ${!S.loaded ? '<div class="empty"><b>Carregando…</b></div>' : entries.length ? `<div class="table-wrap"><table style="min-width:640px"><thead><tr><th>Data</th><th>Tipo</th><th>Categoria · descrição</th><th class="num">Valor</th></tr></thead><tbody>${entryRows}</tbody></table></div>` : `<div class="empty"><b>Nenhum lançamento ${year.length ? 'com esses filtros' : 'em ' + ano}</b>${year.length ? 'Ajuste os filtros.' : 'Registre receitas e despesas com os botões acima.'}</div>`}
    <div class="tfoot"><span>Clique em um lançamento para editar.</span><span>Resultado = receitas − despesas. Margem = resultado ÷ receitas.</span></div>`;
}
function financeChart(container, monthly) {
  const W = Math.max(280, container.clientWidth || 600), H = 250, padL = 62, padR = 10, padT = 18, padB = 30;
  const maxV = Math.max(1, ...monthly.map(m => Math.max(m.rec, m.desp, m.res)));
  const minV = Math.min(0, ...monthly.map(m => m.res));
  const range = maxV - minV;
  const mag = Math.pow(10, Math.floor(Math.log10(range / 4))), cand = [1, 2, 2.5, 5, 10].map(k => k * mag);
  const step = cand.find(s => range / s <= 6) || cand[cand.length - 1];
  const top = Math.ceil(maxV / step) * step, bottom = Math.floor(minV / step) * step;
  const iw = W - padL - padR, ih = H - padT - padB, slot = iw / 12, gw = Math.min(46, slot * 0.72), bw = (gw - 2) / 2;
  const y = v => padT + (top - v) / (top - bottom) * ih;
  let g = '';
  for (let v = bottom; v <= top + 1e-9; v += step) g += `<line class="gl" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${v === 0 ? '0' : (v < 0 ? '−' : '') + esc(brlShort(Math.abs(v)).replace(/^R\$\s*/, ''))}</text>`;
  let bars = '', marks = '', labels = '';
  const pts = [];
  monthly.forEach((m, i) => {
    const x0 = padL + slot * i, gx = x0 + (slot - gw) / 2, cx = x0 + slot / 2;
    const tip = `${MONTHS_FULL[m.i]}&#10;${m.n ? `Receitas ${esc(brl(m.rec))}&#10;Despesas ${esc(brl(m.desp))}&#10;Resultado ${m.res < 0 ? '−' : ''}${esc(brl(Math.abs(m.res)))}` : 'Sem lançamentos'}`;
    bars += `<rect class="hit" x="${x0}" y="${padT}" width="${slot}" height="${ih}" data-tip="${tip}"/>`;
    if (m.rec > 0) bars += `<path class="col" d="${roundedTop(gx, y(m.rec), bw, y(0) - y(m.rec), 3)}"/>`;
    if (m.desp > 0) bars += `<path class="col s2" d="${roundedTop(gx + bw + 2, y(m.desp), bw, y(0) - y(m.desp), 3)}"/>`;
    if (m.n) pts.push({ x: cx, y: y(m.res), res: m.res });
    labels += `<text x="${cx}" y="${H - 9}" text-anchor="middle">${MONTHS[m.i]}</text>`;
  });
  if (pts.length > 1) marks += `<polyline points="${pts.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="var(--fg-2)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" pointer-events="none"/>`;
  for (const p of pts) marks += `<circle cx="${p.x}" cy="${p.y}" r="4.5" fill="${p.res < 0 ? 'var(--bad)' : 'var(--good)'}" stroke="var(--surface)" stroke-width="2" pointer-events="none"/>`;
  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Receitas e despesas por mês">${g}<line class="ax" x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}"/>${bars}${marks}${labels}</svg>
    <div class="legend" style="margin-top:8px"><span><i style="background:var(--s1)"></i>Receitas</span><span><i style="background:var(--s2)"></i>Despesas</span><span><i style="background:var(--good);border-radius:50%"></i>Resultado positivo</span><span><i style="background:var(--bad);border-radius:50%"></i>Resultado negativo</span></div>`;
}
function openFinanceForm(e, presetTipo, prefill) {
  const isNew = !e;
  const tipo = e ? e.tipo : (presetTipo || 'despesa');
  const pf = prefill || {};
  const now = todayISO();
  const defData = S.ff.mes && (S.ff.ano + '-' + S.ff.mes) !== now.slice(0, 7) ? `${S.ff.ano}-${S.ff.mes}-01` : now;
  const catsOf = tp => Array.from(new Set([...(tp === 'receita' ? CAT_RECEITA : CAT_DESPESA), ...S.finance.filter(x => x.tipo === tp).map(x => x.categoria)]));
  openSheet(isNew ? (tipo === 'receita' ? 'Nova receita' : 'Nova despesa') : 'Editar lançamento', `
    <form id="fn-form" autocomplete="off" novalidate>
      <div class="row" style="margin-bottom:12px">
        <label class="check" for="fn-t-rec" style="margin:0"><input type="radio" name="fn-tipo" id="fn-t-rec" value="receita" ${tipo === 'receita' ? 'checked' : ''}><span>Receita<small>honorários, alvarás, consultoria…</small></span></label>
        <label class="check" for="fn-t-desp" style="margin:0"><input type="radio" name="fn-tipo" id="fn-t-desp" value="despesa" ${tipo === 'despesa' ? 'checked' : ''}><span>Despesa<small>aluguel, energia, equipe, tráfego…</small></span></label>
      </div>
      <div class="row">
        <div class="field"><label for="fn-cat">Categoria</label><input type="text" id="fn-cat" list="fn-cats" value="${esc(e?.categoria || pf.categoria || '')}" placeholder="Escolha ou digite" required><datalist id="fn-cats">${catsOf(tipo).map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist></div>
        <div class="field"><label for="fn-data">Data <small>(mês de competência)</small></label><input type="date" id="fn-data" value="${esc((e?.data || defData).slice(0, 10))}" required></div>
      </div>
      <div class="row">
        <div class="field"><label for="fn-valor" id="fn-valor-label">Valor ${isNew ? 'total ' : ''}<small>(R$)</small></label><input type="text" class="money" id="fn-valor" inputmode="decimal" value="${e ? moneyInput(e.valor) : pf.valor ? moneyInput(pf.valor) : ''}" placeholder="0,00" required></div>
        <div class="field"><label for="fn-desc">Descrição <small>(opcional)</small></label><input type="text" id="fn-desc" value="${esc(e?.descricao || pf.descricao || '')}" placeholder="ex.: cliente, fornecedor, referência"></div>
      </div>
      <div class="field"><label for="fn-case">Processo relacionado <small>(opcional — ex.: honorários iniciais, custas)</small></label><select id="fn-case"><option value="">Nenhum</option>${caseOptions(e?.caseId || pf.caseId || null)}</select></div>
      ${isNew ? `<fieldset id="fn-pay" ${tipo === 'receita' ? '' : 'hidden'}><legend>Forma de recebimento</legend>
        <div class="row" style="margin-bottom:10px">
          <label class="check" for="fn-pv" style="margin:0"><input type="radio" name="fn-forma" id="fn-pv" value="vista" checked><span>À vista<small>recebido na data informada</small></span></label>
          <label class="check" for="fn-pp" style="margin:0"><input type="radio" name="fn-forma" id="fn-pp" value="parcelado"><span>Parcelado<small>parcelas futuras ficam provisionadas</small></span></label>
        </div>
        <div id="fn-parc" hidden>
          <div class="row">
            <div class="field"><label for="fn-np">Número de parcelas</label><input type="number" id="fn-np" min="2" max="60" value="${pf.parcelas || 3}"></div>
            <div class="field"><label for="fn-d1">Vencimento da 1ª parcela</label><input type="date" id="fn-d1" value="${esc((e?.data || defData).slice(0, 10))}"></div>
            <div class="field"><label for="fn-vp">Valor de cada parcela <small>(R$)</small></label><input type="text" class="money" id="fn-vp" inputmode="decimal" readonly></div>
          </div>
          <label class="check" for="fn-p1"><input type="checkbox" id="fn-p1" checked><span>1ª parcela já recebida<small>as demais entram como créditos provisionados, com vencimento mensal</small></span></label>
          <p class="hint" id="fn-parc-hint"></p>
        </div>
      </fieldset>` : (isProv(e) ? `<div class="note">Lançamento provisionado${e.parcela ? ' (parcela ' + esc(e.parcela) + ')' : ''}${e.vencimento ? ', vencimento em ' + fmtDate(e.vencimento) : ''}. <label class="check" for="fn-realizar" style="margin:8px 0 0"><input type="checkbox" id="fn-realizar"><span>Marcar como recebido na data informada acima</span></label></div>` : '')}
      <div class="field"><label for="fn-obs">Observações</label><textarea id="fn-obs">${esc(e?.observacoes || '')}</textarea></div>
      <p class="err" id="fn-err"></p>
      <div class="form-actions">
        ${!isNew ? '<button class="btn btn-danger left" type="button" id="fn-del">Excluir</button>' : ''}
        <button class="btn" type="button" id="fn-cancel">Cancelar</button>
        <button class="btn btn-primary" type="submit" id="fn-save">${isNew ? 'Registrar' : 'Salvar alterações'}</button>
        ${isNew ? '<button class="btn" type="button" id="fn-save-more" title="Salva e abre outro lançamento igual">Salvar e novo</button>' : ''}
      </div>
      <div id="fn-confirm"></div>
    </form>`, { narrow: true });
  const f = $('#fn-form'), g = id => $('#' + id, f);
  const curTipo = () => f.querySelector('input[name="fn-tipo"]:checked').value;
  f.querySelectorAll('input[name="fn-tipo"]').forEach(r => r.addEventListener('change', () => { $('#fn-cats', f).innerHTML = catsOf(curTipo()).map(c => `<option value="${esc(c)}"></option>`).join(''); $('#sheet-title').textContent = isNew ? (curTipo() === 'receita' ? 'Nova receita' : 'Nova despesa') : 'Editar lançamento'; if (g('fn-pay')) g('fn-pay').hidden = curTipo() !== 'receita'; }));
  $$('.money', f).forEach(i => i.addEventListener('blur', () => { if (i.value.trim()) i.value = moneyInput(parseMoney(i.value)); }));
  const curForma = () => isNew && curTipo() === 'receita' && f.querySelector('input[name="fn-forma"]:checked')?.value === 'parcelado' ? 'parcelado' : 'vista';
  const plan = () => { const total = parseMoney(g('fn-valor').value), n = Math.max(2, Math.min(60, Math.round(num(g('fn-np')?.value) || 2))); const base = Math.floor(total / n * 100) / 100; const vals = Array.from({ length: n }, (_, i) => i === n - 1 ? round2(total - base * (n - 1)) : base); return { total, n, vals }; };
  const refreshPlan = () => { if (!g('fn-parc')) return; const par = curForma() === 'parcelado'; g('fn-parc').hidden = !par; if (!par) return; const { n, vals } = plan(); g('fn-vp').value = moneyInput(vals[0]); const d1 = g('fn-d1').value; g('fn-parc-hint').textContent = d1 ? `${n} parcelas de ${brl(vals[0])}${vals[n - 1] !== vals[0] ? ' (última de ' + brl(vals[n - 1]) + ')' : ''}, vencendo todo dia ${+d1.slice(8, 10)} a partir de ${fmtDate(d1)}.` : 'Informe o vencimento da 1ª parcela.'; };
  f.querySelectorAll('input[name="fn-forma"]').forEach(r => r.addEventListener('change', refreshPlan));
  f.addEventListener('input', refreshPlan); refreshPlan();
  const collect = () => ({ tipo: curTipo(), categoria: g('fn-cat').value.trim(), descricao: g('fn-desc').value.trim(), valor: parseMoney(g('fn-valor').value), data: g('fn-data').value, observacoes: g('fn-obs').value.trim(), caseId: g('fn-case').value || null });
  g('fn-case').addEventListener('change', () => { const cs = S.cases.find(x => x.id === g('fn-case').value); if (cs && !g('fn-desc').value.trim()) g('fn-desc').value = `${cs.cliente} — processo ${numFmt(cs)}`; });
  const addMonths = (iso, k) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(y, m - 1 + k, 1); const dd = Math.min(d, lastDay(t.getFullYear(), String(t.getMonth() + 1).padStart(2, '0'))); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`; };
  async function save(andNew) {
    const data = collect(), err = g('fn-err');
    if (!data.categoria) return err.textContent = 'Informe a categoria.';
    if (!(data.valor > 0)) return err.textContent = 'Informe um valor maior que zero.';
    if (!data.data) return err.textContent = 'Informe a data.';
    err.textContent = ''; g('fn-save').disabled = true;
    try {
      if (isNew && curForma() === 'parcelado') {
        const d1 = g('fn-d1').value; if (!d1) { err.textContent = 'Informe o vencimento da 1ª parcela.'; g('fn-save').disabled = false; return; }
        const { n, vals } = plan(), grupoId = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), primeira = g('fn-p1').checked;
        for (let k = 0; k < n; k++) {
          const venc = addMonths(d1, k), realizado = k === 0 && primeira;
          await api.createFinance({ ...data, valor: vals[k], data: realizado ? data.data : venc, status: realizado ? 'realizado' : 'provisionado', vencimento: venc, parcela: `${k + 1}/${n}`, grupoId, descricao: `${data.descricao || data.categoria} (parcela ${k + 1}/${n})` });
        }
        toast(`${n} parcelas registradas: ${primeira ? '1 recebida e ' + (n - 1) : n} provisionada${(primeira ? n - 1 : n) === 1 ? '' : 's'}.`);
      } else if (isNew) { await api.createFinance(data); toast(data.tipo === 'receita' ? 'Receita registrada.' : 'Despesa registrada.'); }
      else {
        const realizar = !!g('fn-realizar')?.checked;
        await api.updateFinance(e.id, { ...data, status: realizar ? 'realizado' : (e.status || 'realizado'), vencimento: e.vencimento || null, parcela: e.parcela || null, grupoId: e.grupoId || null, contractId: e.contractId || null, competencia: e.competencia || null, creditId: e.creditId || null, associadoId: e.associadoId || null });
        toast(realizar ? 'Parcela marcada como recebida.' : 'Alterações salvas.');
      }
      if (andNew) { const keep = { tipo: data.tipo, data: data.data }; closeSheet(); openFinanceForm(null, keep.tipo); $('#fn-data').value = keep.data; }
      else closeSheet();
    } catch (e2) { err.textContent = writeError(e2); g('fn-save').disabled = false; }
  }
  g('fn-cancel').addEventListener('click', closeSheet);
  g('fn-save-more')?.addEventListener('click', () => save(true));
  f.addEventListener('submit', ev => { ev.preventDefault(); save(false); });
  g('fn-del')?.addEventListener('click', () => {
    g('fn-confirm').innerHTML = `<div class="confirm"><p>Excluir este lançamento de <b>${esc(brl(e.valor))}</b> (${esc(e.categoria)}, ${fmtDate(e.data)})?</p><button class="btn btn-danger btn-sm" type="button" id="fn-del-yes">Excluir</button><button class="btn btn-sm" type="button" id="fn-del-no">Manter</button></div>`;
    $('#fn-del-no').addEventListener('click', () => { g('fn-confirm').innerHTML = ''; });
    $('#fn-del-yes').addEventListener('click', async () => { try { await api.deleteFinance(e.id); toast('Lançamento excluído.'); closeSheet(); } catch (err) { g('fn-err').textContent = writeError(err); } });
  });
}
async function exportFinanceCSV() {
  const list = filteredFinance();
  const n = v => num(v).toFixed(2).replace('.', ',');
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = ['Data', 'Mês', 'Tipo', 'Situação', 'Vencimento', 'Parcela', 'Categoria', 'Descrição', 'Valor', 'Observações'];
  const rows = list.map(e => [fmtDate(e.data), String(e.data).slice(0, 7), e.tipo === 'receita' ? 'Receita' : 'Despesa', isProv(e) ? (isLate(e) ? 'Provisionado (em atraso)' : 'Provisionado') : 'Realizado', e.vencimento ? fmtDate(e.vencimento) : '', e.parcela || '', e.categoria, e.descricao || '', n(e.valor), e.observacoes || ''].map(q).join(';'));
  const monthly = financeMonthly(financeOfYear(S.ff.ano));
  const resumo = ['', '', '', '', '', '', ''].map(q).join(';') + '\r\n' + ['Resumo ' + S.ff.ano, 'Receitas', 'Despesas', 'Resultado'].map(q).join(';') + '\r\n' + monthly.filter(m => m.n).map(m => [MONTHS_FULL[m.i], n(m.rec), n(m.desp), n(m.res)].map(q).join(';')).join('\r\n');
  const csv = '﻿' + head.map(q).join(';') + '\r\n' + rows.join('\r\n') + '\r\n' + resumo;
  try { const ok = await api.exportCSV(`financeiro-${S.ff.ano}${S.ff.mes ? '-' + S.ff.mes : ''}.csv`, csv); if (ok) toast('Arquivo exportado.'); }
  catch (err) { toast(err?.message || 'Não foi possível exportar.', true); }
}

let chartRO = null;
function bindViewOnce(view) {
  view.addEventListener('input', e => {
    const key = ['f', 'fc', 'ff', 'fct', 'fpt'].find(k => e.target.dataset[k] != null); if (!key) return;
    const field = e.target.dataset[key], isQ = field === 'q', inputId = e.target.id;
    S[key][field] = e.target.value;
    if (key === 'f' && field === 'period') savePref('period', S.f.period);
    if (key === 'ff' && field === 'ano') S.ff.mes = '';
    if (key === 'fpt' && field === 'mes') { ensurePontoMonth(e.target.value); }
    if (isQ) { clearTimeout(bindViewOnce.t); bindViewOnce.t = setTimeout(() => { const pos = e.target.selectionStart; render(); const q = document.getElementById(inputId); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch {} } }, 250); }
    else render();
  });
  view.addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (a) {
      const id = a.dataset.id;
      switch (a.dataset.act) {
        case 'new-case': return openCaseForm(null);
        case 'go-cases': S.tab = 'cases'; savePref('tab', S.tab); return render();
        case 'go-credits': S.tab = 'credits'; savePref('tab', S.tab); return render();
        case 'go-fin-pending': S.tab = 'cases'; S.f.status = 'fin_pendente'; savePref('tab', S.tab); return render();
        case 'export': return exportCSV();
        case 'new-partner': return openPartnerForm(null);
        case 'edit-partner': return openPartnerForm(partnerById(id));
        case 'reset-partner': return resetPartnerPassword(partnerById(id));
        case 'toggle-partner': return togglePartner(partnerById(id));
        case 'new-credit': return openCreditForm(null);
        case 'export-credits': return exportCreditsCSV();
        case 'new-receita': return openFinanceForm(null, 'receita');
        case 'new-despesa': return openFinanceForm(null, 'despesa');
        case 'export-finance': return exportFinanceCSV();
        case 'new-associado': return openPartnerForm(null, 'associado');
        case 'fp': S.fp = id || ''; return render();
        case 'seg': S.seg = id || 'all'; savePref('seg', S.seg); return render();
        case 'go-finance': S.tab = 'finance'; savePref('tab', S.tab); return render();
        case 'go-contracts': S.tab = 'contracts'; savePref('tab', S.tab); return render();
        case 'new-contract': return openContractForm(null);
        case 'edit-contract': return openContractForm(S.contracts.find(x => x.id === id));
        case 'export-contracts': return exportContractsCSV();
        case 'open-prov': return openProvisionedSheet();
        case 'post-salaries': return postSalaries(S.ff.ano + '-' + S.ff.mes);
        case 'new-estagiario': return openPartnerForm(null, 'estagiario');
        case 'go-ponto': S.tab = 'ponto'; savePref('tab', S.tab); return render();
        case 'punch': return doPunch(id);
        case 'ask-adjust': return openAdjustForm();
        case 'ponto-config': return openPontoConfig();
        case 'ponto-manual': return openManualPunch(id || '');
        case 'ponto-decide': return decidePunch(id, a.dataset.dec);
        case 'ponto-espelho': return openEspelho(partnerById(id), S.fpt.mes);
        case 'export-ponto': return exportPontoCSV(id || '');
        case 'geo-retry': return checkGeo(true);
      }
    }
    const tp = e.target.closest('tr[data-pessoa]');
    if (tp) { openEspelho(partnerById(tp.dataset.pessoa), S.fpt.mes); return; }
    const cell = e.target.closest('td[data-ct]');
    if (cell) { const c = S.contracts.find(x => x.id === cell.dataset.ct); if (c && S.canWrite) openReceiptSheet(c, cell.dataset.ym); return; }
    const tr = e.target.closest('tr[data-id]');
    if (tr) { const c = S.cases.find(x => x.id === tr.dataset.id); if (c) openCaseForm(c); return; }
    const trc = e.target.closest('tr[data-credit]');
    if (trc) { const c = S.credits.find(x => x.id === trc.dataset.credit); if (c) openCreditForm(c); return; }
    const trf = e.target.closest('tr[data-fin]');
    if (trf) { const x = S.finance.find(y => y.id === trf.dataset.fin); if (x) openFinanceForm(x); return; }
    const trm = e.target.closest('tr[data-fmes]');
    if (trm) { S.ff.mes = S.ff.mes === trm.dataset.fmes ? '' : trm.dataset.fmes; render(); $('#fin-entries')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  view.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('tr[data-id],tr[data-credit],tr[data-fin],tr[data-fmes],td[data-ct],tr[data-pessoa]')) e.target.click(); });
}
let clockTimer = null;
function afterRender(view) {
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  if ($('#clock', view)) clockTimer = setInterval(() => { const el = $('#clock'); if (!el) { clearInterval(clockTimer); clockTimer = null; return; } el.textContent = new Date().toTimeString().slice(0, 8); }, 1000);
  if (chartRO) { chartRO.disconnect(); chartRO = null; }
  const charts = [
    ['#chart-months', ch => monthChart(ch, filtered(false))],
    ['#chart-timeline', ch => creditTimeline(ch, S.credits)],
    ['#chart-finance', ch => financeChart(ch, financeMonthly(financeOfYear(S.ff.ano)))],
    ['#chart-arms', ch => armsChart(ch)]
  ].map(([sel, fn]) => [$(sel, view), fn]).filter(([el]) => el);
  if (!charts.length) return;
  const widths = new Map();
  const drawAll = () => charts.forEach(([el, fn]) => { widths.set(el, el.clientWidth); fn(el); });
  drawAll();
  if (window.ResizeObserver) {
    chartRO = new ResizeObserver(() => { charts.forEach(([el, fn]) => { if (Math.abs(el.clientWidth - (widths.get(el) || 0)) > 8) { widths.set(el, el.clientWidth); fn(el); } }); });
    charts.forEach(([el]) => chartRO.observe(el));
  }
}

/* tooltip (texto puro: a primeira linha é o título) */
const tipEl = $('#tip');
document.addEventListener('mouseover', e => {
  const t = e.target.closest ? e.target.closest('[data-tip]') : null;
  if (!t) { tipEl.hidden = true; return; }
  const lines = String(t.dataset.tip || '').split('\n');
  tipEl.textContent = ''; const b = document.createElement('b'); b.textContent = lines[0]; tipEl.append(b, lines.slice(1).join('\n'));
  tipEl.hidden = false; moveTip(e);
});
document.addEventListener('mousemove', e => { if (!tipEl.hidden) moveTip(e); });
function moveTip(e) { const r = tipEl.getBoundingClientRect(); let x = e.clientX + 14, y = e.clientY + 14; if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 10; if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 10; tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px'; }

/* ============ painel lateral (formulários) ============ */
function openSheet(title, bodyHTML, opts = {}) {
  closeSheet();
  const root = $('#modal-root');
  root.innerHTML = `<div class="overlay" id="overlay"><div class="sheet ${opts.narrow ? 'narrow' : ''}" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="sheet-h"><h2 id="sheet-title">${title}</h2><button class="x" type="button" aria-label="Fechar" id="sheet-close">×</button></div><div class="sheet-b" id="sheet-b">${bodyHTML}</div></div></div>`;
  $('#sheet-close').addEventListener('click', closeSheet);
  $('#overlay').addEventListener('mousedown', e => { if (e.target.id === 'overlay') closeSheet(); });
  document.addEventListener('keydown', escClose);
  const first = $('#sheet-b input, #sheet-b select, #sheet-b textarea, #sheet-b button');
  if (first) { try { first.focus({ preventScroll: true }); } catch {} setTimeout(() => { if (!root.contains(document.activeElement)) first.focus(); }, 30); } // não rouba o foco de quem já começou a digitar
  return $('#sheet-b');
}
function escClose(e) { if (e.key === 'Escape') closeSheet(); }
function closeSheet() { $('#modal-root').innerHTML = ''; document.removeEventListener('keydown', escClose); }
function writeError(err) {
  const code = err?.code;
  if (code === 'read_only') { if (!S.readOnly) { S.readOnly = true; render(); } return err?.message && err.message !== 'Erro 403' ? err.message : 'Seu acesso é somente leitura. Peça ao escritório para conceder permissão de edição.'; }
  if (code === 'auth') { setTimeout(logout, 1200); return 'Sua sessão expirou. Entre novamente.'; }
  if (code === 'quota') return 'O limite de armazenamento do sistema foi atingido. Fale com o escritório.';
  if (code === 'rate') return 'Muitas operações em sequência. Aguarde alguns segundos e tente de novo.';
  return 'Não foi possível salvar: ' + (err?.message || err);
}

/* ---------- processo ---------- */
function openCaseForm(c) {
  const admin = isAdmin(), isNew = !c;
  const office0 = admin && (c ? isOffice(c) : S.f.partner === '_escritorio');
  const pid = admin ? (office0 ? '' : (c?.parceiroId || (S.f.partner !== '_escritorio' ? S.f.partner : '') || '')) : myPartnerId();
  const p = partnerById(pid);
  const d = c || { parceiroId: pid, titularidade: office0 ? 'escritorio' : 'parceria', natureza: 'judicial', fase: 'em_curso', resultado: 'em_andamento', dataProtocolo: todayISO(), pctParceiro: office0 ? 0 : (p ? num(p.pctParceiroPadrao) : 50), pctNosso: office0 ? 100 : (p ? num(p.pctNossoPadrao) : 50), temCorretor: false, corretorPago: false, fluxoRecebimento: 'escritorio' };
  const res0 = resultadoOf(d), fase0 = faseOf(d), nat0 = natOf(d);
  const finStatus = c?.financeiroStatus || 'nao';
  const ps = S.partners.filter(x => !isIntern(x) && (x.ativo !== false || x.id === pid)).sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  openSheet(isNew ? 'Novo processo' : 'Editar processo', `
    <form id="case-form" autocomplete="off" novalidate>
      ${admin ? `<div class="row" style="margin-bottom:12px">
        <label class="check" for="c-tit-par" style="margin:0"><input type="radio" name="c-tit" id="c-tit-par" value="parceria" ${office0 ? '' : 'checked'}><span>Com advogado parceiro ou associado<small>honorários divididos conforme o cadastro</small></span></label>
        <label class="check" for="c-tit-esc" style="margin:0"><input type="radio" name="c-tit" id="c-tit-esc" value="escritorio" ${office0 ? 'checked' : ''}><span>Somente do escritório<small>sem divisão; nossos honorários finais em % do valor da ação</small></span></label>
      </div>
      <div class="field" id="c-partner-field" ${office0 ? 'hidden' : ''}><label for="c-partner">Advogado parceiro ou associado</label><select id="c-partner"><option value="">Selecione…</option>${ps.map(x => `<option value="${esc(x.id)}" ${x.id === pid ? 'selected' : ''}>${esc(x.nome)}${isAssoc(x) ? ' — associado' + (x.areaAtuacao ? ' ' + esc(x.areaAtuacao) : '') : (x.escritorio ? ' — ' + esc(x.escritorio) : '')}</option>`).join('')}</select></div>` : ''}
      <div class="row" style="margin-bottom:12px">
        <label class="check" for="c-nat-jud" style="margin:0"><input type="radio" name="c-nat" id="c-nat-jud" value="judicial" ${nat0 === 'judicial' ? 'checked' : ''}><span>Judicial<small>número CNJ do processo</small></span></label>
        <label class="check" for="c-nat-adm" style="margin:0"><input type="radio" name="c-nat" id="c-nat-adm" value="administrativo" ${nat0 === 'administrativo' ? 'checked' : ''}><span>Administrativo<small>protocolo, PA, requerimento…</small></span></label>
      </div>
      <div class="row" style="margin-bottom:12px">
        <label class="check" for="c-fase-curso" style="margin:0"><input type="radio" name="c-fase" id="c-fase-curso" value="em_curso" ${fase0 === 'em_curso' ? 'checked' : ''}><span>Em curso<small>ainda sem julgamento — informe o valor pretendido</small></span></label>
        <label class="check" for="c-fase-julg" style="margin:0"><input type="radio" name="c-fase" id="c-fase-julg" value="julgado" ${fase0 === 'julgado' ? 'checked' : ''}><span>Julgado<small>já há decisão — informe o valor da condenação</small></span></label>
      </div>
      <div class="row">
        <div class="field"><label for="c-num" id="c-num-label">${nat0 === 'judicial' ? 'Número do processo <small>(CNJ)</small>' : 'Número do processo / protocolo'}</label><input type="text" id="c-num" inputmode="${nat0 === 'judicial' ? 'numeric' : 'text'}" placeholder="${nat0 === 'judicial' ? '0000000-00.0000.0.00.0000' : 'ex.: 12345.678901/2026-00'}" value="${esc(c?.numeroProcesso || '')}" required></div>
        <div class="field"><label for="c-data">Data do protocolo</label><input type="date" id="c-data" value="${esc((d.dataProtocolo || '').slice(0, 10))}" required></div>
      </div>
      <div class="field"><label for="c-cliente">Nome do cliente</label><input type="text" id="c-cliente" value="${esc(c?.cliente || '')}" required></div>
      <div class="field"><label for="c-tipo" id="c-tipo-label">${nat0 === 'judicial' ? 'Tipo de ação judicial' : 'Tipo de procedimento administrativo'}</label><input type="text" id="c-tipo" list="tipos-list" value="${esc(c?.tipoAcao || '')}" placeholder="Escolha ou digite" required><datalist id="tipos-list">${Array.from(new Set([...TIPOS, ...S.cases.map(x => x.tipoAcao).filter(Boolean)])).map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist></div>
      <fieldset id="c-values"><legend id="c-values-legend">${fase0 === 'julgado' ? 'Valores da ação e da condenação' : 'Valores da ação'}</legend>
        <div class="row">
          <div class="field"><label for="c-vacao">Valor pretendido da ação <small>(R$${office0 ? '' : ', opcional'})</small></label><input type="text" class="money" id="c-vacao" inputmode="decimal" value="${c?.valorAcao != null ? moneyInput(c.valorAcao) : ''}" placeholder="0,00"></div>
          <div class="field" id="c-vcond-field" ${fase0 === 'julgado' ? '' : 'hidden'}><label for="c-vcond">Valor da condenação <small>(R$)</small></label><input type="text" class="money" id="c-vcond" inputmode="decimal" value="${c?.valorCondenacao != null ? moneyInput(c.valorCondenacao) : ''}" placeholder="0,00"></div>
          <div class="field" id="c-phon-field" ${office0 ? '' : 'hidden'}><label for="c-phon">Nossos honorários finais <small>(% sobre o valor)</small></label><input type="number" id="c-phon" min="0" max="100" step="0.5" value="${c?.pctHonorarios != null ? num(c.pctHonorarios) : 20}"></div>
        </div>
        <div class="row">
          <div class="field"><label for="c-hon" id="c-hon-label">${honLabel(d)} <small>(R$)</small></label><input type="text" class="money" id="c-hon" inputmode="decimal" value="${c ? moneyInput(c.honorariosPretendidos) : ''}" placeholder="0,00"><p class="hint" id="c-hon-hint" style="margin:4px 0 0"></p></div>
          <div class="field"><label for="c-lead">Custo do lead <small>(R$)</small></label><input type="text" class="money" id="c-lead" inputmode="decimal" value="${c ? moneyInput(c.custoLead) : ''}" placeholder="0,00"></div>
        </div>
      </fieldset>
      <fieldset id="c-split" ${office0 ? 'hidden' : ''}><legend id="c-split-legend">${isAssoc(p) ? 'Bonificação do associado' : 'Divisão dos honorários'}</legend>
        <div class="row">
          <div class="field"><label for="c-pp" id="c-pp-label">${isAssoc(p) ? 'Bonificação do associado' : 'Parceiro'} <small>(%)</small></label><input type="number" id="c-pp" min="0" max="100" step="0.5" value="${num(d.pctParceiro)}" required></div>
          <div class="field"><label for="c-pn">Costa de Araújo <small>(%)</small></label><input type="number" id="c-pn" min="0" max="100" step="0.5" value="${num(d.pctNosso)}" required></div>
        </div>
        <p class="hint" id="c-split-hint">${isAssoc(p) ? `Padrão do associado: ${num(p.pctBonificacaoPadrao)}% sobre os honorários recebidos. Altere apenas se este processo tiver acordo diferente.` : 'Os dois percentuais somam 100%. Ao alterar um, o outro é ajustado.'}</p>
      </fieldset>
      <fieldset><legend>Situação do processo</legend>
        <div class="row" style="margin-bottom:12px">
          <label class="check" for="c-res-and" style="margin:0"><input type="radio" name="c-res" id="c-res-and" value="em_andamento" ${res0 === 'em_andamento' ? 'checked' : ''}><span>Em andamento<small>aguardando desfecho</small></span></label>
          <label class="check" for="c-res-rec" style="margin:0"><input type="radio" name="c-res" id="c-res-rec" value="recebido" ${res0 === 'recebido' ? 'checked' : ''}><span>Finalizado e recebido<small>o valor entrou</small></span></label>
          <label class="check" for="c-res-per" style="margin:0"><input type="radio" name="c-res" id="c-res-per" value="perdido" ${res0 === 'perdido' ? 'checked' : ''}><span>Perdido<small>nada a receber</small></span></label>
        </div>
        <div id="rec-fields" ${res0 === 'recebido' ? '' : 'hidden'}>
          <div class="row">
            <div class="field"><label for="c-vrec">Quanto recebemos de honorários <small>(R$)</small></label><input type="text" class="money" id="c-vrec" inputmode="decimal" value="${c && res0 === 'recebido' ? moneyInput(c.valorRecebido == null ? c.honorariosPretendidos : c.valorRecebido) : ''}" placeholder="0,00"></div>
            <div class="field"><label for="c-drec">Data do recebimento</label><input type="date" id="c-drec" value="${esc((c?.dataRecebimento || '').slice(0, 10))}"></div>
          </div>
          <div class="field" id="c-fluxo-field" ${isAssoc(p) || office0 ? 'hidden' : ''}><label for="c-fluxo">Quem recebeu o dinheiro</label><select id="c-fluxo"><option value="escritorio" ${(d.fluxoRecebimento || 'escritorio') === 'escritorio' ? 'selected' : ''}>O escritório recebeu o valor total e repassa a parte do parceiro</option><option value="parceiro" ${d.fluxoRecebimento === 'parceiro' ? 'selected' : ''}>O parceiro recebeu e repassou a parte do escritório</option></select></div>
          <div id="fin-box"></div>
        </div>
        <div id="lost-fields" ${res0 === 'perdido' ? '' : 'hidden'}>
          <div class="row"><div class="field"><label for="c-denc">Data do encerramento</label><input type="date" id="c-denc" value="${esc((c?.dataEncerramento || '').slice(0, 10))}"></div></div>
          <p class="hint">O processo sai do que há a receber; o custo do lead continua contabilizado.</p>
        </div>
      </fieldset>
      <fieldset><legend>Corretor</legend>
        <label class="check" for="c-cor"><input type="checkbox" id="c-cor" ${d.temCorretor ? 'checked' : ''}><span>Há corretor neste caso<small>Indicação com valor a pagar</small></span></label>
        <div id="cor-fields" ${d.temCorretor ? '' : 'hidden'}>
          <div class="row">
            <div class="field"><label for="c-corn">Nome do corretor</label><input type="text" id="c-corn" value="${esc(c?.nomeCorretor || '')}"></div>
            <div class="field"><label for="c-corv">Valor a pagar <small>(R$)</small></label><input type="text" class="money" id="c-corv" inputmode="decimal" value="${c && c.temCorretor ? moneyInput(c.valorCorretor) : ''}" placeholder="0,00"></div>
          </div>
          <label class="check" for="c-corp"><input type="checkbox" id="c-corp" ${d.corretorPago ? 'checked' : ''}><span>Corretor já pago</span></label>
        </div>
      </fieldset>
      <div class="field"><label for="c-obs">Observações</label><textarea id="c-obs">${esc(c?.observacoes || '')}</textarea></div>
      <div class="summary" id="c-summary"></div>
      <p class="err" id="c-err"></p>
      <div class="form-actions">
        ${!isNew ? '<button class="btn btn-danger left" type="button" id="c-del">Excluir</button>' : ''}
        <button class="btn" type="button" id="c-cancel">Cancelar</button>
        <button class="btn btn-primary" type="submit" id="c-save">${isNew ? 'Cadastrar processo' : 'Salvar alterações'}</button>
      </div>
      <div id="c-confirm"></div>
    </form>`);
  const f = $('#case-form');
  const g = id => $('#' + id, f);
  const curNat = () => f.querySelector('input[name="c-nat"]:checked').value;
  const curTit = () => admin ? f.querySelector('input[name="c-tit"]:checked').value : 'parceria';
  const curFase = () => f.querySelector('input[name="c-fase"]:checked').value;
  const curRes = () => f.querySelector('input[name="c-res"]:checked').value;
  /* Honorários do escritório: calculados em % sobre o valor pretendido (em curso) ou sobre a condenação (julgado);
     se o usuário digitar outro valor em "honorários", o cálculo deixa de sobrescrever (até ele apagar o campo). */
  const honInputs = () => ({ valorAcao: parseMoney(g('c-vacao').value), valorCondenacao: g('c-vcond').value.trim() ? parseMoney(g('c-vcond').value) : null, pctHonorarios: num(g('c-phon').value), fase: curFase(), titularidade: curTit() });
  f.dataset.honManual = c && isOffice(c) && c.honorariosPretendidos != null && Math.abs(num(c.honorariosPretendidos) - honCalc(c)) > 0.005 ? '1' : '';
  const refreshHon = () => {
    const off = curTit() === 'escritorio', julg = curFase() === 'julgado';
    g('c-values-legend').textContent = julg ? 'Valores da ação e da condenação' : 'Valores da ação';
    g('c-vcond-field').hidden = !julg; g('c-phon-field').hidden = !off;
    g('c-hon-label').innerHTML = `${honLabel({ fase: curFase(), titularidade: off ? 'escritorio' : 'parceria', parceiroId: off ? null : 'x' })} <small>(R$)</small>`;
    const hint = g('c-hon-hint');
    if (!off) { hint.textContent = julg ? 'Honorários fixados na decisão; a divisão com o parceiro ou associado incide sobre o que for recebido.' : ''; return; }
    const d = honInputs(), base = julg ? (d.valorCondenacao == null ? 0 : d.valorCondenacao) : d.valorAcao, calc = round2(base * num(d.pctHonorarios) / 100);
    if (!f.dataset.honManual && base > 0) g('c-hon').value = moneyInput(calc);
    hint.textContent = base > 0 ? `${f.dataset.honManual ? 'Valor informado à mão' : 'Calculado'}: ${num(d.pctHonorarios)}% de ${brl(base)}${f.dataset.honManual ? ` seria ${brl(calc)} — apague o campo para voltar ao cálculo` : ''}.` : (julg ? 'Informe o valor da condenação para calcular os honorários.' : 'Informe o valor pretendido da ação para calcular os honorários previstos.');
  };
  g('c-hon').addEventListener('input', () => { f.dataset.honManual = g('c-hon').value.trim() ? '1' : ''; });
  if (admin) {
    f.querySelectorAll('input[name="c-tit"]').forEach(r => r.addEventListener('change', () => {
      const off = curTit() === 'escritorio';
      g('c-partner-field').hidden = off; g('c-split').hidden = off; g('c-fluxo-field').hidden = off || isAssoc(partnerById(g('c-partner').value));
      if (off) { g('c-pp').value = 0; g('c-pn').value = 100; g('c-fluxo').value = 'escritorio'; } else { const pp = partnerById(g('c-partner').value); if (pp && isNew) { g('c-pp').value = num(pp.pctParceiroPadrao); g('c-pn').value = num(pp.pctNossoPadrao); } }
      refreshHon(); summary();
    }));
  }
  refreshHon();
  g('c-num').addEventListener('blur', () => { if (curNat() === 'judicial') g('c-num').value = cnj(g('c-num').value); });
  f.querySelectorAll('input[name="c-nat"]').forEach(r => r.addEventListener('change', () => {
    const jud = curNat() === 'judicial';
    g('c-num-label').innerHTML = jud ? 'Número do processo <small>(CNJ)</small>' : 'Número do processo / protocolo';
    g('c-tipo-label').textContent = jud ? 'Tipo de ação judicial' : 'Tipo de procedimento administrativo';
    g('c-num').placeholder = jud ? '0000000-00.0000.0.00.0000' : 'ex.: 12345.678901/2026-00'; g('c-num').inputMode = jud ? 'numeric' : 'text';
    if (jud) g('c-num').value = cnj(g('c-num').value);
  }));
  f.querySelectorAll('input[name="c-fase"]').forEach(r => r.addEventListener('change', () => { refreshHon(); if (curFase() === 'julgado') setTimeout(() => g('c-vcond').focus(), 0); summary(); }));
  ['c-vacao', 'c-vcond', 'c-phon'].forEach(id => g(id).addEventListener('input', refreshHon));
  f.querySelectorAll('input[name="c-res"]').forEach(r => r.addEventListener('change', () => {
    const res = curRes();
    g('rec-fields').hidden = res !== 'recebido'; g('lost-fields').hidden = res !== 'perdido';
    if (res === 'recebido') { if (!g('c-vrec').value.trim()) g('c-vrec').value = g('c-hon').value; if (!g('c-drec').value) g('c-drec').value = todayISO(); }
    if (res === 'perdido' && !g('c-denc').value) g('c-denc').value = todayISO();
    summary();
  }));
  $$('.money', f).forEach(i => i.addEventListener('blur', () => { if (i.value.trim()) i.value = moneyInput(parseMoney(i.value)); }));
  g('c-pp').addEventListener('input', () => { const v = Math.min(100, Math.max(0, num(g('c-pp').value))); g('c-pn').value = Math.round((100 - v) * 100) / 100; summary(); });
  g('c-pn').addEventListener('input', () => { const v = Math.min(100, Math.max(0, num(g('c-pn').value))); g('c-pp').value = Math.round((100 - v) * 100) / 100; summary(); });
  g('c-cor').addEventListener('change', () => { g('cor-fields').hidden = !g('c-cor').checked; summary(); });
  if (admin) g('c-partner').addEventListener('change', () => {
    const pp = partnerById(g('c-partner').value), a = isAssoc(pp);
    if (pp && isNew) { g('c-pp').value = num(pp.pctParceiroPadrao); g('c-pn').value = num(pp.pctNossoPadrao); }
    g('c-split-legend').textContent = a ? 'Bonificação do associado' : 'Divisão dos honorários';
    g('c-pp-label').innerHTML = `${a ? 'Bonificação do associado' : 'Parceiro'} <small>(%)</small>`;
    g('c-split-hint').textContent = a ? `Padrão do associado: ${num(pp.pctBonificacaoPadrao)}% sobre os honorários recebidos. Altere apenas se este processo tiver acordo diferente.` : 'Os dois percentuais somam 100%. Ao alterar um, o outro é ajustado.';
    g('c-fluxo-field').hidden = a; if (a) g('c-fluxo').value = 'escritorio';
    summary();
  });
  f.addEventListener('input', () => summary());
  function collect() {
    const res = curRes(), off = curTit() === 'escritorio';
    return {
      parceiroId: off ? null : (admin ? g('c-partner').value : myPartnerId()),
      titularidade: off ? 'escritorio' : 'parceria',
      valorAcao: g('c-vacao').value.trim() ? parseMoney(g('c-vacao').value) : null,
      valorCondenacao: curFase() === 'julgado' && g('c-vcond').value.trim() ? parseMoney(g('c-vcond').value) : null,
      pctHonorarios: off ? num(g('c-phon').value) : null,
      natureza: curNat(), fase: curFase(), resultado: res,
      numeroProcesso: curNat() === 'judicial' ? cnj(g('c-num').value) : g('c-num').value.trim(), cliente: g('c-cliente').value.trim(), tipoAcao: g('c-tipo').value.trim(), dataProtocolo: g('c-data').value,
      honorariosPretendidos: parseMoney(g('c-hon').value), custoLead: parseMoney(g('c-lead').value),
      pctParceiro: off ? 0 : num(g('c-pp').value), pctNosso: off ? 100 : num(g('c-pn').value),
      recebido: res === 'recebido', valorRecebido: res === 'recebido' ? parseMoney(g('c-vrec').value) : null, dataRecebimento: res === 'recebido' ? g('c-drec').value : null,
      fluxoRecebimento: res === 'recebido' && !off ? g('c-fluxo').value : 'escritorio', dataEncerramento: res === 'perdido' ? g('c-denc').value : null,
      temCorretor: g('c-cor').checked, nomeCorretor: g('c-cor').checked ? g('c-corn').value.trim() : '', valorCorretor: g('c-cor').checked ? parseMoney(g('c-corv').value) : 0, corretorPago: g('c-cor').checked ? g('c-corp').checked : false,
      observacoes: g('c-obs').value.trim()
    };
  }
  const wantsPost = () => admin && !!g('c-lancar')?.checked;
  function summary() {
    const data = collect(), m = metrics(data);
    const pSel = partnerById(data.parceiroId);
    g('c-summary').innerHTML = data.titularidade === 'escritorio'
      ? `<div><div class="lbl">${faseOf(data) === 'julgado' && data.valorCondenacao != null ? 'Valor da condenação' : 'Valor pretendido da ação'}</div><div class="v">${brl(honBase(data))}</div></div><div><div class="lbl">${honLabel(data)}</div><div class="v">${brl(m.nossaParte)}</div></div><div><div class="lbl">Líquido do escritório</div><div class="v">${brl(m.nossaParte - m.custoLead - m.corretor)}</div></div>`
      : `<div><div class="lbl">${shareLabel(pSel, 'partner')}</div><div class="v">${brl(m.parteParceiro)}</div></div><div><div class="lbl">${shareLabel(pSel, 'office')}</div><div class="v">${brl(m.nossaParte)}</div></div><div><div class="lbl">Líquido do escritório</div><div class="v">${brl(m.nossaParte - m.custoLead - m.corretor)}</div></div>`;
    const box = g('fin-box'); if (!box) return;
    if (data.resultado !== 'recebido') { box.innerHTML = finStatus === 'lancado' ? '<div class="note">Este processo já tinha lançamentos no Financeiro; ao salvar com outra situação, eles serão removidos.</div>' : ''; return; }
    if (finStatus === 'lancado') { box.innerHTML = `<div class="note">Recebimento já lançado no Financeiro em ${fmtDate((c?.financeiroEm || '').slice(0, 10))}. Alterações de valor devem ser ajustadas na aba Financeiro.</div>`; return; }
    const entries = financeEntriesFor({ ...data, id: c?.id });
    const lines = entries.map(e => `<li>${e.tipo === 'receita' ? 'Receita' : 'Despesa'} · ${esc(e.categoria)} · <b>${brl(e.valor)}</b></li>`).join('');
    if (admin) {
      const checked = g('c-lancar') ? g('c-lancar').checked : true;
      box.innerHTML = `<label class="check" for="c-lancar"><input type="checkbox" id="c-lancar" ${checked ? 'checked' : ''}><span>Lançar no Financeiro agora<small>${data.dataRecebimento ? 'com a data do recebimento' : 'informe a data do recebimento'}</small></span></label><ul class="hint" style="margin:-4px 0 10px 18px;padding:0">${lines || '<li>Informe o valor recebido.</li>'}</ul>`;
    } else box.innerHTML = `<div class="note">O escritório será avisado e fará o lançamento no Financeiro: ${lines ? entries.map(e => (e.tipo === 'receita' ? 'receita ' : 'despesa ') + brl(e.valor)).join(' e ') : 'informe o valor recebido'}.</div>`;
  }
  summary();
  g('c-cancel').addEventListener('click', closeSheet);
  g('c-del')?.addEventListener('click', () => {
    g('c-confirm').innerHTML = `<div class="confirm"><p>Excluir o processo <b>${esc(numFmt(c))}</b> de ${esc(c.cliente)}? Esta ação não pode ser desfeita.</p><button class="btn btn-danger btn-sm" type="button" id="c-del-yes">Excluir definitivamente</button><button class="btn btn-sm" type="button" id="c-del-no">Manter</button></div>`;
    $('#c-del-no').addEventListener('click', () => { g('c-confirm').innerHTML = ''; });
    $('#c-del-yes').addEventListener('click', async () => {
      try { await api.deleteCase(c.id); toast('Processo excluído.'); closeSheet(); } catch (err) { g('c-err').textContent = writeError(err); }
    });
  });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const data = collect(), err = g('c-err');
    if (data.titularidade === 'parceria' && !data.parceiroId) return err.textContent = 'Selecione o advogado parceiro ou associado.';
    if (data.titularidade === 'escritorio' && data.resultado !== 'perdido' && !(data.honorariosPretendidos > 0)) return err.textContent = data.fase === 'julgado' ? 'Informe o valor da condenação (ou os honorários) para calcular o que temos a receber.' : 'Informe o valor pretendido da ação e o % de honorários (ou os honorários previstos).';
    if (!data.numeroProcesso) return err.textContent = 'Informe o número do processo.';
    if (!data.cliente) return err.textContent = 'Informe o nome do cliente.';
    if (!data.tipoAcao) return err.textContent = 'Informe o tipo de ação.';
    if (!data.dataProtocolo) return err.textContent = 'Informe a data do protocolo.';
    if (Math.abs(data.pctParceiro + data.pctNosso - 100) > 0.01) return err.textContent = 'Os percentuais precisam somar 100%.';
    if (data.titularidade === 'parceria' && data.resultado !== 'perdido' && !(data.honorariosPretendidos > 0)) return err.textContent = 'Informe o valor dos honorários.';
    if (data.resultado === 'recebido' && !data.dataRecebimento) return err.textContent = 'Informe a data do recebimento.';
    if (data.resultado === 'recebido' && !(data.valorRecebido > 0)) return err.textContent = 'Informe o valor recebido.';
    if (data.resultado === 'perdido' && !data.dataEncerramento) return err.textContent = 'Informe a data do encerramento.';
    if (isNew) {
      const digits = data.numeroProcesso.replace(/\D/g, '');
      const dup = digits.length >= 10 ? S.cases.find(x => natOf(x) === data.natureza && String(x.numeroProcesso || '').replace(/\D/g, '') === digits) : null;
      if (dup && !f.dataset.dupOk) { err.textContent = `Já existe um processo com este número (${dup.cliente}). Clique em salvar novamente para cadastrar mesmo assim.`; f.dataset.dupOk = '1'; return; }
    }
    err.textContent = ''; g('c-save').disabled = true;
    const opts = { lancarFinanceiro: data.resultado === 'recebido' && wantsPost(), lancamentos: data.resultado === 'recebido' ? financeEntriesFor({ ...data, id: c?.id }) : [], statusAtual: finStatus };
    try {
      if (isNew) { await api.createCase(data, opts); toast(opts.lancarFinanceiro ? 'Processo cadastrado e lançado no Financeiro.' : 'Processo cadastrado.'); }
      else { await api.updateCase(c.id, data, opts); toast(opts.lancarFinanceiro ? 'Salvo e lançado no Financeiro.' : data.resultado === 'recebido' && !admin ? 'Recebimento informado ao escritório.' : 'Alterações salvas.'); }
      closeSheet();
    } catch (e2) { err.textContent = writeError(e2); g('c-save').disabled = false; }
  });
}

/* ---------- parceiro ---------- */
const AREAS_ASSOC = ['Trabalhista', 'Defesa do executado', 'Bancário', 'Cível', 'Consumidor', 'Previdenciário', 'Família e sucessões', 'Tributário', 'Empresarial', 'Criminal', 'Imobiliário'];
const titleFor = (tipo, isNew) => isNew ? ({ associado: 'Novo advogado associado', estagiario: 'Novo estagiário', parceiro: 'Novo advogado parceiro' }[tipo]) : ({ associado: 'Editar associado', estagiario: 'Editar estagiário', parceiro: 'Editar parceiro' }[tipo]);
function openPartnerForm(p, presetTipo) {
  const isNew = !p;
  const pw = isNew ? genPassword() : '';
  const tipo0 = p ? (isIntern(p) ? 'estagiario' : isAssoc(p) ? 'associado' : 'parceiro') : (presetTipo || 'parceiro');
  const j0 = p && isEmployee(p) ? jornadaOf(p) : (tipo0 === 'estagiario' ? JORNADAS.manha : JORNADAS.integral);
  const jk0 = jornadaKey(j0);
  openSheet(titleFor(tipo0, isNew), `
    <form id="p-form" autocomplete="off" novalidate>
      <div class="row" style="margin-bottom:12px">
        <label class="check" for="p-t-par" style="margin:0"><input type="radio" name="p-tipo" id="p-t-par" value="parceiro" ${tipo0 === 'parceiro' ? 'checked' : ''}><span>Advogado parceiro<small>escritório próprio; divide honorários por %</small></span></label>
        <label class="check" for="p-t-ass" style="margin:0"><input type="radio" name="p-tipo" id="p-t-ass" value="associado" ${tipo0 === 'associado' ? 'checked' : ''}><span>Advogado associado<small>salário fixo + bonificação; registra horário</small></span></label>
        <label class="check" for="p-t-est" style="margin:0"><input type="radio" name="p-tipo" id="p-t-est" value="estagiario" ${tipo0 === 'estagiario' ? 'checked' : ''}><span>Estagiário<small>bolsa mensal; acesso só ao controle de horário</small></span></label>
      </div>
      <div class="row">
        <div class="field"><label for="p-nome" id="p-nome-label">Nome</label><input type="text" id="p-nome" value="${esc(p?.nome || '')}" required></div>
        <div class="field" id="p-oab-field"><label for="p-oab">OAB <small>(opcional)</small></label><input type="text" id="p-oab" value="${esc(p?.oab || '')}" placeholder="UF 000.000"></div>
      </div>
      <div id="p-est-fields" hidden>
        <div class="row">
          <div class="field"><label for="p-curso">Curso <small>(opcional)</small></label><input type="text" id="p-curso" value="${esc(p?.curso || '')}" placeholder="ex.: Direito, 8º período"></div>
          <div class="field"><label for="p-inst">Instituição de ensino <small>(opcional)</small></label><input type="text" id="p-inst" value="${esc(p?.instituicao || '')}"></div>
        </div>
        <div class="row">
          <div class="field"><label for="p-sup">Supervisor no escritório <small>(opcional)</small></label><input type="text" id="p-sup" value="${esc(p?.supervisor || '')}"></div>
          <div class="field"><label for="p-bolsa">Bolsa mensal <small>(R$)</small></label><input type="text" class="money" id="p-bolsa" inputmode="decimal" value="${p && isIntern(p) ? moneyInput(p.bolsa) : ''}" placeholder="0,00"></div>
        </div>
        <div class="row">
          <div class="field"><label for="p-ini">Início do estágio <small>(opcional)</small></label><input type="date" id="p-ini" value="${esc(p?.inicioEstagio || '')}"></div>
          <div class="field"><label for="p-fim">Término previsto <small>(opcional)</small></label><input type="date" id="p-fim" value="${esc(p?.fimEstagio || '')}"></div>
        </div>
        <p class="hint">A bolsa é lançada em despesas no Financeiro (categoria “Estagiários (bolsa)”, botão “lançar salários e bolsas” no mês). Faltas só contam dentro do período do estágio.</p>
      </div>
      <fieldset id="p-jornada" hidden><legend>Jornada (controle de horário)</legend>
        <div class="field"><label for="p-jk">Horário</label><select id="p-jk">${Object.entries(JORNADAS).map(([k, v]) => `<option value="${k}" ${jk0 === k ? 'selected' : ''}>${v.nome}</option>`).join('')}<option value="custom" ${jk0 === 'custom' ? 'selected' : ''}>Personalizado…</option></select></div>
        <div id="p-jcustom" ${jk0 === 'custom' ? '' : 'hidden'}>
          <div class="row">
            <div class="field"><label for="p-j1a">1º turno — início</label><input type="time" id="p-j1a" value="${esc(j0.blocos[0][0])}"></div>
            <div class="field"><label for="p-j1b">1º turno — fim</label><input type="time" id="p-j1b" value="${esc(j0.blocos[0][1])}"></div>
          </div>
          <label class="check" for="p-j2"><input type="checkbox" id="p-j2" ${j0.blocos.length > 1 ? 'checked' : ''}><span>Tem 2º turno (volta do almoço)</span></label>
          <div class="row" id="p-j2row" ${j0.blocos.length > 1 ? '' : 'hidden'}>
            <div class="field"><label for="p-j2a">2º turno — início</label><input type="time" id="p-j2a" value="${esc(j0.blocos[1]?.[0] || '14:00')}"></div>
            <div class="field"><label for="p-j2b">2º turno — fim</label><input type="time" id="p-j2b" value="${esc(j0.blocos[1]?.[1] || '17:30')}"></div>
          </div>
        </div>
        <div class="field"><label>Dias da semana</label><div class="dias">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label class="chk"><input type="checkbox" data-dia="${d}" ${j0.dias.includes(d) ? 'checked' : ''}><span>${WD[d]}</span></label>`).join('')}</div></div>
        <p class="hint" id="p-jhint"></p>
      </fieldset>
      <div class="field" id="p-esc-field"><label for="p-esc">Escritório</label><input type="text" id="p-esc" value="${esc(p?.escritorio || '')}"></div>
      <div id="p-assoc-fields">
        <div class="row">
          <div class="field"><label for="p-area">Área de atuação <small>(aparece como “ADVOGADO ASSOCIADO …”)</small></label><input type="text" id="p-area" list="p-areas" value="${esc(p?.areaAtuacao || '')}" placeholder="ex.: Trabalhista, Defesa do executado"><datalist id="p-areas">${AREAS_ASSOC.map(a => `<option value="${a}"></option>`).join('')}</datalist></div>
          <div class="field"><label for="p-espec">Especialização <small>(opcional)</small></label><input type="text" id="p-espec" value="${esc(p?.especializacao || '')}" placeholder="ex.: pós em Direito do Trabalho"></div>
        </div>
        <fieldset><legend>Termos da associação</legend>
          <div class="row">
            <div class="field"><label for="p-sal">Salário fixo mensal <small>(R$)</small></label><input type="text" class="money" id="p-sal" inputmode="decimal" value="${p && isAssoc(p) ? moneyInput(p.salarioFixo) : ''}" placeholder="0,00"></div>
            <div class="field"><label for="p-bon">Bonificação padrão <small>(% dos honorários recebidos em cada processo)</small></label><input type="number" id="p-bon" min="0" max="100" step="0.5" value="${p && isAssoc(p) ? num(p.pctBonificacaoPadrao) : 10}"></div>
          </div>
          <div class="field"><label for="p-termos">Outras condições <small>(opcional)</small></label><textarea id="p-termos" placeholder="ex.: bonificação dobrada em acordos acima de R$ 50 mil; metas; vale-transporte…">${esc(p?.termos || '')}</textarea></div>
          <p class="hint">O salário fixo é lançado em despesas no Financeiro (botão “lançar salários dos associados” no mês). A bonificação é calculada sobre cada processo recebido e pode ser ajustada processo a processo.</p>
        </fieldset>
      </div>
      <div class="row">
        <div class="field"><label for="p-email">E-mail</label><input type="email" id="p-email" value="${esc(p?.email || '')}"></div>
        <div class="field"><label for="p-tel">Telefone</label><input type="tel" id="p-tel" value="${esc(p?.telefone || '')}"></div>
      </div>
      <fieldset id="p-split"><legend>Divisão padrão dos honorários</legend>
        <div class="row">
          <div class="field"><label for="p-pp">Parceiro <small>(%)</small></label><input type="number" id="p-pp" min="0" max="100" step="0.5" value="${p && !isAssoc(p) ? num(p.pctParceiroPadrao) : 50}"></div>
          <div class="field"><label for="p-pn">Costa de Araújo <small>(%)</small></label><input type="number" id="p-pn" min="0" max="100" step="0.5" value="${p && !isAssoc(p) ? num(p.pctNossoPadrao) : 50}"></div>
        </div>
        <p class="hint">Sugerido automaticamente ao cadastrar um processo deste parceiro; pode ser alterado caso a caso.</p>
      </fieldset>
      <fieldset><legend>Acesso ao sistema</legend>
        <div class="row">
          <div class="field"><label for="p-user">Usuário de login</label><input type="text" id="p-user" value="${esc(p?.usuario || '')}" autocapitalize="none" spellcheck="false" placeholder="ex.: joao.silva" required></div>
          ${isNew ? `<div class="field"><label for="p-pass">Senha inicial</label><input type="text" id="p-pass" value="${pw}" spellcheck="false" required minlength="6"></div>` : ''}
        </div>
        ${isNew ? '<p class="hint">Uma senha foi gerada; você pode trocá-la. Ao salvar, o sistema mostra os dados para enviar ao advogado.</p>' : '<p class="hint">Para trocar a senha, use “Nova senha” na lista.</p>'}
      </fieldset>
      <p class="err" id="p-err"></p>
      <div class="form-actions"><button class="btn" type="button" id="p-cancel">Cancelar</button><button class="btn btn-primary" type="submit" id="p-save">${isNew ? 'Criar acesso' : 'Salvar'}</button></div>
    </form>`, { narrow: true });
  const f = $('#p-form'), g = id => $('#' + id, f);
  const curTipo = () => f.querySelector('input[name="p-tipo"]:checked').value;
  const collectJornada = () => {
    const k = g('p-jk').value, dias = $$('input[data-dia]:checked', f).map(i => +i.dataset.dia).sort();
    if (k !== 'custom') return { dias, blocos: JORNADAS[k].blocos };
    const blocos = [[g('p-j1a').value, g('p-j1b').value]]; if (g('p-j2').checked) blocos.push([g('p-j2a').value, g('p-j2b').value]);
    return { dias, blocos };
  };
  const jhint = () => { try { const j = collectJornada(); const ok = j.blocos.every(b => b[0] && b[1] && toMin(b[1]) > toMin(b[0])) && (j.blocos.length < 2 || toMin(j.blocos[1][0]) >= toMin(j.blocos[0][1])); g('p-jhint').textContent = ok ? `${j.blocos.length === 2 ? '3 registros por dia (entrada, volta do almoço e saída)' : '2 registros por dia (entrada e saída)'} · ${fmtMin(previstoMin(j))} previstas por dia útil.` : 'Confira os horários: cada turno precisa terminar depois de começar e o 2º turno vem depois do 1º.'; } catch { g('p-jhint').textContent = ''; } };
  const applyTipo = () => {
    const t = curTipo(), a = t === 'associado', e = t === 'estagiario';
    g('p-assoc-fields').hidden = !a; g('p-est-fields').hidden = !e; g('p-split').hidden = a || e; g('p-esc-field').hidden = a || e; g('p-oab-field').hidden = e; g('p-jornada').hidden = !(a || e);
    g('p-nome-label').textContent = e ? 'Nome do estagiário' : 'Nome do advogado';
    if (isNew && !f.dataset.jTouched) { g('p-jk').value = e ? 'manha' : 'integral'; g('p-jcustom').hidden = true; }
    $('#sheet-title').textContent = titleFor(t, isNew); jhint();
  };
  f.querySelectorAll('input[name="p-tipo"]').forEach(r => r.addEventListener('change', applyTipo)); applyTipo();
  g('p-jk').addEventListener('change', () => { f.dataset.jTouched = '1'; g('p-jcustom').hidden = g('p-jk').value !== 'custom'; jhint(); });
  g('p-j2').addEventListener('change', () => { g('p-j2row').hidden = !g('p-j2').checked; jhint(); });
  g('p-jornada').addEventListener('input', jhint);
  $$('.money', f).forEach(i => i.addEventListener('blur', () => { if (i.value.trim()) i.value = moneyInput(parseMoney(i.value)); }));
  g('p-pp').addEventListener('input', () => { g('p-pn').value = Math.round((100 - Math.min(100, Math.max(0, num(g('p-pp').value)))) * 100) / 100; });
  g('p-pn').addEventListener('input', () => { g('p-pp').value = Math.round((100 - Math.min(100, Math.max(0, num(g('p-pn').value)))) * 100) / 100; });
  g('p-nome').addEventListener('blur', () => { if (isNew && !g('p-user').value) { const parts = g('p-nome').value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).filter(Boolean); if (parts.length) g('p-user').value = parts.length > 1 ? parts[0] + '.' + parts[parts.length - 1] : parts[0]; } });
  g('p-cancel').addEventListener('click', closeSheet);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const err = g('p-err'), tipo = curTipo(), assoc = tipo === 'associado', est = tipo === 'estagiario';
    const nome = g('p-nome').value.trim(), usuario = normUser(g('p-user').value);
    if (!nome) return err.textContent = est ? 'Informe o nome do estagiário.' : 'Informe o nome do advogado.';
    if (!/^[a-z0-9._-]{3,}$/.test(usuario)) return err.textContent = 'Usuário: use ao menos 3 caracteres, só letras minúsculas, números, ponto, hífen ou sublinhado.';
    if (S.partners.some(x => x.usuario === usuario && x.id !== p?.id)) return err.textContent = 'Já existe um advogado com este usuário.';
    let pp = num(g('p-pp').value), pn = num(g('p-pn').value);
    const bon = Math.min(100, Math.max(0, num(g('p-bon').value)));
    if (assoc) { pp = bon; pn = Math.round((100 - bon) * 100) / 100; if (!g('p-area').value.trim()) return err.textContent = 'Informe a área de atuação do associado.'; }
    else if (est) { pp = 0; pn = 100; }
    else if (Math.abs(pp + pn - 100) > 0.01) return err.textContent = 'Os percentuais padrão precisam somar 100%.';
    let jornada = null;
    if (assoc || est) {
      jornada = collectJornada();
      if (!jornada.dias.length) return err.textContent = 'Marque ao menos um dia da semana na jornada.';
      if (!jornada.blocos.every(b => b[0] && b[1] && toMin(b[1]) > toMin(b[0])) || (jornada.blocos.length === 2 && toMin(jornada.blocos[1][0]) < toMin(jornada.blocos[0][1]))) return err.textContent = 'Confira os horários da jornada.';
    }
    const ini = est ? g('p-ini').value : '', fim = est ? g('p-fim').value : '';
    if (ini && fim && fim < ini) return err.textContent = 'O término do estágio não pode ser anterior ao início.';
    const data = { tipo, nome, oab: est ? '' : g('p-oab').value.trim(), escritorio: assoc || est ? '' : g('p-esc').value.trim(), email: g('p-email').value.trim(), telefone: g('p-tel').value.trim(), usuario, pctParceiroPadrao: pp, pctNossoPadrao: pn,
      areaAtuacao: assoc ? g('p-area').value.trim() : '', especializacao: assoc ? g('p-espec').value.trim() : '', salarioFixo: assoc ? parseMoney(g('p-sal').value) : 0, pctBonificacaoPadrao: assoc ? bon : 0, termos: assoc ? g('p-termos').value.trim() : '',
      curso: est ? g('p-curso').value.trim() : '', instituicao: est ? g('p-inst').value.trim() : '', supervisor: est ? g('p-sup').value.trim() : '', bolsa: est ? parseMoney(g('p-bolsa').value) : 0, inicioEstagio: ini || null, fimEstagio: fim || null, jornada };
    g('p-save').disabled = true; err.textContent = '';
    try {
      if (isNew) {
        const senha = g('p-pass').value; if (senha.length < 6) { err.textContent = 'A senha precisa ter pelo menos 6 caracteres.'; g('p-save').disabled = false; return; }
        await api.createPartner(data, senha);
        showCredentials(nome, usuario, senha, true);
      } else { await api.updatePartner(p.id, data); toast(est ? 'Estagiário atualizado.' : assoc ? 'Associado atualizado.' : 'Parceiro atualizado.'); closeSheet(); }
    } catch (e2) { err.textContent = writeError(e2); g('p-save').disabled = false; }
  });
}
function showCredentials(nome, usuario, senha, created) {
  const link = location.href.split('#')[0].split('?')[0];
  const extra = api.mode === 'claude' ? '\n\nEntre com a sua conta Claude (a mesma do e-mail convidado) e depois use este usuário e senha.' : '';
  const msg = `Olá, ${nome}! Seu acesso ao sistema de gestão do escritório Costa de Araújo:\nLink: ${link}\nUsuário: ${usuario}\nSenha: ${senha}${extra}`;
  openSheet(created ? 'Acesso criado' : 'Nova senha definida', `
    <p>Envie estes dados à pessoa. A senha não fica visível depois que esta janela for fechada.</p>
    <div class="copybox">
      <div class="kv"><span>Usuário</span><code>${esc(usuario)}</code></div>
      <div class="kv"><span>Senha</span><code>${esc(senha)}</code></div>
    </div>
    ${api.mode === 'claude' ? '<div class="note">O parceiro precisa abrir o link conectado à conta Claude convidada pelo escritório; só depois ele usa este usuário e senha.</div>' : ''}
    <div class="form-actions"><button class="btn" type="button" id="cred-copy">Copiar mensagem completa</button><button class="btn btn-primary" type="button" id="cred-ok">Concluir</button></div>`, { narrow: true });
  $('#cred-copy').addEventListener('click', () => copyText(msg));
  $('#cred-ok').addEventListener('click', closeSheet);
}
function resetPartnerPassword(p) {
  if (!p) return;
  const senha = genPassword();
  openSheet('Nova senha para ' + esc(p.nome), `
    <p>Uma nova senha será gerada para <b>${esc(p.nome)}</b> (usuário <code>${esc(p.usuario)}</code>). A senha atual deixa de funcionar.</p>
    <div class="field"><label for="rp-pass">Nova senha</label><input type="text" id="rp-pass" value="${senha}" spellcheck="false" minlength="6"></div>
    <p class="err" id="rp-err"></p>
    <div class="form-actions"><button class="btn" type="button" id="rp-cancel">Cancelar</button><button class="btn btn-primary" type="button" id="rp-ok">Definir nova senha</button></div>`, { narrow: true });
  $('#rp-cancel').addEventListener('click', closeSheet);
  $('#rp-ok').addEventListener('click', async () => {
    const s = $('#rp-pass').value; if (s.length < 6) { $('#rp-err').textContent = 'A senha precisa ter pelo menos 6 caracteres.'; return; }
    $('#rp-ok').disabled = true;
    try { await api.setPartnerPassword(p.id, s); showCredentials(p.nome, p.usuario, s, false); }
    catch (err) { $('#rp-err').textContent = writeError(err); $('#rp-ok').disabled = false; }
  });
}
function togglePartner(p) {
  if (!p) return;
  const off = p.ativo !== false;
  openSheet(off ? 'Desativar acesso' : 'Reativar acesso', `
    <p>${off ? `<b>${esc(p.nome)}</b> não conseguirá mais entrar no sistema. Os processos dele continuam registrados e visíveis para o escritório.` : `<b>${esc(p.nome)}</b> voltará a conseguir entrar com o usuário <code>${esc(p.usuario)}</code>.`}</p>
    <p class="err" id="tg-err"></p>
    <div class="form-actions"><button class="btn" type="button" id="tg-cancel">Cancelar</button><button class="btn ${off ? 'btn-danger' : 'btn-primary'}" type="button" id="tg-ok">${off ? 'Desativar' : 'Reativar'}</button></div>`, { narrow: true });
  $('#tg-cancel').addEventListener('click', closeSheet);
  $('#tg-ok').addEventListener('click', async () => {
    try { await api.setPartnerActive(p.id, !off); toast(off ? 'Acesso desativado.' : 'Acesso reativado.'); closeSheet(); }
    catch (err) { $('#tg-err').textContent = writeError(err); }
  });
}

/* ---------- minha senha (site) ---------- */
function openPasswordForm() {
  openSheet('Alterar minha senha', `
    <form id="pw-form" autocomplete="off" novalidate>
      <div class="field"><label for="pw-old">Senha atual</label><input type="password" id="pw-old" autocomplete="current-password" required></div>
      <div class="field"><label for="pw-new">Nova senha <small>(mínimo 8 caracteres)</small></label><input type="password" id="pw-new" minlength="8" autocomplete="new-password" required></div>
      <div class="field"><label for="pw-new2">Confirmar nova senha</label><input type="password" id="pw-new2" minlength="8" autocomplete="new-password" required></div>
      <p class="err" id="pw-err"></p>
      <div class="form-actions"><button class="btn" type="button" id="pw-cancel">Cancelar</button><button class="btn btn-primary" type="submit" id="pw-ok">Salvar</button></div>
    </form>`, { narrow: true });
  $('#pw-cancel').addEventListener('click', closeSheet);
  $('#pw-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#pw-err'), a = $('#pw-old').value, n = $('#pw-new').value, n2 = $('#pw-new2').value;
    if (n.length < 8) return err.textContent = 'A nova senha precisa ter pelo menos 8 caracteres.';
    if (n !== n2) return err.textContent = 'As senhas não conferem.';
    $('#pw-ok').disabled = true;
    try { await api.changePassword(a, n); toast('Senha alterada.'); closeSheet(); }
    catch (e2) { err.textContent = e2?.message || 'Não foi possível alterar a senha.'; $('#pw-ok').disabled = false; }
  });
}

/* ============ controle de ponto ============ */
/* Jornadas: dias da semana (0 = domingo) e 1 ou 2 turnos. Batidas esperadas: entrada (início do 1º turno),
   volta do almoço (início do 2º turno, quando houver) e saída (fim do último turno). */
const JORNADAS = {
  integral: { nome: 'Integral — 08:00 às 12:00 e 14:00 às 17:30', dias: [1, 2, 3, 4, 5], blocos: [['08:00', '12:00'], ['14:00', '17:30']] },
  manha: { nome: 'Manhã — 08:00 às 12:00', dias: [1, 2, 3, 4, 5], blocos: [['08:00', '12:00']] },
  tarde: { nome: 'Tarde — 14:00 às 17:30', dias: [1, 2, 3, 4, 5], blocos: [['14:00', '17:30']] }
};
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const WD_FULL = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const PT_TIPOS = { entrada: 'Entrada', volta: 'Volta do almoço', saida: 'Saída' };
const jornadaOf = p => (p?.jornada && Array.isArray(p.jornada.blocos) && p.jornada.blocos.length) ? { dias: p.jornada.dias || [1, 2, 3, 4, 5], blocos: p.jornada.blocos } : (isIntern(p) ? JORNADAS.manha : JORNADAS.integral);
const jornadaKey = j => Object.keys(JORNADAS).find(k => JSON.stringify(JORNADAS[k].blocos) === JSON.stringify(j.blocos)) || 'custom';
const jornadaLabel = j => j.blocos.map(b => `${b[0]}–${b[1]}`).join(' e ') + (JSON.stringify(j.dias) === JSON.stringify([1, 2, 3, 4, 5]) ? '' : ' · ' + j.dias.map(d => WD[d]).join(', '));
const toMin = h => h ? +String(h).slice(0, 2) * 60 + +String(h).slice(3, 5) : null;
const fmtMin = m => { const sg = m < 0 ? '−' : ''; m = Math.abs(Math.round(m)); return `${sg}${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };
const hhmm = h => h ? String(h).slice(0, 5) : '—';
const planOf = j => { const b = j.blocos, plan = [{ tipo: 'entrada', hora: b[0][0] }]; if (b.length > 1) plan.push({ tipo: 'volta', hora: b[1][0] }); plan.push({ tipo: 'saida', hora: b[b.length - 1][1] }); return plan; };
const previstoMin = j => j.blocos.reduce((sum, b) => sum + toMin(b[1]) - toMin(b[0]), 0);
const countsPunch = e => e.status === 'valido' || e.status === 'aprovado';
const weekdayOf = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const employees = () => S.partners.filter(p => isEmployee(p) && p.ativo !== false).sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
const pontoPendentes = () => S.ponto.filter(e => e.status === 'pendente');
const tolMin = () => num(S.pontoConfig?.toleranciaMin ?? 20);
const proofLabel = e => e.origem === 'manual' ? 'lançada pelo escritório' : e.origem === 'ajuste' ? 'ajuste' + (e.status === 'pendente' ? ' pendente' : e.status === 'aprovado' ? ' aprovado' : ' recusado') : (e.redeOk ? 'rede do escritório' : '') + (e.redeOk && e.gpsOk ? ' + ' : '') + (e.gpsOk ? `GPS${e.distanciaM != null ? ' (' + Math.round(e.distanciaM) + ' m)' : ''}` : '') || (e.distanciaM != null ? `fora do raio (${e.distanciaM >= 1000 ? (e.distanciaM / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' km' : Math.round(e.distanciaM) + ' m'})` : (e.observacao || 'sem prova'));

/* Dentro do período em que a pessoa está na equipe (cadastro, início/fim de estágio). */
function activeOn(p, date) {
  if (p.criadoEm && date < p.criadoEm.slice(0, 10)) return false;
  if (isIntern(p)) { if (p.inicioEstagio && date < p.inicioEstagio) return false; if (p.fimEstagio && date > p.fimEstagio) return false; }
  return true;
}
/* Cálculo de um dia: horas feitas, atraso, batidas faltantes e situação. */
function dayCalc(p, date) {
  const j = jornadaOf(p), plan = planOf(j), tol = tolMin(), today = todayISO();
  const all = S.ponto.filter(e => e.partnerId === p.id && e.data === date);
  const valid = all.filter(countsPunch).sort((a, b) => a.hora.localeCompare(b.hora));
  const by = {}; for (const e of valid) if (!by[e.tipo]) by[e.tipo] = e;
  const pend = all.filter(e => e.status === 'pendente');
  const util = j.dias.includes(weekdayOf(date)) && activeOn(p, date);
  const t = k => by[k] ? toMin(by[k].hora) : null;
  const ent = t('entrada'), vol = t('volta'), sai = t('saida');
  const b = j.blocos, two = b.length > 1, isToday = date === today, cur = toMin(nowHM());
  let feito = 0;
  if (ent != null) {
    let end1 = two ? toMin(b[0][1]) : sai;           // 1º turno: até o fim previsto (quando há 2 turnos) ou até a saída
    if (end1 == null && isToday) end1 = cur;          // turno único ainda em andamento
    if (end1 != null) { if (isToday && two) end1 = Math.min(end1, Math.max(cur, ent)); feito += Math.max(0, end1 - ent); }
  }
  if (two && vol != null) { if (sai != null) feito += Math.max(0, sai - vol); else if (isToday) feito += Math.max(0, cur - vol); }
  let atraso = 0;
  if (ent != null && ent > toMin(b[0][0]) + tol) atraso += ent - toMin(b[0][0]);
  if (two && vol != null && vol > toMin(b[1][0]) + tol) atraso += vol - toMin(b[1][0]);
  const fim = toMin(b[b.length - 1][1]);
  const extra = sai != null ? Math.max(0, sai - fim) : 0, antecipada = sai != null ? Math.max(0, fim - sai) : 0;
  const missing = plan.filter(x => !by[x.tipo]).map(x => x.tipo);
  const next = missing[0] || null;
  let status;
  if (date > today) status = 'futuro';
  else if (!util && !valid.length && !pend.length) status = 'folga';
  else if (!valid.length && !pend.length) status = isToday ? (cur > toMin(b[0][0]) + tol ? 'ausente' : 'aguardando') : 'falta';
  else if (isToday && missing.length) status = 'em_andamento';
  else if (missing.length) status = 'incompleto';
  else status = atraso > 0 ? 'atraso' : 'ok';
  return { j, plan, by, pend, util, feito, previsto: util ? previstoMin(j) : 0, atraso, extra, antecipada, missing, next, status, valid, all };
}
function monthCalc(p, ym) {
  const today = todayISO(), [y, m] = ym.split('-'), n = lastDay(y, m);
  const t = { diasUteis: 0, presencas: 0, faltas: 0, atrasos: 0, atrasoMin: 0, feito: 0, previsto: 0, incompletos: 0, extra: 0, pendentes: 0, dias: [] };
  for (let d = 1; d <= n; d++) {
    const date = `${ym}-${String(d).padStart(2, '0')}`; if (date > today) break;
    const c = dayCalc(p, date); t.dias.push({ date, ...c });
    if (c.util) { t.diasUteis++; t.previsto += c.previsto; }
    if (c.valid.length) t.presencas++;
    if (c.status === 'falta') t.faltas++;
    if (c.atraso > 0) { t.atrasos++; t.atrasoMin += c.atraso; }
    if (c.status === 'incompleto') t.incompletos++;
    t.feito += c.feito; t.extra += c.extra; t.pendentes += c.pend.length;
  }
  t.saldo = t.feito - t.previsto;
  return t;
}
const dayPill = st => ({ ok: '<span class="pill ok">Em dia</span>', atraso: '<span class="pill warn">Atraso</span>', falta: '<span class="pill bad">Falta</span>', incompleto: '<span class="pill warn">Incompleto</span>', em_andamento: '<span class="pill wait">Em expediente</span>', aguardando: '<span class="pill wait">Aguardando</span>', ausente: '<span class="pill bad">Não chegou</span>', folga: '<span class="pill muted">Folga</span>', futuro: '<span class="pill muted">—</span>' }[st] || '');
const punchCell = (c, tipo) => { const e = c.by[tipo]; if (e) return `<b>${hhmm(e.hora)}</b><span class="sub">${esc(proofLabel(e))}</span>`; const pd = c.pend.find(x => x.tipo === tipo); if (pd) return `<span class="muted">${hhmm(pd.hora)}</span><span class="sub" style="color:var(--warn)">pendente · ${esc(pd.origem === 'ajuste' ? 'ajuste' : proofLabel(pd))}</span>`; return c.plan.some(x => x.tipo === tipo) ? '<span class="muted">—</span>' : ''; };
const pontoMonths = () => { const out = [], d = new Date(); for (let i = 0; i < 13; i++) { const t = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`); } return out; };
async function ensurePontoMonth(ym) {
  const loadedFrom = pontoMonths()[1] + '-01'; // bootstrap traz do mês anterior em diante
  if (ym + '-01' >= loadedFrom || S.pontoLoaded?.has(ym)) return render();
  try { await api.loadPonto(ym + '-01', ym + '-31'); (S.pontoLoaded = S.pontoLoaded || new Set()).add(ym); } catch (e) { toast(writeError(e), true); }
  render();
}
const monthSelect = () => `<select id="fpt-mes" data-fpt="mes" aria-label="Mês">${pontoMonths().map(ym => `<option value="${ym}" ${S.fpt.mes === ym ? 'selected' : ''}>${ymLabel(ym)}</option>`).join('')}</select>`;

/* ---- geolocalização (prova por cerca virtual) ---- */
function geoNow(timeoutMs) {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve({ error: 'unsupported' });
    navigator.geolocation.getCurrentPosition(pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, precisao: Math.round(pos.coords.accuracy || 0) }), err => resolve({ error: err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable' }), { enableHighAccuracy: true, timeout: timeoutMs || 10000, maximumAge: 15000 });
  });
}
function distToOffice(lat, lng) { const c = S.pontoConfig; if (!c || c.lat == null || lat == null) return null; const R = 6371000, r = d => d * Math.PI / 180; const a = Math.sin(r(lat - c.lat) / 2) ** 2 + Math.cos(r(c.lat)) * Math.cos(r(lat)) * Math.sin(r(lng - c.lng) / 2) ** 2; return Math.round(2 * R * Math.asin(Math.sqrt(a))); }
async function checkGeo(force) {
  if (S.geo.state === 'checking') return;
  if (!force && S.geo.state !== 'idle' && Date.now() - (S.geo.at || 0) < 60000) return;
  S.geo = { state: 'checking' }; paintGeo();
  const g = await geoNow(10000);
  if (g.error) S.geo = { state: g.error, at: Date.now() };
  else { const dist = distToOffice(g.lat, g.lng); S.geo = { state: dist == null ? 'ok' : dist <= num(S.pontoConfig.raioM) + Math.min(g.precisao, 50) ? 'inside' : 'far', lat: g.lat, lng: g.lng, precisao: g.precisao, dist, at: Date.now() }; }
  paintGeo();
}
function geoText() {
  const c = S.pontoConfig || {}, g = S.geo, net = c.redeOk ? '<span class="ok">Você está na rede do escritório ✓</span>' : '';
  const fmtD = d => d >= 1000 ? (d / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' km' : d + ' m';
  let geo = '';
  if (!c.configurado) geo = 'O escritório ainda não configurou a validação de presença; o horário será registrado sem prova.';
  else if (g.state === 'checking') geo = 'Verificando sua localização…';
  else if (g.state === 'inside') geo = `<span class="ok">Você está a ${fmtD(g.dist)} do escritório ✓</span>${g.precisao > 100 ? ` <small>(precisão de ${g.precisao} m)</small>` : ''}`;
  else if (g.state === 'far') geo = `<span class="warn">Fora do raio do escritório (${fmtD(g.dist)}).</span> Se registrar agora, o horário fica pendente de validação.`;
  else if (g.state === 'ok') geo = 'Localização obtida.';
  else if (g.state === 'denied') geo = '<span class="warn">Permissão de localização negada.</span> Libere a localização para este site nas configurações do navegador.';
  else if (g.state === 'unsupported') geo = 'Este navegador não informa a localização.';
  else if (g.state === 'timeout' || g.state === 'unavailable') geo = '<span class="warn">Não foi possível obter sua localização.</span>';
  else geo = 'Localização ainda não verificada.';
  return `${net ? net + '<br>' : ''}${geo}${c.configurado && g.state !== 'checking' ? ' <button class="btn-link" type="button" data-act="geo-retry">verificar de novo</button>' : ''}`;
}
function paintGeo() { const el = $('#geo-status'); if (el) el.innerHTML = geoText(); const b = $('.punch-btn'); if (b) b.disabled = S.geo.state === 'checking' && !!S.pontoConfig?.configurado && S.pontoConfig.lat != null; }

/* ---- tela da pessoa: Meu ponto ---- */
function renderMyPonto() {
  const p = partnerById(myPartnerId()); if (!p) return '<div class="empty"><b>Cadastro não encontrado</b></div>';
  const today = todayISO(), c = dayCalc(p, today), j = c.j, ym = S.fpt.mes, mc = monthCalc(p, ym);
  const nextLabel = c.next ? `Registrar ${PT_TIPOS[c.next].toLowerCase()}` : null;
  const steps = c.plan.map(x => { const e = c.by[x.tipo], pd = c.pend.find(q => q.tipo === x.tipo); return `<div class="step ${e ? 'done' : pd ? 'pend' : x.tipo === c.next ? 'next' : ''}"><span class="lbl">${PT_TIPOS[x.tipo]}</span><b>${e ? hhmm(e.hora) : pd ? hhmm(pd.hora) + ' ?' : x.hora}</b><small>${e ? esc(proofLabel(e)) : pd ? 'pendente' : 'previsto'}</small></div>`; }).join('');
  if (S.geo.state === 'idle' && S.pontoConfig?.configurado && S.pontoConfig.lat != null) setTimeout(() => checkGeo(false), 50);
  const d = new Date();
  return `
    <div class="page-h"><div><h1>Meu controle de horário</h1><p>${esc(p.nome)} · ${tipoLabel(p).toLowerCase()} · jornada ${jornadaLabel(j)} · tolerância de ${tolMin()} min</p></div></div>
    <section class="punch-card">
      <div class="punch-clock"><div class="date">${WD_FULL[d.getDay()].charAt(0).toUpperCase() + WD_FULL[d.getDay()].slice(1)}, ${d.getDate()} de ${MONTHS_FULL[d.getMonth()].toLowerCase()}</div><div class="time" id="clock">${d.toTimeString().slice(0, 8)}</div><small>${api.features.serverClock ? 'o horário gravado é o do servidor' : 'horário do aparelho'}</small></div>
      <div class="punch-main">
        <div class="steps">${steps}</div>
        ${S.canWrite ? (nextLabel ? `<button class="punch-btn" type="button" data-act="punch" data-id="${c.next}">${nextLabel}</button>` : '<div class="punch-done">Jornada de hoje concluída ✓</div>') : ''}
        ${!c.util && c.next ? '<p class="hint">Hoje não é dia de expediente na sua jornada; o horário é registrado mesmo assim.</p>' : ''}
        <div class="geo-status" id="geo-status">${geoText()}</div>
      </div>
    </section>
    <div class="tiles">
      ${tile('Horas no mês', fmtMin(mc.feito), `de ${fmtMin(mc.previsto)} previstas`)}
      ${tile('Saldo', fmtMin(mc.saldo), mc.saldo < 0 ? 'a compensar' : 'a favor', mc.saldo < 0 ? 'neg' : 'pos')}
      ${tile('Atrasos', String(mc.atrasos), mc.atrasoMin ? fmtMin(mc.atrasoMin) + ' no total' : 'nenhum minuto')}
      ${tile('Faltas', String(mc.faltas), mc.incompletos ? `${mc.incompletos} dia${mc.incompletos === 1 ? '' : 's'} com registro faltando` : 'dias úteis sem registro')}
    </div>
    <div class="card-h"><h2>Espelho de ${ymLabel(ym)}</h2><div class="toolbar">${monthSelect()}${S.canWrite ? '<button class="btn btn-sm" type="button" data-act="ask-adjust">Esqueci de registrar — pedir ajuste</button>' : ''}</div></div>
    ${espelhoTable(p, mc, false)}
    <div class="tfoot"><span>Horas do 1º turno contam da entrada até o fim previsto do turno; do 2º, da volta até a saída.</span><span>Ajustes aprovados pelo escritório entram no espelho.</span></div>`;
}
function espelhoTable(p, mc, admin) {
  const two = jornadaOf(p).blocos.length > 1;
  const rows = mc.dias.slice().reverse().filter(d => d.status !== 'folga' || d.valid.length || d.pend.length).map(d => `<tr class="${d.status}">
    <td><span class="mono">${fmtDate(d.date)}</span><span class="sub">${WD[weekdayOf(d.date)]}</span></td>
    <td>${punchCell(d, 'entrada')}</td>${two ? `<td>${punchCell(d, 'volta')}</td>` : ''}<td>${punchCell(d, 'saida')}</td>
    <td class="num">${d.feito ? fmtMin(d.feito) : '—'}${d.previsto ? `<span class="sub">de ${fmtMin(d.previsto)}</span>` : ''}</td>
    <td>${dayPill(d.status)}${d.atraso ? `<span class="sub">atraso ${fmtMin(d.atraso)}</span>` : d.extra ? `<span class="sub">+${fmtMin(d.extra)} além do horário</span>` : d.antecipada && d.status !== 'incompleto' ? `<span class="sub">saiu ${fmtMin(d.antecipada)} antes</span>` : ''}</td>
  </tr>`).join('');
  return `<div class="table-wrap"><table class="espelho"><thead><tr><th>Dia</th><th>Entrada</th>${two ? '<th>Volta</th>' : ''}<th>Saída</th><th class="num">Horas</th><th>Situação</th></tr></thead><tbody>${rows || `<tr><td colspan="6" class="muted">Nenhum dia útil ainda neste mês.</td></tr>`}</tbody></table></div>`;
}
async function doPunch(tipo) {
  const btn = $('.punch-btn'); if (btn) { btn.disabled = true; btn.textContent = 'Registrando…'; }
  let g = {};
  if (S.pontoConfig?.configurado && S.pontoConfig.lat != null) { const r = await geoNow(12000); if (!r.error) { g = r; S.geo = { state: 'ok', ...r, dist: distToOffice(r.lat, r.lng), at: Date.now() }; if (S.geo.dist != null) S.geo.state = S.geo.dist <= num(S.pontoConfig.raioM) + Math.min(r.precisao, 50) ? 'inside' : 'far'; } else S.geo = { state: r.error, at: Date.now() }; }
  try {
    const r = await api.punch({ tipo, lat: g.lat ?? null, lng: g.lng ?? null, precisao: g.precisao ?? null });
    const a = r.avaliacao || {};
    if (a.status === 'pendente') toast(`${PT_TIPOS[tipo]} registrada às ${a.hora} — fora do escritório; fica pendente de validação.`, true);
    else toast(`${PT_TIPOS[tipo]} registrada às ${a.hora}${a.redeOk || a.gpsOk ? ' ✓' : ''}.`);
    if (api.mode === 'claude') render();
  } catch (e) { toast(writeError(e), true); render(); }
}
function openAdjustForm() {
  const p = partnerById(myPartnerId()), plan = planOf(jornadaOf(p));
  openSheet('Pedir ajuste de horário', `
    <form id="aj-form" autocomplete="off" novalidate>
      <p class="hint">Use quando esqueceu de registrar ou o registro não foi feito. O escritório recebe o pedido e, se aprovar, o horário entra no seu espelho.</p>
      <div class="row">
        <div class="field"><label for="aj-data">Dia</label><input type="date" id="aj-data" value="${todayISO()}" max="${todayISO()}" required></div>
        <div class="field"><label for="aj-tipo">Registro</label><select id="aj-tipo">${plan.map(x => `<option value="${x.tipo}">${PT_TIPOS[x.tipo]} (previsto ${x.hora})</option>`).join('')}</select></div>
        <div class="field"><label for="aj-hora">Horário</label><input type="time" id="aj-hora" value="${plan[0].hora}" required></div>
      </div>
      <div class="field"><label for="aj-just">Motivo</label><textarea id="aj-just" placeholder="ex.: cheguei às 8h05 mas o celular estava sem bateria" required></textarea></div>
      <p class="err" id="aj-err"></p>
      <div class="form-actions"><button class="btn" type="button" id="aj-cancel">Cancelar</button><button class="btn btn-primary" type="submit" id="aj-ok">Enviar pedido</button></div>
    </form>`, { narrow: true });
  const f = $('#aj-form');
  $('#aj-tipo').addEventListener('change', () => { const x = plan.find(q => q.tipo === $('#aj-tipo').value); if (x) $('#aj-hora').value = x.hora; });
  $('#aj-cancel').addEventListener('click', closeSheet);
  f.addEventListener('submit', async e => {
    e.preventDefault(); const err = $('#aj-err');
    const data = { data: $('#aj-data').value, tipo: $('#aj-tipo').value, hora: $('#aj-hora').value, justificativa: $('#aj-just').value.trim() };
    if (!data.data || !data.hora) return err.textContent = 'Informe o dia e o horário.';
    if (!data.justificativa) return err.textContent = 'Explique o motivo do ajuste.';
    $('#aj-ok').disabled = true;
    try { await api.requestAdjust(data); toast('Pedido enviado ao escritório.'); closeSheet(); if (api.mode === 'claude') render(); }
    catch (e2) { err.textContent = writeError(e2); $('#aj-ok').disabled = false; }
  });
}

/* ---- administração: aba Ponto ---- */
function renderPonto() {
  const c = S.pontoConfig || {}, configured = c.lat != null || (c.ips && c.ips.length), today = todayISO(), ym = S.fpt.mes;
  const list = employees().filter(p => !S.fpt.pessoa || p.id === S.fpt.pessoa);
  const todayCalc = list.map(p => ({ p, d: dayCalc(p, today) }));
  const inOffice = todayCalc.filter(x => x.d.status === 'em_andamento' && x.d.by.entrada && !x.d.by.saida && (!x.d.plan.some(q => q.tipo === 'volta') || x.d.by.volta || nowHM() < x.d.j.blocos[0][1])).length;
  const lateToday = todayCalc.filter(x => x.d.atraso > 0).length, absent = todayCalc.filter(x => x.d.status === 'ausente').length;
  const pend = pontoPendentes().filter(e => !S.fpt.pessoa || e.partnerId === S.fpt.pessoa).sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
  const two = list.some(p => jornadaOf(p).blocos.length > 1);
  const todayRows = todayCalc.map(({ p, d }) => `<tr data-pessoa="${esc(p.id)}" tabindex="0">
    <td><b>${esc(p.nome)}</b><span class="sub">${esc(partnerKind(p))}</span></td>
    <td><span class="mono">${jornadaLabel(d.j)}</span>${d.util ? '' : '<span class="sub">folga hoje</span>'}</td>
    <td>${punchCell(d, 'entrada')}</td>${two ? `<td>${punchCell(d, 'volta')}</td>` : ''}<td>${punchCell(d, 'saida')}</td>
    <td class="num">${d.feito ? fmtMin(d.feito) : '—'}</td>
    <td>${dayPill(d.status)}${d.atraso ? `<span class="sub">atraso ${fmtMin(d.atraso)}</span>` : ''}</td>
  </tr>`).join('');
  const monthRows = list.map(p => { const m = monthCalc(p, ym); return `<tr data-pessoa="${esc(p.id)}" tabindex="0">
    <td><b>${esc(p.nome)}</b><span class="sub">${esc(partnerKind(p))}</span></td>
    <td class="num">${m.diasUteis}</td><td class="num">${m.presencas}</td>
    <td class="num ${m.faltas ? 'neg' : ''}">${m.faltas}${m.incompletos ? `<span class="sub">+${m.incompletos} incompleto${m.incompletos === 1 ? '' : 's'}</span>` : ''}</td>
    <td class="num ${m.atrasos ? 'neg' : ''}">${m.atrasos}${m.atrasoMin ? `<span class="sub">${fmtMin(m.atrasoMin)}</span>` : ''}</td>
    <td class="num">${fmtMin(m.feito)}<span class="sub">de ${fmtMin(m.previsto)}</span></td>
    <td class="num ${m.saldo < 0 ? 'neg' : 'pos'}">${fmtMin(m.saldo)}${m.pendentes ? `<span class="sub" style="color:var(--warn)">${m.pendentes} pendente${m.pendentes === 1 ? '' : 's'}</span>` : ''}</td>
  </tr>`; }).join('');
  const pendRows = pend.map(e => { const p = partnerById(e.partnerId); return `<div class="prov-row proc pend-row">
    <span class="pr-main"><b>${esc(p?.nome || '—')} · ${PT_TIPOS[e.tipo] || e.tipo} às ${hhmm(e.hora)} em ${fmtDate(e.data)}</b><small>${e.origem === 'ajuste' ? 'Pedido de ajuste: ' + esc(e.justificativa || '—') : 'Registro fora do escritório: ' + esc(proofLabel(e)) + (e.ip ? ' · IP ' + esc(e.ip) : '') + (e.precisao ? ' · precisão ' + Math.round(e.precisao) + ' m' : '')}</small></span>
    <span class="pr-side"><button class="btn btn-sm btn-primary" type="button" data-act="ponto-decide" data-id="${esc(e.id)}" data-dec="aprovado">Aprovar</button><button class="btn btn-sm" type="button" data-act="ponto-decide" data-id="${esc(e.id)}" data-dec="recusado">Recusar</button></span></div>`; }).join('');
  return `
    <div class="page-h"><div><h1>Controle de horário dos colaboradores</h1><p>Entrada, volta do almoço e saída de associados e estagiários, com prova por localização${api.features.ip ? ' e rede do escritório' : ''}.</p></div>
      <div class="toolbar">
        ${monthSelect()}
        <select id="fpt-pessoa" data-fpt="pessoa" aria-label="Pessoa"><option value="">Toda a equipe</option>${employees().map(p => `<option value="${esc(p.id)}" ${S.fpt.pessoa === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select>
        ${api.features.export ? `<button class="btn" type="button" data-act="export-ponto" data-id="${esc(S.fpt.pessoa)}">Exportar espelho (CSV)</button>` : ''}
        ${S.canWrite ? `<button class="btn" type="button" data-act="ponto-manual" data-id="${esc(S.fpt.pessoa)}">+ Registro manual</button><button class="btn btn-primary" type="button" data-act="ponto-config">Configurar</button>` : ''}
      </div></div>
    ${!configured ? `<div class="ro-banner" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span style="flex:1 1 260px"><b>A validação de presença ainda não está configurada.</b> Informe a localização${api.features.ip ? ' e o IP' : ''} do escritório para que os registros feitos fora dele fiquem pendentes.</span><button class="btn btn-sm btn-primary" type="button" data-act="ponto-config">Configurar agora</button></div>` : ''}
    ${!employees().length ? `<div class="empty"><b>Ninguém registra horário ainda</b>Cadastre advogados associados e estagiários em “Parceiros e associados”; cada um recebe um login e a aba “Meu horário”.</div>` : `
    <div class="tiles">
      ${tile('No escritório agora', String(inOffice), `de ${list.length} pessoa${list.length === 1 ? '' : 's'}`)}
      ${tile('Atrasos hoje', String(lateToday), `tolerância de ${tolMin()} min`, lateToday ? 'neg' : '')}
      ${tile('Ainda não chegaram', String(absent), 'dia útil, após a tolerância', absent ? 'neg' : '')}
      ${tile('Pendências', String(pend.length), 'registros fora do escritório e ajustes', pend.length ? 'neg' : '')}
    </div>
    <div class="card-h"><h2>Hoje, ${fmtDate(today)}</h2><small>${WD_FULL[weekdayOf(today)]}</small></div>
    <div class="table-wrap"><table class="espelho"><thead><tr><th>Pessoa</th><th>Jornada</th><th>Entrada</th>${two ? '<th>Volta</th>' : ''}<th>Saída</th><th class="num">Horas</th><th>Situação</th></tr></thead><tbody>${todayRows}</tbody></table></div>
    ${pend.length ? `<div class="card-h" style="margin-top:18px"><h2>Pendências</h2><small>${pend.length} para decidir</small></div><div class="prov-list" style="max-height:none">${pendRows}</div>` : ''}
    <div class="card-h" style="margin-top:18px"><h2>Resumo de ${ymLabel(ym)}</h2><small>clique na pessoa para ver o espelho dia a dia</small></div>
    <div class="table-wrap"><table><thead><tr><th>Pessoa</th><th class="num">Dias úteis</th><th class="num">Presenças</th><th class="num">Faltas</th><th class="num">Atrasos</th><th class="num">Horas</th><th class="num">Saldo</th></tr></thead><tbody>${monthRows}</tbody></table></div>
    <div class="tfoot"><span>Falta = dia útil da jornada sem nenhum registro. Incompleto = dia com registro faltando (peça o ajuste à pessoa ou lance manualmente).</span><span>${api.features.serverClock ? 'Horários gravados pelo servidor.' : 'Horários do aparelho de quem bate (versão no Claude).'}</span></div>`}`;
}
function openEspelho(p, ym) {
  if (!p) return;
  const mc = monthCalc(p, ym);
  openSheet(`Espelho de horário — ${p.nome}`, `
    <p class="hint">${esc(partnerKind(p))} · jornada ${jornadaLabel(jornadaOf(p))} · ${ymLabel(ym)}</p>
    <div class="summary" style="margin-bottom:12px"><div><div class="lbl">Horas</div><div class="v">${fmtMin(mc.feito)} <small>/ ${fmtMin(mc.previsto)}</small></div></div><div><div class="lbl">Saldo</div><div class="v ${mc.saldo < 0 ? 'neg' : ''}">${fmtMin(mc.saldo)}</div></div><div><div class="lbl">Faltas · atrasos</div><div class="v">${mc.faltas} · ${mc.atrasos}</div></div></div>
    ${espelhoTable(p, mc, true)}
    <div class="form-actions">${S.canWrite ? `<button class="btn left" type="button" id="esp-manual">+ Registro manual</button>` : ''}${api.features.export ? `<button class="btn" type="button" id="esp-csv">Exportar CSV</button>` : ''}<button class="btn btn-primary" type="button" id="esp-ok">Fechar</button></div>`);
  $('#esp-ok').addEventListener('click', closeSheet);
  $('#esp-csv')?.addEventListener('click', () => exportPontoCSV(p.id));
  $('#esp-manual')?.addEventListener('click', () => openManualPunch(p.id));
}
function openManualPunch(pid) {
  const list = employees(); if (!list.length) return toast('Cadastre um associado ou estagiário primeiro.', true);
  openSheet('Registro manual de horário', `
    <form id="mp-form" autocomplete="off" novalidate>
      <p class="hint">Use para lançar um horário que não foi registrado pelo sistema (ex.: celular sem bateria). Entra como aprovada e fica na trilha de auditoria.</p>
      <div class="field"><label for="mp-pessoa">Pessoa</label><select id="mp-pessoa">${list.map(p => `<option value="${esc(p.id)}" ${p.id === pid ? 'selected' : ''}>${esc(p.nome)} — ${esc(partnerKind(p))}</option>`).join('')}</select></div>
      <div class="row">
        <div class="field"><label for="mp-data">Dia</label><input type="date" id="mp-data" value="${todayISO()}" max="${todayISO()}" required></div>
        <div class="field"><label for="mp-tipo">Registro</label><select id="mp-tipo"><option value="entrada">Entrada</option><option value="volta">Volta do almoço</option><option value="saida">Saída</option></select></div>
        <div class="field"><label for="mp-hora">Horário</label><input type="time" id="mp-hora" value="08:00" required></div>
      </div>
      <div class="field"><label for="mp-obs">Observação <small>(opcional)</small></label><input type="text" id="mp-obs" placeholder="ex.: informado por WhatsApp às 8h02"></div>
      <p class="err" id="mp-err"></p>
      <div class="form-actions"><button class="btn" type="button" id="mp-cancel">Cancelar</button><button class="btn btn-primary" type="submit" id="mp-ok">Registrar</button></div>
    </form>`, { narrow: true });
  $('#mp-cancel').addEventListener('click', closeSheet);
  $('#mp-form').addEventListener('submit', async e => {
    e.preventDefault(); const err = $('#mp-err');
    const d = { partnerId: $('#mp-pessoa').value, data: $('#mp-data').value, tipo: $('#mp-tipo').value, hora: $('#mp-hora').value, observacao: $('#mp-obs').value.trim() };
    if (!d.data || !d.hora) return err.textContent = 'Informe o dia e o horário.';
    $('#mp-ok').disabled = true;
    try { await api.manualPunch(d); toast('Horário registrado.'); closeSheet(); if (api.mode === 'claude') render(); }
    catch (e2) { err.textContent = writeError(e2); $('#mp-ok').disabled = false; }
  });
}
async function decidePunch(id, decisao) {
  const e = S.ponto.find(x => x.id === id); if (!e) return;
  if (decisao === 'recusado') {
    openSheet('Recusar registro', `<p>Recusar ${PT_TIPOS[e.tipo].toLowerCase()} de <b>${esc(partnerName(e.partnerId))}</b> às ${hhmm(e.hora)} em ${fmtDate(e.data)}?</p><div class="field"><label for="rc-motivo">Motivo <small>(opcional, fica no registro)</small></label><input type="text" id="rc-motivo"></div><div class="form-actions"><button class="btn" type="button" id="rc-no">Voltar</button><button class="btn btn-danger" type="button" id="rc-yes">Recusar</button></div>`, { narrow: true });
    $('#rc-no').addEventListener('click', closeSheet);
    $('#rc-yes').addEventListener('click', async () => { try { await api.decidePunch(id, 'recusado', $('#rc-motivo').value.trim()); toast('Registro recusado.'); closeSheet(); if (api.mode === 'claude') render(); } catch (err) { toast(writeError(err), true); } });
    return;
  }
  try { await api.decidePunch(id, 'aprovado', ''); toast('Registro aprovado.'); if (api.mode === 'claude') render(); } catch (err) { toast(writeError(err), true); }
}
function openPontoConfig() {
  const c = { endereco: '', lat: null, lng: null, raioM: 150, ips: [], toleranciaMin: 20, exigirProva: true, fuso: 'America/Fortaleza', ...(S.pontoConfig || {}) };
  const FUSOS = ['America/Fortaleza', 'America/Sao_Paulo', 'America/Belem', 'America/Recife', 'America/Bahia', 'America/Manaus', 'America/Cuiaba', 'America/Rio_Branco'];
  openSheet('Configurar o controle de horário', `
    <form id="pc-form" autocomplete="off" novalidate>
      <fieldset><legend>Onde fica o escritório (cerca virtual)</legend>
        <div class="field"><label for="pc-end">Endereço <small>(só para referência)</small></label><input type="text" id="pc-end" value="${esc(c.endereco || '')}"></div>
        <div class="row">
          <div class="field"><label for="pc-lat">Latitude</label><input type="text" id="pc-lat" inputmode="decimal" value="${c.lat ?? ''}" placeholder="-2.5000"></div>
          <div class="field"><label for="pc-lng">Longitude</label><input type="text" id="pc-lng" inputmode="decimal" value="${c.lng ?? ''}" placeholder="-44.3000"></div>
          <div class="field"><label for="pc-raio">Raio aceito <small>(metros)</small></label><input type="number" id="pc-raio" min="20" max="5000" value="${num(c.raioM) || 150}"></div>
        </div>
        <div class="row" style="align-items:center"><button class="btn btn-sm" type="button" id="pc-here">Usar minha localização atual</button><small class="muted" id="pc-here-st">Clique estando no escritório para preencher latitude e longitude.</small></div>
      </fieldset>
      ${api.features.ip ? `<fieldset><legend>Rede do escritório</legend>
        <div class="field"><label for="pc-ips">IPs autorizados <small>(um por linha; aceita final * para faixa)</small></label><textarea id="pc-ips" rows="3" placeholder="ex.: 187.10.5.23">${esc((c.ips || []).join('\n'))}</textarea></div>
        <div class="row" style="align-items:center"><button class="btn btn-sm" type="button" id="pc-myip">Adicionar meu IP atual</button><small class="muted" id="pc-myip-st">Clique conectado ao Wi-Fi do escritório. Se o provedor trocar o IP, basta adicionar o novo.</small></div>
      </fieldset>` : '<p class="hint">Na versão hospedada no Claude a prova é só por localização (GPS); a checagem pela rede do escritório existe no site próprio.</p>'}
      <fieldset><legend>Regras</legend>
        <div class="row">
          <div class="field"><label for="pc-tol">Tolerância de atraso <small>(minutos)</small></label><input type="number" id="pc-tol" min="0" max="180" value="${num(c.toleranciaMin)}"></div>
          <div class="field"><label for="pc-fuso">Fuso horário</label><select id="pc-fuso">${FUSOS.map(f => `<option ${c.fuso === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
        </div>
        <label class="check" for="pc-prova"><input type="checkbox" id="pc-prova" ${c.exigirProva !== false ? 'checked' : ''}><span>Exigir prova de presença<small>registros fora do escritório ficam pendentes até você aprovar; desmarcado, todo registro vale</small></span></label>
      </fieldset>
      <p class="err" id="pc-err"></p>
      <div class="form-actions"><button class="btn" type="button" id="pc-cancel">Cancelar</button><button class="btn btn-primary" type="submit" id="pc-ok">Salvar</button></div>
    </form>`);
  $('#pc-cancel').addEventListener('click', closeSheet);
  $('#pc-here').addEventListener('click', async () => { const st = $('#pc-here-st'); st.textContent = 'Obtendo localização…'; const g = await geoNow(12000); if (g.error) { st.textContent = g.error === 'denied' ? 'Permissão negada. Libere a localização para este site.' : 'Não foi possível obter a localização.'; return; } $('#pc-lat').value = g.lat.toFixed(6); $('#pc-lng').value = g.lng.toFixed(6); st.textContent = `Preenchido (precisão de ${g.precisao} m).`; });
  $('#pc-myip')?.addEventListener('click', async () => { const st = $('#pc-myip-st'); const ip = await api.myIp(); if (!ip) { st.textContent = 'Não foi possível descobrir o IP.'; return; } const ta = $('#pc-ips'), cur = ta.value.split(/\s+/).filter(Boolean); if (!cur.includes(ip)) { cur.push(ip); ta.value = cur.join('\n'); } st.textContent = `IP ${ip} adicionado.`; });
  $('#pc-form').addEventListener('submit', async e => {
    e.preventDefault(); const err = $('#pc-err');
    const lat = $('#pc-lat').value.trim().replace(',', '.'), lng = $('#pc-lng').value.trim().replace(',', '.');
    if ((lat === '') !== (lng === '')) return err.textContent = 'Informe latitude e longitude juntas.';
    const data = { endereco: $('#pc-end').value.trim(), lat: lat === '' ? null : Number(lat), lng: lng === '' ? null : Number(lng), raioM: Number($('#pc-raio').value) || 150, ips: $('#pc-ips') ? $('#pc-ips').value.split(/[\s,;]+/).filter(Boolean) : [], toleranciaMin: Number($('#pc-tol').value) || 0, exigirProva: $('#pc-prova').checked, fuso: $('#pc-fuso').value };
    if (data.lat != null && (!Number.isFinite(data.lat) || !Number.isFinite(data.lng))) return err.textContent = 'Latitude/longitude inválidas.';
    $('#pc-ok').disabled = true;
    try { const r = await api.savePontoConfig(data); S.pontoConfig = { ...S.pontoConfig, ...(r?.config || data), configurado: data.lat != null || data.ips.length > 0 }; toast('Configuração salva.'); closeSheet(); render(); }
    catch (e2) { err.textContent = writeError(e2); $('#pc-ok').disabled = false; }
  });
}
async function exportPontoCSV(pid) {
  const list = employees().filter(p => !pid || p.id === pid), ym = S.fpt.mes;
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = ['Pessoa', 'Tipo', 'Dia', 'Semana', 'Entrada', 'Volta do almoço', 'Saída', 'Horas feitas', 'Horas previstas', 'Atraso (min)', 'Situação', 'Provas'];
  const rows = [];
  for (const p of list) for (const d of monthCalc(p, ym).dias) {
    if (d.status === 'folga' && !d.valid.length) continue;
    const prova = ['entrada', 'volta', 'saida'].filter(t => d.by[t]).map(t => `${PT_TIPOS[t]}: ${proofLabel(d.by[t])}`).join(' · ');
    rows.push([p.nome, tipoLabel(p), fmtDate(d.date), WD[weekdayOf(d.date)], hhmm(d.by.entrada?.hora), hhmm(d.by.volta?.hora), hhmm(d.by.saida?.hora), fmtMin(d.feito), fmtMin(d.previsto), d.atraso, { ok: 'Em dia', atraso: 'Atraso', falta: 'Falta', incompleto: 'Incompleto', em_andamento: 'Em expediente', aguardando: 'Aguardando', ausente: 'Não chegou', folga: 'Folga' }[d.status] || d.status, prova].map(q).join(';'));
  }
  const csv = '﻿' + head.map(q).join(';') + '\r\n' + rows.join('\r\n');
  try { const ok = await api.exportCSV(`espelho-horario-${ym}${pid ? '-' + (partnerById(pid)?.nome || '').toLowerCase().replace(/\s+/g, '-') : ''}.csv`, csv); if (ok) toast('Espelho exportado.'); }
  catch (err) { toast(err?.message || 'Não foi possível exportar.', true); }
}

/* ---------- exportação CSV ---------- */
async function exportCSV() {
  const list = filtered(true);
  const n = v => num(v).toFixed(2).replace('.', ',');
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = ['Data do protocolo', 'Natureza', 'Fase', 'Situação', 'Número do processo', 'Cliente', 'Parceiro', 'Tipo de ação', 'Valor da ação', 'Valor da condenação', '% honorários (escritório)', 'Honorários pretendidos', 'Custo do lead', '% parceiro', '% escritório', 'Parte do parceiro', 'Parte do escritório', 'Recebido', 'Valor recebido', 'Data do recebimento', 'Corretor', 'Nome do corretor', 'Valor do corretor', 'Corretor pago', 'Observações'];
  const rows = list.map(c => { const m = metrics(c); return [fmtDate(c.dataProtocolo), natOf(c) === 'judicial' ? 'Judicial' : 'Administrativo', faseOf(c) === 'julgado' ? 'Julgado' : 'Em curso', { em_andamento: 'Em andamento', recebido: 'Recebido', perdido: 'Perdido' }[resultadoOf(c)], numFmt(c), c.cliente, partnerName(c.parceiroId), c.tipoAcao, c.valorAcao != null ? n(c.valorAcao) : '', c.valorCondenacao != null ? n(c.valorCondenacao) : '', c.pctHonorarios != null ? n(c.pctHonorarios) : '', n(m.pretendido), n(m.custoLead), n(c.pctParceiro), n(c.pctNosso), n(m.parteParceiro), n(m.nossaParte), c.recebido ? 'Sim' : 'Não', c.recebido ? n(m.recebido) : '', c.recebido ? fmtDate(c.dataRecebimento) : '', c.temCorretor ? 'Sim' : 'Não', c.nomeCorretor || '', c.temCorretor ? n(c.valorCorretor) : '', c.temCorretor ? (c.corretorPago ? 'Sim' : 'Não') : '', c.observacoes || ''].map(q).join(';'); });
  const csv = '﻿' + head.map(q).join(';') + '\r\n' + rows.join('\r\n');
  try { const ok = await api.exportCSV(`parcerias-processos-${todayISO()}.csv`, csv); if (ok) toast('Arquivo exportado.'); }
  catch (err) { toast(err?.message || 'Não foi possível exportar.', true); }
}

boot();
})();
