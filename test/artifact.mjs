/*
 * Teste da versão ARTIFACT (dist/parcerias-artifact.html) no navegador, com um banco em memória
 * que imita a API `window.claude.use('db')` do Claude (collection/doc/add/update/delete/get/where/onSnapshot).
 * Percorre: configuração → associado → processo só do escritório → honorários parcelados →
 * contrato + recebimento → baixa de provisionados → visão geral por braço.
 *   npm run build:artifact && node test/artifact.mjs
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const html = fs.readFileSync(path.resolve('dist/parcerias-artifact.html'), 'utf8');
const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
await new Promise(r => server.listen(3995, r));
const BASE = 'http://localhost:3995/';

const MOCK = `(() => {
  const KEY = '__mock_db__'; const listeners = [];
  const store = {}; try { const raw = JSON.parse(localStorage.getItem(KEY) || '{}'); for (const k in raw) store[k] = new Map(Object.entries(raw[k])); } catch {}
  const persist = () => { try { const o = {}; for (const k in store) o[k] = Object.fromEntries(store[k]); localStorage.setItem(KEY, JSON.stringify(o)); } catch {} };
  const uid = () => 'm' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const col = name => (store[name] = store[name] || new Map());
  const notify = () => { persist(); for (const l of listeners) try { l(); } catch (e) { console.error(e); } };
  const snapDoc = (name, id) => { const d = col(name).get(id); return { id, exists: !!d, data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined) }; };
  const matches = (d, filters) => filters.every(([f, op, v]) => op === '==' ? d[f] === v : true);
  function query(name, filters = [], lim = 0) {
    const run = () => { let docs = [...col(name).entries()].filter(([, d]) => matches(d, filters)).map(([id]) => snapDoc(name, id)); if (lim) docs = docs.slice(0, lim); return { docs, empty: !docs.length, size: docs.length }; };
    return {
      where: (f, op, v) => query(name, [...filters, [f, op, v]], lim),
      limit: n => query(name, filters, n),
      get: async () => run(),
      onSnapshot: (cb, _err) => { const l = () => cb(run()); listeners.push(l); setTimeout(l, 0); return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); }; },
      add: async data => { const id = uid(); col(name).set(id, JSON.parse(JSON.stringify(data))); notify(); return { id }; }
    };
  }
  const db = {
    collection: name => query(name),
    doc: p => { const [name, id] = p.split('/'); return {
      get: async () => snapDoc(name, id),
      set: async data => { col(name).set(id, JSON.parse(JSON.stringify(data))); notify(); },
      update: async patch => { const cur = col(name).get(id); if (!cur) throw Object.assign(new Error('not found'), { code: 'not_found' }); col(name).set(id, { ...cur, ...JSON.parse(JSON.stringify(patch)) }); notify(); },
      delete: async () => { col(name).delete(id); notify(); },
      onSnapshot: (cb) => { const l = () => cb(snapDoc(name, id)); listeners.push(l); setTimeout(l, 0); return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); }; }
    }; }
  };
  const user = { isOwner: async () => true, can: async () => true, current: async () => ({ id: 'owner' }) };
  const downloads = { save: async () => true };
  window.__mockStore = store;
  window.claude = { use: async name => (name === 'db' ? db : name === 'user' ? user : name === 'downloads' ? downloads : null) };
})();`;

const browser = await chromium.launch();
const errors = [];
let failures = 0;
const check = (name, cond) => { console.log((cond ? '  ok  ' : '  FALHOU ') + name); if (!cond) failures++; };
try {
  const OFFICE = { latitude: -2.4950, longitude: -44.3020 };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light', locale: 'pt-BR', geolocation: OFFICE, permissions: ['geolocation'] });
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_TUNNEL|net::/.test(m.text())) errors.push(m.text()); });

  await page.goto(BASE);
  await page.waitForSelector('#setup-form', { timeout: 8000 });
  check('artifact: primeiro acesso mostra a configuração inicial (proprietário)', true);
  await page.fill('#st-user', 'admin'); await page.fill('#st-pass', 'senha-forte-123'); await page.fill('#st-pass2', 'senha-forte-123');
  await page.click('#st-btn');
  await page.waitForSelector('#tabs', { timeout: 8000 });
  const tabs = await page.$$eval('#tabs [data-tab]', els => els.map(e => e.dataset.tab));
  check('administração vê todas as abas, inclusive contratos e ponto', tabs.join(',') === 'overview,cases,partners,credits,contracts,finance,ponto');

  // associado
  await page.click('[data-tab="partners"]'); await page.click('[data-act="new-associado"]'); await page.waitForSelector('#p-form');
  await page.fill('#p-nome', 'Carla Nunes'); await page.press('#p-nome', 'Tab');
  await page.fill('#p-area', 'Trabalhista'); await page.fill('#p-sal', '4500'); await page.fill('#p-bon', '20');
  await page.click('#p-save'); await page.waitForSelector('#cred-ok', { timeout: 8000 }); await page.click('#cred-ok');
  await page.waitForFunction(() => [...document.querySelectorAll('.pcard')].some(c => c.textContent.includes('Carla Nunes')), null, { timeout: 8000 });
  check('associado gravado no banco com tipo e bonificação', await page.evaluate(() => { const p = [...window.__mockStore.partners.values()][0]; return p.tipo === 'associado' && p.pctBonificacaoPadrao === 20 && p.salarioFixo === 4500 && p.hash && p.salt; }));

  // processo do associado recebido → receita + bonificação
  await page.click('[data-tab="cases"]'); await page.click('[data-act="new-case"]');
  await page.selectOption('#c-partner', { index: 1 });
  await page.fill('#c-num', '08011111120268170001'); await page.fill('#c-cliente', 'Empresa Ré'); await page.fill('#c-tipo', 'Reclamação trabalhista'); await page.fill('#c-hon', '10000');
  await page.check('#c-res-rec'); await page.waitForSelector('#c-lancar');
  check('prévia do associado mostra bonificação em vez de repasse', /Bonificação/.test(await page.textContent('#fin-box')));
  await page.click('#c-save');
  await page.waitForFunction(() => [...document.querySelectorAll('tr[data-id]')].some(tr => tr.textContent.includes('Empresa Ré') && tr.textContent.includes('no financeiro')), null, { timeout: 8000 });
  check('financeiro recebeu receita total e bonificação (20%)', await page.evaluate(() => { const f = [...window.__mockStore.finance.values()]; return f.length === 2 && f.some(e => e.tipo === 'receita' && e.valor === 10000) && f.some(e => e.tipo === 'despesa' && e.categoria === 'Bonificação de associado' && e.valor === 2000); }));

  // processo só do escritório: valor pretendido × nossa % → honorários previstos
  await page.click('[data-act="new-case"]'); await page.check('#c-tit-esc'); await page.waitForTimeout(100);
  await page.fill('#c-num', '08033333320268170001'); await page.fill('#c-cliente', 'Cliente Direto'); await page.fill('#c-tipo', 'Ação indenizatória');
  await page.fill('#c-vacao', '40000'); await page.fill('#c-phon', '20'); await page.press('#c-phon', 'Tab');
  check('honorários previstos calculados no artifact (20% de 40 mil)', (await page.inputValue('#c-hon')) === '8.000,00');
  await page.click('#c-save');
  await page.waitForFunction(() => [...document.querySelectorAll('tr[data-id]')].some(tr => tr.textContent.includes('Cliente Direto')), null, { timeout: 8000 });
  check('processo do escritório gravado sem parceiro, com % e honorários previstos', !(await page.$('#fn-form')) && await page.evaluate(() => [...window.__mockStore.cases.values()].some(c => c.titularidade === 'escritorio' && c.parceiroId === null && c.valorAcao === 40000 && c.pctHonorarios === 20 && c.honorariosPretendidos === 8000)) && (await page.textContent('tr[data-id]:has-text("Cliente Direto")')).includes('ESCRITÓRIO'));

  // honorários iniciais: receita do Financeiro vinculada ao processo, parcelada
  await page.click('[data-tab="finance"]'); await page.waitForSelector('.provbox', { timeout: 8000 });
  await page.click('[data-act="new-receita"]'); await page.waitForSelector('#fn-form');
  await page.fill('#fn-cat', 'Honorários iniciais'); await page.fill('#fn-valor', '4000');
  const optVal = await page.$eval('#fn-case option:has-text("Cliente Direto")', o => o.value); await page.selectOption('#fn-case', optVal); await page.waitForTimeout(100);
  await page.check('#fn-pp'); await page.waitForTimeout(100);
  await page.fill('#fn-np', '4'); await page.fill('#fn-d1', '2026-07-05'); await page.press('#fn-d1', 'Tab'); await page.waitForTimeout(100);
  await page.click('#fn-save'); await page.waitForFunction(() => !document.querySelector('#fn-form'), null, { timeout: 8000 });
  check('4 parcelas gravadas e vinculadas ao processo: 1 realizada e 3 provisionadas', await page.evaluate(() => { const cid = [...window.__mockStore.cases.entries()].find(([, c]) => c.cliente === 'Cliente Direto')[0]; const f = [...window.__mockStore.finance.values()].filter(e => e.parcela); return f.length === 4 && f.filter(e => e.status === 'provisionado').length === 3 && f.every(e => e.grupoId && e.valor === 1000 && e.caseId === cid); }));
  // despesa recorrente no artifact (lote gravado documento a documento) → contas a pagar → reajuste dos seguintes → exclusão do grupo
  await page.click('[data-act="new-recorrente"]'); await page.waitForSelector('#fn-form');
  await page.fill('#fn-cat', 'Aluguel'); await page.fill('#fn-valor', '3500'); await page.fill('#fn-r1', '2026-01'); await page.fill('#fn-r2', '2026-12'); await page.fill('#fn-rd', '5'); await page.press('#fn-rd', 'Tab'); await page.waitForTimeout(100);
  await page.click('#fn-save'); await page.waitForFunction(() => !document.querySelector('#fn-form') && document.querySelector('.provbox.pay'), null, { timeout: 8000 });
  const hojeA = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10), pagosA = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-05`).filter(d => d <= hojeA).length;
  check(`aluguel recorrente: 12 meses gravados, ${pagosA} pagos e ${12 - pagosA} a pagar, com competência e grupo`, await page.evaluate(n => { const f = [...window.__mockStore.finance.values()].filter(e => e.categoria === 'Aluguel'); return f.length === 12 && f.filter(e => e.status === 'realizado').length === n && f.every(e => e.grupoId && e.competencia && e.vencimento && /Aluguel — /.test(e.descricao)); }, pagosA));
  await page.click('tr[data-fin]:has-text("Aluguel — dezembro/2026")'); await page.waitForSelector('#fn-form');
  await page.click('#fn-del'); await page.waitForSelector('#fn-del-yes');
  check('excluir o último mês não oferece excluir seguintes', !(await page.$('#fn-del-grupo')));
  await page.click('#fn-del-no'); await page.click('#fn-cancel');
  await page.click('tr[data-fin]:has-text("Aluguel — novembro/2026")'); await page.waitForSelector('#fn-form');
  await page.fill('#fn-valor', '3800'); await page.check('#fn-aplicar'); await page.click('#fn-save');
  await page.waitForFunction(() => !document.querySelector('#fn-form'), null, { timeout: 8000 }); await page.waitForTimeout(200);
  check('reajuste aplicado a novembro e dezembro; os anteriores seguem R$ 3.500', await page.evaluate(() => { const f = [...window.__mockStore.finance.values()].filter(e => e.categoria === 'Aluguel'); return f.filter(e => e.valor === 3800).length === 2 && f.filter(e => e.valor === 3500).length === 10; }));
  await page.click('tr[data-fin]:has-text("Aluguel — novembro/2026")'); await page.waitForSelector('#fn-form');
  await page.click('#fn-del'); await page.waitForSelector('#fn-del-grupo'); await page.check('#fn-del-grupo'); await page.click('#fn-del-yes');
  await page.waitForFunction(() => !document.querySelector('#fn-form'), null, { timeout: 8000 }); await page.waitForTimeout(200);
  check('encerrar a recorrência exclui novembro e dezembro, mantendo os meses anteriores', await page.evaluate(() => [...window.__mockStore.finance.values()].filter(e => e.categoria === 'Aluguel').length === 10));

  // contrato + recebimento do mês
  await page.click('[data-tab="contracts"]'); await page.click('[data-act="new-contract"]'); await page.waitForSelector('#ct-form');
  await page.fill('#ct-emp', 'Empresa Alfa'); await page.fill('#ct-val', '2500'); await page.fill('#ct-dia', '10'); await page.fill('#ct-ini', '2026-06-01');
  await page.click('#ct-save'); await page.waitForSelector('td[data-ct][data-ym="2026-09"]', { timeout: 8000 });
  await page.click('td[data-ct][data-ym="2026-09"]'); await page.waitForSelector('#rc-form'); await page.click('#rc-save');
  await page.waitForFunction(() => document.querySelector('td[data-ct][data-ym="2026-09"]')?.classList.contains('ok'), null, { timeout: 8000 });
  check('mensalidade do contrato gravada como receita com competência', await page.evaluate(() => [...window.__mockStore.finance.values()].some(e => e.contractId && e.competencia === '2026-09' && e.valor === 2500)));

  // baixa dos provisionados
  await page.click('[data-tab="finance"]'); await page.waitForSelector('.provbox', { timeout: 8000 });
  await page.click('[data-act="open-prov"]'); await page.waitForSelector('.prov-list');
  const nRows = (await page.$$('.prov-row')).length;
  check('lista de provisionados traz as 3 parcelas, as mensalidades em aberto e o processo em andamento', nRows >= 7 && (await page.$$('.prov-row:has-text("Honorários iniciais")')).length === 3 && (await page.$$('.prov-row.proc:has-text("Cliente Direto")')).length === 1);
  await page.click('#pv-all'); await page.waitForTimeout(100);
  await page.click('#pv-ok');
  await page.waitForFunction(() => !document.querySelector('.prov-list'), null, { timeout: 8000 });
  check('vencidos baixados: parcelas 2 e 3 realizadas, mensalidades em aberto viraram receita', await page.evaluate(() => { const f = [...window.__mockStore.finance.values()]; return f.filter(e => e.parcela && e.status === 'provisionado').length === 1 && f.filter(e => e.contractId).length >= 4; }));

  // julgado → valor da condenação → quanto recebemos
  await page.click('[data-act="open-prov"]'); await page.waitForSelector('.prov-row.proc'); await page.click('.prov-row.proc [data-pv-case]');
  await page.waitForSelector('#case-form', { timeout: 8000 });
  await page.check('#c-fase-julg'); await page.fill('#c-vcond', '50000'); await page.press('#c-vcond', 'Tab');
  check('honorários recalculados sobre a condenação no artifact', (await page.inputValue('#c-hon')) === '10.000,00');
  await page.fill('#c-vsuc', '5000'); await page.press('#c-vsuc', 'Tab'); await page.waitForTimeout(100);
  check('sucumbenciais saem da base no artifact (20% de 45 mil = 9.000)', (await page.inputValue('#c-hon')) === '9.000,00');
  await page.check('#c-res-rec'); await page.waitForSelector('#c-lancar');
  check('recebido no artifact: contratuais 9.000 + sucumbenciais 5.000 preenchidos', (await page.inputValue('#c-vrecc')) === '9.000,00' && (await page.inputValue('#c-vrecs')) === '5.000,00');
  await page.fill('#c-vrecc', '8500'); await page.press('#c-vrecc', 'Tab');
  await page.click('#c-save'); await page.waitForFunction(() => !document.querySelector('#case-form'), null, { timeout: 8000 });
  await page.waitForTimeout(300);
  check('processo julgado e recebido: condenação, sucumbenciais, valor recebido e receita de alvará gravados', await page.evaluate(() => { const c = [...window.__mockStore.cases.values()].find(x => x.cliente === 'Cliente Direto'); const f = [...window.__mockStore.finance.values()]; return c.fase === 'julgado' && c.valorCondenacao === 50000 && c.honorariosSucumbenciais === 5000 && c.honorariosPretendidos === 9000 && c.valorRecebido === 13500 && c.sucumbRecebido === 5000 && c.financeiroStatus === 'lancado' && f.some(e => e.categoria === 'Alvará de honorários finais' && e.valor === 13500 && /sucumbenciais/.test(e.observacoes)); }));

  // visão geral
  await page.click('[data-tab="overview"]'); await page.waitForSelector('.seg', { timeout: 8000 });
  await page.click('.seg [data-act="seg"][data-id="all"]'); await page.waitForSelector('#chart-arms svg', { timeout: 8000 });
  check('visão geral por braço desenhada no artifact', (await page.$$('#chart-arms rect.seg')).length >= 2);
  await page.screenshot({ path: path.resolve('test/shots/artifact-visao-geral.png'), fullPage: true });

  // ---- ponto no artifact: estagiário + GPS (horário do aparelho) ----
  await page.click('[data-tab="partners"]'); await page.click('[data-act="new-estagiario"]'); await page.waitForSelector('#p-form');
  await page.fill('#p-nome', 'Pedro Lima'); await page.press('#p-nome', 'Tab'); await page.fill('#p-bolsa', '900');
  const senhaEst = await page.inputValue('#p-pass');
  await page.click('#p-save'); await page.waitForSelector('#cred-ok', { timeout: 8000 }); await page.click('#cred-ok');
  await page.waitForFunction(() => [...document.querySelectorAll('.pcard')].some(c => c.textContent.includes('Pedro Lima')), null, { timeout: 8000 });
  check('estagiário gravado no banco do artifact com tipo, bolsa e jornada', await page.evaluate(() => [...window.__mockStore.partners.values()].some(p => p.tipo === 'estagiario' && p.bolsa === 900 && p.jornada && p.jornada.blocos.length === 1)));
  await page.click('[data-tab="ponto"]'); await page.waitForSelector('[data-act="ponto-config"]');
  await page.click('.page-h [data-act="ponto-config"]'); await page.waitForSelector('#pc-form');
  check('no artifact a configuração não oferece IP (só GPS)', !(await page.$('#pc-ips')));
  await page.click('#pc-here'); await page.waitForFunction(() => /Preenchido/.test(document.querySelector('#pc-here-st')?.textContent || ''), null, { timeout: 8000 });
  await page.click('#pc-ok'); await page.waitForFunction(() => !document.querySelector('#pc-form'), null, { timeout: 8000 });
  check('configuração do ponto gravada em config/ponto', await page.evaluate(() => { const c = window.__mockStore.config.get('ponto'); return c && Math.abs(c.lat - (-2.495)) < 0.001 && c.raioM === 150; }));
  await page.click('#btn-logout'); await page.waitForSelector('#login-form');
  await page.fill('#lg-user', 'pedro.lima'); await page.fill('#lg-pass', senhaEst); await page.click('#lg-btn'); await page.waitForSelector('#tabs', { timeout: 8000 });
  check('estagiário no artifact vê só "Meu ponto"', (await page.$$eval('#tabs [data-tab]', els => els.map(e => e.dataset.tab))).join(',') === 'ponto');
  await page.waitForSelector('.punch-btn'); await page.waitForFunction(() => /do escritório ✓/.test(document.querySelector('#geo-status')?.textContent || ''), null, { timeout: 8000 });
  await page.click('.punch-btn');
  await page.waitForFunction(() => document.querySelector('.step.done'), null, { timeout: 8000 });
  check('batida gravada com GPS dentro do raio e horário do aparelho', await page.evaluate(() => { const e = [...window.__mockStore.ponto.values()][0]; return e && e.tipo === 'entrada' && e.gpsOk === true && e.status === 'valido' && /^\d{2}:\d{2}:\d{2}$/.test(e.hora) && e.distanciaM < 50; }));
  await page.click('#btn-logout'); await page.waitForSelector('#login-form');
  await page.fill('#lg-user', 'admin'); await page.fill('#lg-pass', 'senha-forte-123'); await page.click('#lg-btn'); await page.waitForSelector('#tabs', { timeout: 8000 });
  await page.click('[data-tab="ponto"]'); await page.waitForSelector('.espelho', { timeout: 8000 });
  check('admin vê a entrada do estagiário na aba Ponto', /Pedro Lima/.test(await page.textContent('.espelho')) && /GPS/.test(await page.textContent('.espelho')));

  // sessão persiste e sair
  await page.reload(); await page.waitForSelector('#tabs', { timeout: 8000 });
  check('sessão do artifact persiste ao recarregar', true);
  await page.click('#btn-logout'); await page.waitForSelector('#login-form', { timeout: 8000 });
  await page.fill('#lg-user', 'admin'); await page.fill('#lg-pass', 'errada'); await page.click('#lg-btn');
  await page.waitForFunction(() => /incorretos/.test(document.querySelector('#login-form')?.textContent || ''), null, { timeout: 8000 });
  check('senha errada recusada no artifact', true);
  await ctx.close();
} catch (e) { console.error('Erro no teste:', e); failures++; }
finally { await browser.close(); server.close(); }
if (errors.length) { console.log('Erros de página:', errors); failures++; }
console.log(failures ? `\n${failures} falha(s).` : '\nArtifact OK no navegador.');
process.exit(failures ? 1 : 0);
