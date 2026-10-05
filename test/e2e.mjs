/*
 * Teste de ponta a ponta no navegador (Chromium/Playwright) contra o servidor real:
 * configuração inicial → login → parceiro → processo → crédito → login do parceiro.
 * Gera capturas em test/shots/. Requer `playwright` instalado (npm i -D playwright).
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parcerias-e2e-'));
const PORT = 3998, BASE = `http://localhost:${PORT}`;
const env = { ...process.env, PORT: String(PORT), DB_PATH: path.join(tmp, 'e2e.db'), JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres-ok', COOKIE_SECURE: 'false', TRUST_PROXY: '0' };
const server = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => server.stdout.on('data', d => { if (String(d).includes('rodando')) r(); }));
const shots = path.resolve('test/shots'); fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const errors = [];
let failures = 0;
const check = (name, cond) => { console.log((cond ? '  ok  ' : '  FALHOU ') + name); if (!cond) failures++; };
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark', locale: 'pt-BR' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_TUNNEL|net::/.test(m.text())) errors.push(m.text()); });

  await page.goto(BASE);
  await page.waitForSelector('#setup-form', { timeout: 5000 });
  check('primeiro acesso mostra a configuração inicial', true);
  await page.fill('#st-user', 'admin'); await page.fill('#st-pass', 'senha-forte-123'); await page.fill('#st-pass2', 'senha-forte-123');
  await page.click('#st-btn');
  await page.waitForSelector('#tabs', { timeout: 5000 });
  check('após a configuração entra no painel', await page.isVisible('#tabs'));

  // parceiro
  await page.click('[data-tab="partners"]');
  await page.click('[data-act="new-partner"]');
  await page.fill('#p-nome', 'Mariana Lopes'); await page.fill('#p-esc', 'Lopes & Andrade Advogados');
  await page.press('#p-nome', 'Tab');
  const sugerido = await page.inputValue('#p-user');
  check('usuário sugerido a partir do nome', sugerido === 'mariana.lopes');
  const senhaParceira = await page.inputValue('#p-pass');
  await page.click('#p-save');
  await page.waitForSelector('#cred-ok', { timeout: 5000 });
  check('acesso do parceiro criado com credenciais exibidas', (await page.textContent('.copybox')).includes('mariana.lopes'));
  await page.click('#cred-ok');
  await page.waitForSelector('.pcard');

  // processo
  await page.click('[data-tab="cases"]');
  await page.click('[data-act="new-case"]');
  await page.selectOption('#c-partner', { index: 1 });
  await page.fill('#c-num', '08012345620268170001'); await page.fill('#c-cliente', 'João Pereira'); await page.fill('#c-tipo', 'Ação contra casa de apostas');
  await page.fill('#c-hon', '25000'); await page.fill('#c-lead', '350');
  await page.check('#c-cor'); await page.fill('#c-corn', 'Indicador'); await page.fill('#c-corv', '500');
  await page.click('#c-save');
  await page.waitForSelector('tr[data-id]', { timeout: 5000 });
  check('processo aparece na tabela com CNJ formatado', (await page.textContent('tr[data-id]')).includes('0801234-56.2026.8.17.0001'));
  // processo administrativo
  await page.click('[data-act="new-case"]');
  await page.selectOption('#c-partner', { index: 1 });
  await page.check('#c-nat-adm');
  check('rótulo muda para protocolo ao escolher administrativo', (await page.textContent('#c-num-label')).includes('protocolo'));
  await page.fill('#c-num', '12345.678901/2026-00'); await page.fill('#c-cliente', 'Maria Adm'); await page.fill('#c-tipo', 'Requerimento administrativo');
  await page.fill('#c-hon', '4000');
  await page.click('#c-save');
  await page.waitForFunction(() => document.querySelectorAll('tr[data-id]').length === 2, null, { timeout: 5000 });
  check('processo administrativo aparece com a etiqueta ADM e número livre', (await page.textContent('#view')).includes('ADM') && (await page.textContent('#view')).includes('12345.678901/2026-00'));
  await page.selectOption('#f-nat', 'administrativo'); await page.waitForTimeout(200);
  check('filtro "só administrativos" funciona', (await page.$$('tr[data-id]')).length === 1);
  await page.selectOption('#f-nat', ''); await page.waitForTimeout(200);
  // marcar o processo judicial como finalizado e recebido, lançando no financeiro
  await page.click('tr[data-id]:has-text("João Pereira")');
  await page.waitForSelector('#case-form');
  await page.check('#c-fase-julg');
  check('rótulo do valor muda para honorários contratuais (valor combinado)', (await page.textContent('#c-hon-label')).includes('contratuais'));
  check('julgado mostra o bloco de condenação e sucumbenciais dentro de Honorários', await page.isVisible('#c-cond-home #c-cond-block') && await page.isVisible('#c-vsuc'));
  await page.check('#c-res-rec');
  await page.waitForSelector('#c-lancar');
  check('ao marcar recebido, a pergunta da condenação/sucumbenciais desce para a seção de recebimento', await page.isVisible('#c-rec-cond #c-cond-block') && /condenação/i.test(await page.textContent('#c-cond-head')));
  check('recebido: contratuais preenchidos com os honorários, data preenchida e opção de lançar marcada', (await page.inputValue('#c-vrecc')) === '25.000,00' && (await page.inputValue('#c-vrecs')) === '' && (await page.inputValue('#c-drec')) !== '' && await page.isChecked('#c-lancar'));
  check('divisão dos sucumbenciais na parceria vem meio a meio', (await page.inputValue('#c-psp')) === '50' && (await page.inputValue('#c-psn')) === '50');
  await page.fill('#c-vcond', '100000'); await page.press('#c-vcond', 'Tab');
  await page.fill('#c-vsuc', '10000'); await page.press('#c-vsuc', 'Tab'); await page.waitForTimeout(100);
  check('condenação líquida calculada (total − sucumbenciais)', /90\.000,00/.test((await page.textContent('#c-cond-hint')).replace(/\u00a0/g, ' ')));
  check('sucumbenciais recebidos acompanham o valor fixado', (await page.inputValue('#c-vrecs')) === '10.000,00');
  check('total recebido = contratuais + sucumbenciais', /35\.000,00/.test((await page.textContent('#c-rec-hint')).replace(/\u00a0/g, ' ')));
  const finBox = (await page.textContent('#fin-box')).replace(/\u00a0/g, ' ');
  check('prévia mostra receita total e repasse (50% de 25 mil + 50% de 10 mil = 17.500)', /Receita.*35\.000,00/.test(finBox) && /Repasse a parceiro.*17\.500,00/.test(finBox));
  await page.click('#c-save');
  await page.waitForFunction(() => [...document.querySelectorAll('tr[data-id]')].some(tr => tr.textContent.includes('João Pereira') && tr.textContent.includes('no financeiro')), null, { timeout: 5000 });
  const rowJoao = await page.textContent('tr[data-id]:has-text("João Pereira")');
  check('tabela mostra recebido e lançado no financeiro', rowJoao.includes('no financeiro') && !rowJoao.includes('lançar'));
  // perdido
  await page.click('tr[data-id]:has-text("Maria Adm")');
  await page.waitForSelector('#case-form'); await page.check('#c-res-per'); await page.click('#c-save');
  await page.waitForFunction(() => [...document.querySelectorAll('tr[data-id]')].some(tr => tr.textContent.includes('Maria Adm') && tr.textContent.includes('Perdido')), null, { timeout: 5000 });
  check('processo perdido aparece com a situação Perdido', true);

  // créditos
  await page.click('[data-tab="credits"]');
  await page.click('[data-act="new-credit"]');
  await page.fill('#cr-num', '08099999920268170001'); await page.fill('#cr-ced', 'Fulano Cedente'); await page.fill('#cr-vc', '10000'); await page.fill('#cr-vr', '16000');
  await page.fill('#cr-dp', '2027-02-10');
  check('resumo do formulário calcula o lucro', (await page.textContent('#cr-summary')).replace(/ /g, ' ').includes('R$ 6.000,00'));
  await page.click('#cr-save');
  await page.waitForSelector('tr[data-credit]', { timeout: 5000 });
  check('crédito aparece na tabela com a data prevista', (await page.textContent('tr[data-credit]')).replace(/ /g, ' ').includes('previsto para 10/02/2027'));
  // mais créditos pela API (para a linha do tempo): atrasado, sem data, meses variados e um recebido
  const extras = [
    { numeroProcesso: '08000000120268170001', cedente: 'Cedente A', dataCompra: '2026-05-02', dataPrevista: '2026-08-30', valorCompra: 8000, valorReceber: 12500 },
    { numeroProcesso: '08000000220268170001', cedente: 'Cedente B', dataCompra: '2026-06-10', dataPrevista: null, valorCompra: 5000, valorReceber: 7000 },
    { numeroProcesso: '08000000320268170001', cedente: 'Cedente C', dataCompra: '2026-07-01', dataPrevista: '2026-11-20', valorCompra: 20000, valorReceber: 31000 },
    { numeroProcesso: '08000000420268170001', cedente: 'Cedente D', dataCompra: '2026-07-15', dataPrevista: '2026-11-05', valorCompra: 9000, valorReceber: 14000 },
    { numeroProcesso: '08000000520268170001', cedente: 'Cedente E', dataCompra: '2026-08-01', dataPrevista: '2027-05-01', valorCompra: 30000, valorReceber: 45000 },
    { numeroProcesso: '08000000620268170001', cedente: 'Cedente F', dataCompra: '2026-03-01', dataPrevista: '2026-09-01', valorCompra: 6000, valorReceber: 9000, recebido: true, valorRecebido: 9000, dataRecebimento: '2026-09-03' }
  ];
  await page.evaluate(async list => { for (const c of list) await fetch('/api/credits', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify(c) }); }, extras);
  await page.reload(); await page.waitForSelector('#chart-timeline svg', { timeout: 8000 });
  check('linha do tempo desenhada com colunas', (await page.$$('#chart-timeline path.col')).length >= 4);
  check('linha do tempo marca o atrasado', (await page.$$('#chart-timeline path.col.late')).length === 1);
  await page.screenshot({ path: path.join(shots, 'e2e-creditos.png'), fullPage: true });

  // financeiro
  await page.click('[data-tab="finance"]');
  await page.waitForSelector('tr[data-fin]', { timeout: 5000 });
  check('financeiro já traz a receita e o repasse do processo e a despesa da compra do crédito', (await page.$$('tr[data-fin]')).length === 3 && (await page.textContent('#view')).includes('PROCESSO') && (await page.textContent('#view')).includes('Compra de créditos'));
  await page.click('[data-act="new-despesa"]');
  await page.fill('#fn-cat', 'Aluguel'); await page.fill('#fn-valor', '3500'); await page.fill('#fn-data', '2026-09-05');
  await page.click('#fn-save');
  await page.waitForFunction(() => [...document.querySelectorAll('tr[data-fin]')].some(tr => tr.textContent.includes('Aluguel')), null, { timeout: 5000 });
  check('despesa aparece nos lançamentos', true);
  await page.click('[data-act="new-receita"]');
  check('formulário abre já como receita', await page.isChecked('#fn-t-rec'));
  await page.fill('#fn-cat', 'Honorários iniciais'); await page.fill('#fn-desc', 'Cliente João Pereira'); await page.fill('#fn-valor', '9000'); await page.fill('#fn-data', '2026-09-12');
  await page.click('#fn-save');
  await page.waitForFunction(() => document.querySelectorAll('tr[data-fin]').length === 5, null, { timeout: 5000 });
  const finExtras = [];
  const cats = [['despesa', 'Energia', 420], ['despesa', 'Funcionários', 4200], ['despesa', 'Tráfego pago', 1500], ['despesa', 'Sistemas e software', 380], ['despesa', 'Limpeza', 300], ['receita', 'Alvará de honorários finais', 12000], ['receita', 'Honorários iniciais', 6500]];
  for (let m = 3; m <= 9; m++) for (const [tipo, categoria, valor] of cats) finExtras.push({ tipo, categoria, valor: Math.round(valor * (0.6 + ((m * 7 + categoria.length) % 9) / 10)), data: `2026-${String(m).padStart(2, '0')}-10` });
  finExtras.push({ tipo: 'despesa', categoria: 'Impostos e taxas', valor: 25000, data: '2026-04-20' });
  await page.evaluate(async list => { for (const c of list) await fetch('/api/finance', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify(c) }); }, finExtras);
  await page.reload(); await page.waitForSelector('#chart-finance svg', { timeout: 8000 });
  check('gráfico do financeiro desenhado com as duas séries', (await page.$$('#chart-finance path.col')).length >= 10 && (await page.$$('#chart-finance circle')).length >= 7);
  check('resultado do ano exibido', /Lucro|Prejuízo/.test(await page.textContent('.hero .lbl')));
  await page.click('tr[data-fmes="09"]');
  await page.waitForTimeout(300);
  check('clicar no mês filtra os lançamentos', (await page.textContent('#fin-entries')).includes('setembro'));
  await page.screenshot({ path: path.join(shots, 'e2e-financeiro.png'), fullPage: true });

  // advogado associado
  await page.click('[data-tab="partners"]');
  await page.click('[data-act="new-associado"]');
  await page.waitForSelector('#p-form');
  check('formulário abre já como associado, com área e termos', await page.isChecked('#p-t-ass') && await page.isVisible('#p-area') && await page.isVisible('#p-termos') && !(await page.isVisible('#p-split')));
  await page.fill('#p-nome', 'Carla Nunes'); await page.press('#p-nome', 'Tab');
  await page.fill('#p-area', 'Trabalhista'); await page.fill('#p-espec', 'Direito do Trabalho'); await page.fill('#p-sal', '4500'); await page.fill('#p-bon', '20'); await page.fill('#p-termos', 'Salário fixo + 20% sobre o êxito de cada processo');
  await page.click('#p-save');
  await page.waitForSelector('#cred-ok', { timeout: 5000 }); await page.click('#cred-ok');
  await page.waitForFunction(() => [...document.querySelectorAll('.pcard')].some(c => c.textContent.includes('Carla Nunes')), null, { timeout: 5000 });
  const cardCarla = await page.textContent('.pcard:has-text("Carla Nunes")');
  check('cartão do associado mostra o tipo com a área de atuação', /associado/i.test(cardCarla) && /Trabalhista/.test(cardCarla));
  await page.click('[data-act="fp"][data-id="associado"]').catch(() => {});
  await page.waitForTimeout(150);

  // processo somente do escritório: valor pretendido × nossa % → honorários previstos (provisionamento)
  await page.click('[data-tab="cases"]');
  await page.click('[data-act="new-case"]');
  await page.check('#c-tit-esc'); await page.waitForTimeout(100);
  check('titularidade "somente do escritório" esconde o parceiro e mostra a % de honorários finais', !(await page.isVisible('#c-partner-field')) && await page.isVisible('#c-phon-field') && !(await page.isVisible('#c-vcond-field')));
  await page.fill('#c-num', '08033333320268170001'); await page.fill('#c-cliente', 'Cliente Direto'); await page.fill('#c-tipo', 'Ação indenizatória');
  await page.fill('#c-vacao', '40000'); await page.fill('#c-phon', '20'); await page.press('#c-phon', 'Tab');
  check('honorários previstos calculados (20% de 40 mil)', (await page.inputValue('#c-hon')) === '8.000,00' && /Calculado: 20% de R\$ 40\.000,00/.test((await page.textContent('#c-hon-hint')).replace(/\u00a0/g, ' ')));
  check('não há mais campos de honorários iniciais no processo', !(await page.$('#c-phi')) && !(await page.$('#c-hi-fin')));
  await page.click('#c-save');
  await page.waitForFunction(() => [...document.querySelectorAll('tr[data-id]')].some(tr => tr.textContent.includes('Cliente Direto')), null, { timeout: 5000 });
  check('ao salvar não abre formulário de receita; processo aparece com etiqueta ESCRITÓRIO e honorários previstos', !(await page.$('#fn-form')) && (await page.textContent('tr[data-id]:has-text("Cliente Direto")')).includes('ESCRITÓRIO') && (await page.textContent('tr[data-id]:has-text("Cliente Direto")')).replace(/\u00a0/g, ' ').includes('8.000,00'));

  // defesa do executado: honorários sobre a redução do débito + honorários iniciais pagos
  await page.click('[data-act="new-case"]'); await page.waitForSelector('#case-form');
  await page.check('#c-tit-esc'); await page.waitForTimeout(100);
  await page.fill('#c-num', '08077777720268170001'); await page.fill('#c-cliente', 'Executado Ltda');
  await page.fill('#c-tipo', 'Defesa do executado (embargos / impugnação)'); await page.press('#c-tipo', 'Tab'); await page.waitForTimeout(100);
  check('tipo "defesa do executado" sugere a base "redução do débito" e 25%', await page.isChecked('#c-base-red') && await page.isVisible('#c-red-fields') && (await page.inputValue('#c-phon')) === '25');
  await page.fill('#c-vdeb', '200000'); await page.fill('#c-vdev', '120000'); await page.press('#c-vdev', 'Tab'); await page.waitForTimeout(100);
  check('redução pretendida de R$ 80.000 e honorários de 25% = R$ 20.000', /80\.000,00/.test((await page.textContent('#c-red-hint')).replace(/\u00a0/g, ' ')) && (await page.inputValue('#c-hon')) === '20.000,00');
  await page.fill('#c-hini', '5000'); await page.press('#c-hini', 'Tab'); await page.waitForTimeout(100);
  check('honorários iniciais pagos oferecem o lançamento no Financeiro ao salvar', await page.isChecked('#c-hini-fin'));
  await page.uncheck('#c-hini-fin');
  await page.click('#c-save');
  await page.waitForFunction(() => [...document.querySelectorAll('tr[data-id]')].some(tr => tr.textContent.includes('Executado Ltda')), null, { timeout: 5000 });
  const rowExe = (await page.textContent('tr[data-id]:has-text("Executado Ltda")')).replace(/\u00a0/g, ' ');
  check('tabela mostra a etiqueta EXECUTADO, a redução e os honorários iniciais a lançar', /EXECUTADO/.test(rowExe) && /sobre a redução de R\$ 80 mil/.test(rowExe) && /iniciais R\$ 5\.000,00/.test(rowExe) && /lançar/.test(rowExe));
  await page.click('tr[data-id]:has-text("Executado Ltda")'); await page.waitForSelector('#case-form');
  check('ao reabrir, os valores da defesa do executado voltam preenchidos', (await page.inputValue('#c-vdeb')) === '200.000,00' && (await page.inputValue('#c-vdev')) === '120.000,00' && await page.isChecked('#c-base-red') && (await page.inputValue('#c-hini')) === '5.000,00' && !!(await page.$('#c-hini-go')));
  await page.check('#c-fase-julg'); await page.waitForTimeout(100);
  check('julgado pede o valor reconhecido na decisão', await page.isVisible('#c-vrecon-field'));
  await page.fill('#c-vrecon', '130000'); await page.press('#c-vrecon', 'Tab'); await page.waitForTimeout(100);
  check('honorários recalculados sobre a redução obtida (70 mil → 17.500)', (await page.inputValue('#c-hon')) === '17.500,00');
  await page.click('#c-hini-go'); await page.waitForSelector('#fn-form', { timeout: 5000 });
  check('"Lançar agora" abre a receita de honorários iniciais vinculada ao processo', (await page.inputValue('#fn-cat')) === 'Honorários iniciais' && (await page.inputValue('#fn-valor')) === '5.000,00' && (await page.$eval('#fn-case', s => s.selectedOptions[0].textContent)).includes('Executado Ltda'));
  await page.click('#fn-save'); await page.waitForFunction(() => !document.querySelector('#fn-form'), null, { timeout: 5000 });
  await page.click('[data-tab="cases"]'); await page.waitForSelector('tr[data-id]');
  check('depois do lançamento a tabela não pede mais para lançar', !/lançar/.test(await page.textContent('tr[data-id]:has-text("Executado Ltda")')));
  // volta à parceria: base padrão "valor combinado"
  await page.click('[data-act="new-case"]'); await page.waitForSelector('#case-form');
  check('processo de parceria começa com honorários em valor combinado (campo direto)', await page.isChecked('#c-base-fixo') && !(await page.isVisible('#c-phon-field')));
  await page.click('#c-cancel');

  // honorários iniciais: só no Financeiro, vinculados ao processo e parcelados
  await page.click('[data-tab="finance"]'); await page.waitForSelector('tr[data-fin]');
  await page.click('[data-act="new-receita"]'); await page.waitForSelector('#fn-form');
  await page.fill('#fn-cat', 'Honorários iniciais'); await page.fill('#fn-valor', '4000');
  check('receita tem o campo opcional de processo relacionado', !!(await page.$('#fn-case')));
  await page.selectOption('#fn-case', { label: /Cliente Direto/ }).catch(async () => { const opt = await page.$('#fn-case option:has-text("Cliente Direto")'); await page.selectOption('#fn-case', await opt.getAttribute('value')); });
  await page.waitForTimeout(100);
  check('escolher o processo preenche a descrição', (await page.inputValue('#fn-desc')).includes('Cliente Direto'));
  await page.check('#fn-pp'); await page.waitForTimeout(100);
  check('parcelado mostra o plano de parcelas', await page.isVisible('#fn-parc'));
  await page.fill('#fn-np', '4'); await page.fill('#fn-d1', '2026-07-05'); await page.press('#fn-d1', 'Tab'); await page.waitForTimeout(100);
  check('plano calcula 4 parcelas de R$ 1.000,00', (await page.inputValue('#fn-vp')) === '1.000,00' && (await page.textContent('#fn-parc-hint')).includes('4 parcelas'));
  await page.click('#fn-save');
  await page.waitForFunction(() => !document.querySelector('#fn-form'), null, { timeout: 5000 });
  await page.selectOption('#ff-mes', ''); await page.waitForTimeout(200);
  check('parcelas aparecem vinculadas ao processo (etiqueta PROCESSO)', (await page.$$('tr[data-fin]:has-text("parcela 1/4")')).length === 1 && (await page.textContent('tr[data-fin]:has-text("parcela 1/4")')).includes('PROCESSO'));

  await page.waitForSelector('.provbox', { timeout: 5000 });
  const provTxt = (await page.textContent('.provbox')).replace(/\u00a0/g, ' ');
  // 3 parcelas (1 futura + 2 vencidas) + 6 créditos comprados não recebidos (1 atrasado) + 1 processo em andamento (R$ 8.000 previstos)
  check('caixa de provisionados soma parcelas, créditos e a previsão dos processos', /11 itens/.test(provTxt) && /28 mil em 2 processos/.test(provTxt) && /Em atraso/.test(provTxt));
  await page.click('[data-act="open-prov"]');
  await page.waitForSelector('.prov-list', { timeout: 5000 });
  check('lista separa os itens com baixa direta e os processos (estimativa, sem check)', (await page.$$('.prov-row')).length === 11 && (await page.$$('.prov-row.late')).length === 3 && (await page.$$('.prov-row:has-text("Honorários iniciais")')).length === 3 && (await page.$$('.prov-row:has-text("Créditos comprados")')).length === 6 && (await page.$$('.prov-row.proc')).length === 2 && !(await page.$('.prov-row.proc input')));
  await page.click('#pv-all'); await page.waitForTimeout(100);
  check('"marcar todos os vencidos" seleciona os 3 em atraso', (await page.$$('input[data-pv]:checked')).length === 3 && (await page.textContent('#pv-ok')).includes('(3)'));
  // desmarca o crédito e dá baixa só nas duas parcelas vencidas
  await page.uncheck('.prov-row.late:has-text("Créditos comprados") input[data-pv]'); await page.waitForTimeout(100);
  check('botão reflete a seleção (2 parcelas, R$ 2.000)', (await page.textContent('#pv-ok')).replace(/\u00a0/g, ' ').includes('2.000,00') && (await page.textContent('#pv-ok')).includes('(2)'));
  await page.screenshot({ path: path.join(shots, 'e2e-provisionados.png') });
  await page.click('#pv-ok');
  await page.waitForFunction(() => !document.querySelector('.prov-list') && document.querySelector('.provbox') && /9 itens/.test(document.querySelector('.provbox').textContent), null, { timeout: 8000 });
  check('após a baixa restam 1 parcela, os créditos e o processo; o atraso que sobra é só do crédito', (await page.textContent('.provbox')).includes('Em atraso'));
  await page.selectOption('#ff-sit', 'provisionado'); await page.waitForTimeout(200);
  check('filtro "só provisionados" lista só a parcela futura', (await page.$$('tr[data-fin]')).length === 1 && (await page.textContent('tr[data-fin]')).includes('4/4'));
  await page.selectOption('#ff-sit', 'realizado'); await page.waitForTimeout(200);
  check('parcelas baixadas viraram receitas realizadas', (await page.$$('tr[data-fin]:has-text("parcela 2/4")')).length === 1 && (await page.$$('tr[data-fin]:has-text("parcela 3/4")')).length === 1);
  await page.selectOption('#ff-sit', '').catch(() => {}); await page.waitForTimeout(200);

  // julgamento do processo do escritório a partir da caixa: valor da condenação → quanto recebemos
  await page.click('[data-act="open-prov"]'); await page.waitForSelector('.prov-row.proc');
  await page.click('.prov-row.proc:has-text("Cliente Direto") [data-pv-case]');
  await page.waitForSelector('#case-form', { timeout: 5000 });
  check('"Informar resultado" abre o processo', (await page.inputValue('#c-cliente')) === 'Cliente Direto');
  await page.check('#c-fase-julg'); await page.waitForTimeout(100);
  check('julgado mostra o valor total da condenação e os sucumbenciais', await page.isVisible('#c-vcond-field') && await page.isVisible('#c-vsuc') && /condenação/.test(await page.textContent('#c-hon-label')));
  await page.fill('#c-vcond', '50000'); await page.press('#c-vcond', 'Tab');
  check('honorários recalculados sobre a condenação (20% de 50 mil)', (await page.inputValue('#c-hon')) === '10.000,00');
  await page.fill('#c-vsuc', '5000'); await page.press('#c-vsuc', 'Tab'); await page.waitForTimeout(100);
  check('sucumbenciais saem da base: 20% da condenação líquida de 45 mil = 9.000', (await page.inputValue('#c-hon')) === '9.000,00' && /45\.000,00/.test((await page.textContent('#c-cond-hint')).replace(/\u00a0/g, ' ')) && /100% com o escritório/.test(await page.textContent('#c-cond-hint')));
  await page.check('#c-res-rec'); await page.waitForSelector('#c-lancar');
  check('quanto recebemos vem preenchido: 9.000 contratuais + 5.000 sucumbenciais', (await page.inputValue('#c-vrecc')) === '9.000,00' && (await page.inputValue('#c-vrecs')) === '5.000,00');
  await page.fill('#c-vrecc', '8500'); await page.press('#c-vrecc', 'Tab');
  check('prévia mostra só a receita (sem repasse) com o total efetivamente recebido (8.500 + 5.000)', /Receita.*13\.500,00/.test((await page.textContent('#fin-box')).replace(/\u00a0/g, ' ')) && !/Repasse/.test(await page.textContent('#fin-box')));
  await page.click('#c-save');
  await page.waitForFunction(() => !document.querySelector('#case-form') && [...document.querySelectorAll('tr[data-fin]')].some(tr => tr.textContent.includes('Cliente Direto') && tr.textContent.includes('Alvará')), null, { timeout: 8000 });
  check('recebimento do processo do escritório entra no Financeiro como alvará de R$ 13.500', (await page.textContent('tr[data-fin]:has-text("Alvará"):has-text("Cliente Direto")')).replace(/\u00a0/g, ' ').includes('13.500,00'));
  check('processo recebido sai da caixa de provisionados (fica só o da defesa do executado)', /8 itens/.test(await page.textContent('.provbox')) && /20 mil em 1 processo/.test((await page.textContent('.provbox')).replace(/\u00a0/g, ' ')));

  // contratos com empresas
  await page.click('[data-tab="contracts"]');
  await page.click('[data-act="new-contract"]');
  await page.waitForSelector('#ct-form');
  await page.fill('#ct-emp', 'Empresa Alfa'); await page.fill('#ct-cnpj', '12.345.678/0001-90'); await page.fill('#ct-serv', 'Consultoria trabalhista'); await page.fill('#ct-val', '2500'); await page.fill('#ct-dia', '10'); await page.fill('#ct-ini', '2026-06-01');
  await page.click('#ct-save');
  await page.waitForSelector('td[data-ct][data-ym="2026-09"]', { timeout: 5000 });
  check('contrato aparece na grade mensal com meses em aberto', (await page.$$('td.cell.due')).length >= 3 && (await page.textContent('#view')).includes('Empresa Alfa'));
  await page.click('td[data-ct][data-ym="2026-09"]');
  await page.waitForSelector('#rc-form', { timeout: 5000 });
  check('clicar no mês abre o recebimento com o valor mensal', (await page.inputValue('#rc-val')) === '2.500,00');
  await page.click('#rc-save');
  await page.waitForFunction(() => document.querySelector('td[data-ct][data-ym="2026-09"]')?.classList.contains('ok'), null, { timeout: 5000 });
  check('mês registrado fica marcado como recebido', true);
  await page.screenshot({ path: path.join(shots, 'e2e-contratos.png'), fullPage: true });
  await page.click('[data-tab="finance"]'); await page.waitForSelector('tr[data-fin]');
  check('mensalidade entra no financeiro como receita de contrato', (await page.textContent('#view')).includes('CONTRATO') && (await page.textContent('#view')).includes('Contratos com empresas'));

  // crédito com compra lançada no financeiro
  await page.click('[data-tab="credits"]'); await page.click('[data-act="new-credit"]');
  await page.fill('#cr-num', '08088888820268170001'); await page.fill('#cr-ced', 'Cedente G'); await page.fill('#cr-vc', '7000'); await page.fill('#cr-vr', '11000');
  check('opção de lançar a compra como despesa existe', !!(await page.$('#cr-lc')));
  await page.check('#cr-lc'); await page.click('#cr-save');
  try { await page.waitForFunction(() => [...document.querySelectorAll('tr[data-credit]')].some(tr => tr.textContent.includes('Cedente G')), null, { timeout: 5000 }); }
  catch (e) { console.log('DIAG err=', await page.textContent('#cr-err').catch(() => 'no-form'), 'sheet=', !!(await page.$('#cr-form')), 'vals=', await page.$$eval('#cr-form input', els => els.map(i => i.id + '=' + i.value)).catch(() => null), 'api=', (await page.evaluate(async () => (await (await fetch('/api/credits', { headers: { 'X-Requested-With': 'fetch' } })).json()).credits.map(c => c.cedente)))); throw e; }
  await page.click('[data-tab="finance"]'); await page.waitForSelector('tr[data-fin]');
  check('compra do crédito aparece como despesa no financeiro', (await page.textContent('#view')).includes('Compra de créditos'));

  // visão geral segmentada por braço
  await page.click('[data-tab="overview"]');
  await page.waitForSelector('.seg', { timeout: 5000 });
  check('visão geral tem o seletor de braços', (await page.$$('.seg [data-act="seg"]')).length === 4);
  await page.click('.seg [data-act="seg"][data-id="all"]'); await page.waitForSelector('#chart-arms svg', { timeout: 5000 });
  check('"todos os braços" mostra os cartões por braço e o gráfico empilhado', (await page.$$('.tile.arm[data-act="seg"]')).length === 3 && (await page.$$('#chart-arms rect.seg')).length >= 3);
  await page.screenshot({ path: path.join(shots, 'e2e-visao-geral-bracos.png'), fullPage: true });
  await page.click('.seg [data-act="seg"][data-id="contratos"]'); await page.waitForTimeout(300);
  check('segmento de contratos mostra a grade das empresas', (await page.textContent('#view')).includes('Empresa Alfa'));
  await page.click('.seg [data-act="seg"][data-id="creditos"]'); await page.waitForSelector('#chart-timeline svg', { timeout: 5000 });
  check('segmento de créditos mostra a linha do tempo', true);
  await page.click('.seg [data-act="seg"][data-id="parcerias"]'); await page.waitForSelector('.hero', { timeout: 5000 });
  await page.screenshot({ path: path.join(shots, 'e2e-visao-geral.png'), fullPage: true });

  // sessão persiste ao recarregar
  await page.reload(); await page.waitForSelector('#tabs', { timeout: 5000 });
  check('sessão persiste após recarregar', await page.isVisible('#tabs'));
  await page.click('#btn-logout'); await page.waitForSelector('#login-form', { timeout: 5000 });
  check('sair volta ao login', true);

  // parceiro entra e não vê as abas da administração
  await page.fill('#lg-user', 'mariana.lopes'); await page.fill('#lg-pass', senhaParceira); await page.click('#lg-btn');
  await page.waitForSelector('#tabs', { timeout: 5000 });
  const tabs = await page.$$eval('#tabs [data-tab]', els => els.map(e => e.dataset.tab));
  check('parceiro só vê visão geral e meus processos', tabs.join(',') === 'overview,cases');
  check('parceiro vê o próprio processo', (await page.textContent('#view')).includes('João Pereira'));
  await page.click('[data-tab="cases"]'); await page.click('[data-act="new-case"]');
  await page.fill('#c-num', '08055555520268170001'); await page.fill('#c-cliente', 'Carlos Lima'); await page.fill('#c-tipo', 'Repetição de indébito'); await page.fill('#c-hon', '10000');
  await page.check('#c-res-rec'); await page.waitForTimeout(150);
  check('parceiro não vê a opção de lançar, e sim o aviso ao escritório', !(await page.$('#c-lancar')) && (await page.textContent('#fin-box')).includes('escritório'));
  await page.click('#c-save');
  await page.waitForFunction(() => document.querySelectorAll('tr[data-id]').length === 3, null, { timeout: 5000 });
  await page.click('#btn-logout'); await page.waitForSelector('#login-form');
  await page.fill('#lg-user', 'admin'); await page.fill('#lg-pass', 'senha-forte-123'); await page.click('#lg-btn'); await page.waitForSelector('#tabs');
  await page.click('[data-tab="overview"]'); await page.waitForSelector('.hero');
  check('administrador vê o aviso de recebimento aguardando lançamento', (await page.textContent('#view')).includes('aguardam lançamento'));
  await page.click('[data-act="go-fin-pending"]'); await page.waitForTimeout(300);
  check('atalho filtra os recebidos sem lançar', (await page.$$('tr[data-id]')).length === 1 && (await page.textContent('tr[data-id]')).includes('Carlos Lima'));
  await page.click('tr[data-id]'); await page.waitForSelector('#c-lancar'); await page.click('#c-save');
  await page.waitForFunction(() => { const v = document.querySelector('#view')?.textContent || ''; return !v.includes('aguardam lançamento') && v.includes('no financeiro'); }, null, { timeout: 5000 });
  check('após lançar, a pendência some', true);
  await page.screenshot({ path: path.join(shots, 'e2e-parceiro.png'), fullPage: true });

  // ---- controle de ponto: estagiário, configuração, batida com GPS + IP, visão do admin ----
  const OFFICE = { latitude: -2.4950, longitude: -44.3020 };
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light', locale: 'pt-BR', geolocation: OFFICE, permissions: ['geolocation'] });
  const pg = await ctx2.newPage();
  pg.on('pageerror', e => errors.push(e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_TUNNEL|net::/.test(m.text())) errors.push(m.text()); });
  await pg.goto(BASE); await pg.waitForSelector('#login-form');
  await pg.fill('#lg-user', 'admin'); await pg.fill('#lg-pass', 'senha-forte-123'); await pg.click('#lg-btn'); await pg.waitForSelector('#tabs');
  check('administração tem a aba Ponto', !!(await pg.$('[data-tab="ponto"]')));
  // estagiário
  await pg.click('[data-tab="partners"]'); await pg.click('[data-act="new-estagiario"]'); await pg.waitForSelector('#p-form');
  check('formulário de estagiário: sem OAB/divisão, com bolsa e jornada da manhã', await pg.isChecked('#p-t-est') && !(await pg.isVisible('#p-oab-field')) && await pg.isVisible('#p-bolsa') && (await pg.inputValue('#p-jk')) === 'manha' && /2 registros/.test(await pg.textContent('#p-jhint')));
  await pg.fill('#p-nome', 'Pedro Lima'); await pg.press('#p-nome', 'Tab');
  await pg.fill('#p-curso', 'Direito'); await pg.fill('#p-bolsa', '900');
  const senhaEst = await pg.inputValue('#p-pass');
  await pg.click('#p-save'); await pg.waitForSelector('#cred-ok', { timeout: 5000 }); await pg.click('#cred-ok');
  await pg.waitForFunction(() => [...document.querySelectorAll('.pcard')].some(c => c.textContent.includes('Pedro Lima')), null, { timeout: 5000 });
  check('cartão do estagiário mostra bolsa e jornada', /Estagiário/.test(await pg.textContent('.pcard:has-text("Pedro Lima")')) && /08:00–12:00/.test(await pg.textContent('.pcard:has-text("Pedro Lima")')));
  await pg.click('[data-act="fp"][data-id="estagiario"]'); await pg.waitForTimeout(150);
  check('filtro de estagiários funciona', (await pg.$$('.pcard')).length === 1);
  // configuração do ponto
  await pg.click('[data-tab="ponto"]'); await pg.waitForSelector('[data-act="ponto-config"]');
  check('aba Ponto avisa que a validação não está configurada', /não está configurada/.test(await pg.textContent('#view')));
  await pg.click('.page-h [data-act="ponto-config"]'); await pg.waitForSelector('#pc-form');
  await pg.click('#pc-here'); await pg.waitForFunction(() => /Preenchido/.test(document.querySelector('#pc-here-st')?.textContent || ''), null, { timeout: 8000 });
  check('"usar minha localização" preenche latitude e longitude', Math.abs(Number(await pg.inputValue('#pc-lat')) - OFFICE.latitude) < 0.0001);
  await pg.click('#pc-myip'); await pg.waitForFunction(() => /adicionado/.test(document.querySelector('#pc-myip-st')?.textContent || ''), null, { timeout: 8000 });
  check('"adicionar meu IP" preenche a rede do escritório', (await pg.inputValue('#pc-ips')).trim().length > 0);
  await pg.fill('#pc-end', 'Rua do escritório, 100'); await pg.fill('#pc-tol', '20');
  await pg.click('#pc-ok'); await pg.waitForFunction(() => !document.querySelector('#pc-form'), null, { timeout: 5000 });
  check('configuração salva e aviso some', !/não está configurada/.test(await pg.textContent('#view')));
  await pg.click('#btn-logout'); await pg.waitForSelector('#login-form');
  // estagiário bate ponto
  await pg.fill('#lg-user', 'pedro.lima'); await pg.fill('#lg-pass', senhaEst); await pg.click('#lg-btn'); await pg.waitForSelector('#tabs', { timeout: 5000 });
  const tabsEst = await pg.$$eval('#tabs [data-tab]', els => els.map(e => e.dataset.tab));
  check('estagiário só vê "Meu ponto"', tabsEst.join(',') === 'ponto' && /Estagiário/.test(await pg.textContent('.who')));
  await pg.waitForSelector('.punch-btn', { timeout: 5000 });
  await pg.waitForFunction(() => /rede do escritório|do escritório ✓/.test(document.querySelector('#geo-status')?.textContent || ''), null, { timeout: 8000 });
  check('tela mostra a prova de presença (rede e/ou GPS dentro do raio)', /✓/.test(await pg.textContent('#geo-status')));
  check('botão pede a entrada (1ª batida da jornada)', /entrada/i.test(await pg.textContent('.punch-btn')));
  await pg.click('.punch-btn');
  await pg.waitForFunction(() => document.querySelector('.step.done') && /Entrada/.test(document.querySelector('.step.done').textContent), null, { timeout: 8000 });
  const stepDone = await pg.textContent('.step.done');
  check('entrada registrada com prova (rede/GPS) e horário', /\d{2}:\d{2}/.test(stepDone) && /(rede do escritório|GPS)/.test(stepDone));
  check('próxima batida passa a ser a saída', /saída/i.test(await pg.textContent('.punch-btn')));
  check('espelho do mês mostra o dia de hoje em expediente', /Em expediente/.test(await pg.textContent('.espelho')));
  await pg.screenshot({ path: path.join(shots, 'e2e-meu-ponto.png'), fullPage: true });
  // pedido de ajuste
  await pg.click('[data-act="ask-adjust"]'); await pg.waitForSelector('#aj-form');
  await pg.fill('#aj-just', 'ontem esqueci de bater a saída');
  const ontem = new Date(Date.now() - 86400000); await pg.fill('#aj-data', ontem.toISOString().slice(0, 10)); await pg.selectOption('#aj-tipo', 'saida');
  await pg.click('#aj-ok'); await pg.waitForFunction(() => !document.querySelector('#aj-form'), null, { timeout: 5000 });
  check('pedido de ajuste enviado', true);
  await pg.click('#btn-logout'); await pg.waitForSelector('#login-form');
  // admin vê o ponto
  await pg.fill('#lg-user', 'admin'); await pg.fill('#lg-pass', 'senha-forte-123'); await pg.click('#lg-btn'); await pg.waitForSelector('#tabs');
  await pg.click('[data-tab="overview"]'); await pg.waitForSelector('.hero');
  check('visão geral avisa o pedido de ajuste pendente', /pedido de ajuste/.test(await pg.textContent('#view')));
  await pg.click('[data-act="go-ponto"]'); await pg.waitForSelector('.espelho');
  const hoje = await pg.textContent('#view');
  check('aba Ponto: Pedro no escritório agora, com entrada e prova', /No escritório agora/.test(hoje) && (await pg.$$eval('.tiles .tile', els => els[0].textContent)).includes('1') && /Pedro Lima/.test(hoje));
  check('pendência do ajuste listada com botões', (await pg.$$('.pend-row')).length === 1 && /ontem esqueci/.test(await pg.textContent('.pend-row')));
  await pg.click('.pend-row [data-dec="aprovado"]');
  await pg.waitForFunction(() => !document.querySelector('.pend-row'), null, { timeout: 5000 });
  check('ajuste aprovado some das pendências', true);
  await pg.click('tr[data-pessoa]:has-text("Pedro Lima")'); await pg.waitForSelector('#esp-ok');
  check('espelho da pessoa abre com o ajuste aprovado', /ajuste aprovado/.test(await pg.textContent('#sheet-b')));
  await pg.screenshot({ path: path.join(shots, 'e2e-ponto-admin.png') });
  await pg.click('#esp-ok');
  // batida manual
  await pg.click('.page-h [data-act="ponto-manual"]'); await pg.waitForSelector('#mp-form');
  await pg.selectOption('#mp-pessoa', await pg.$eval('#mp-pessoa option:has-text("Pedro Lima")', o => o.value));
  await pg.fill('#mp-data', ontem.toISOString().slice(0, 10)); await pg.selectOption('#mp-tipo', 'entrada'); await pg.fill('#mp-hora', '08:03'); await pg.fill('#mp-obs', 'confirmado pela recepção');
  await pg.click('#mp-ok'); await pg.waitForFunction(() => !document.querySelector('#mp-form'), null, { timeout: 5000 });
  await pg.click('tr[data-pessoa]:has-text("Pedro Lima")'); await pg.waitForSelector('#esp-ok');
  check('batida manual aparece no espelho como lançada pelo escritório', /lançada pelo escritório/.test(await pg.textContent('#sheet-b')));
  await pg.click('#esp-ok');
  // bolsa no financeiro
  await pg.click('[data-tab="finance"]'); await pg.waitForSelector('#ff-mes');
  const mesAtual = String(new Date().getMonth() + 1).padStart(2, '0');
  await pg.selectOption('#ff-mes', mesAtual); await pg.waitForTimeout(200);
  check('financeiro oferece lançar salários e bolsas do mês', /lançar salários e bolsas/.test(await pg.textContent('#fin-entries')));
  await pg.click('[data-act="post-salaries"]');
  await pg.waitForFunction(() => [...document.querySelectorAll('tr[data-fin]')].some(tr => tr.textContent.includes('Bolsa de estágio')), null, { timeout: 8000 });
  check('bolsa do estagiário lançada como despesa "Estagiários (bolsa)"', /Estagiários \(bolsa\)/.test(await pg.textContent('tr[data-fin]:has-text("Bolsa de estágio")')));
  await ctx2.close();
  await ctx.close();
} catch (e) { console.error('Erro no teste:', e); failures++; }
finally { await browser.close(); server.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
if (errors.length) { console.log('Erros de página:', errors); failures++; }
console.log(failures ? `\n${failures} falha(s).` : '\nFluxo completo no navegador OK.');
process.exit(failures ? 1 : 0);
