/*
 * Teste de fumaça da API: sobe o servidor com um banco temporário e percorre o fluxo
 * completo (configuração → login → parceiro → processo → escopo do parceiro → exclusão).
 *   npm test
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parcerias-'));
const PORT = 3999;
const env = { ...process.env, PORT: String(PORT), DB_PATH: path.join(tmp, 'test.db'), JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres-ok', COOKIE_SECURE: 'false', TRUST_PROXY: '0' };
const server = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => server.stdout.on('data', d => { if (String(d).includes('rodando')) r(); }));

const jars = {};
async function call(who, method, p, body) {
  const res = await fetch(`http://localhost:${PORT}/api${p}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', ...(jars[who] ? { Cookie: jars[who] } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const sc = res.headers.get('set-cookie'); if (sc) jars[who] = sc.split(';')[0];
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
let failures = 0;
const check = (name, cond, extra) => { console.log((cond ? '  ok  ' : '  FALHOU ') + name + (cond ? '' : '  ' + JSON.stringify(extra))); if (!cond) failures++; };

try {
  let r = await call('a', 'GET', '/session');
  check('sistema começa sem configuração', r.data.configured === false && r.data.session === null, r);
  r = await call('a', 'POST', '/setup', { usuario: 'admin', senha: 'senha-forte-123' });
  check('setup cria o administrador e abre sessão', r.status === 200 && r.data.session.role === 'admin', r);
  r = await call('x', 'POST', '/setup', { usuario: 'outro', senha: 'senha-forte-123' });
  check('segundo setup é recusado', r.status === 409, r);
  r = await call('x', 'POST', '/login', { usuario: 'admin', senha: 'errada' });
  check('senha errada recusada', r.status === 401, r);
  r = await call('x', 'POST', '/cases', {});
  check('sem sessão não grava', r.status === 401, r);

  r = await call('a', 'POST', '/partners', { nome: 'Mariana Lopes', escritorio: 'Lopes Advogados', usuario: 'mariana.lopes', pctParceiroPadrao: 40, pctNossoPadrao: 60, senha: 'parceira1' });
  check('admin cria parceiro', r.status === 201 && r.data.id, r);
  const pid = r.data.id;
  r = await call('a', 'POST', '/partners', { nome: 'Outro', usuario: 'mariana.lopes', senha: 'parceira1' });
  check('login duplicado é recusado', r.status === 400, r);

  r = await call('p', 'POST', '/login', { usuario: 'mariana.lopes', senha: 'parceira1', lembrar: true });
  check('parceiro entra', r.status === 200 && r.data.session.role === 'partner' && r.data.session.partnerId === pid, r);
  r = await call('p', 'GET', '/partners');
  check('parceiro não lista parceiros', r.status === 403, r);

  const caso = { parceiroId: 'qualquer', numeroProcesso: '08012345620268170001', cliente: 'João Pereira', tipoAcao: 'Ação contra casa de apostas', dataProtocolo: '2026-09-10', honorariosPretendidos: 25000, custoLead: 350, pctParceiro: 40, pctNosso: 60, recebido: false, temCorretor: true, nomeCorretor: 'Indicador', valorCorretor: 500, corretorPago: false };
  r = await call('p', 'POST', '/cases', caso);
  check('parceiro cadastra processo (forçado ao próprio id, CNJ formatado)', r.status === 201 && r.data.case.parceiroId === pid && r.data.case.numeroProcesso === '0801234-56.2026.8.17.0001', r);
  const cid = r.data.id;
  r = await call('p', 'POST', '/cases', { ...caso, pctParceiro: 50 });
  check('percentuais que não somam 100 são recusados', r.status === 400, r);
  r = await call('p', 'GET', '/bootstrap');
  check('processo sem natureza informada é judicial', r.data.cases[0].natureza === 'judicial', r.data.cases[0]);
  r = await call('p', 'POST', '/cases', { ...caso, natureza: 'administrativo', numeroProcesso: '12345.678901/2026-00', cliente: 'Maria Adm' });
  check('processo administrativo aceita número livre (sem máscara CNJ)', r.status === 201 && r.data.case.natureza === 'administrativo' && r.data.case.numeroProcesso === '12345.678901/2026-00', r);
  await call('p', 'DELETE', `/cases/${r.data.id}`);
  r = await call('p', 'POST', '/cases', { ...caso, natureza: 'penal' });
  check('natureza inválida é recusada', r.status === 400, r);

  r = await call('a', 'POST', '/partners', { nome: 'Rafael Menezes', usuario: 'rafael', senha: 'parceiro2' });
  const pid2 = r.data.id;
  r = await call('a', 'POST', '/cases', { ...caso, parceiroId: pid2, numeroProcesso: '0800001-11.2026.8.17.0001', cliente: 'Ana Souza', recebido: true, valorRecebido: 20000, dataRecebimento: '2026-09-20' });
  check('admin cadastra processo para outro parceiro', r.status === 201, r);
  const cid2 = r.data.id;

  r = await call('p', 'GET', '/bootstrap');
  check('parceiro vê só os próprios processos', r.data.cases.length === 1 && r.data.partners.length === 1, r.data);
  r = await call('p', 'PUT', `/cases/${cid2}`, caso);
  check('parceiro não altera processo alheio', r.status === 404, r);
  r = await call('a', 'GET', '/bootstrap');
  check('admin vê tudo', r.data.cases.length === 2 && r.data.partners.length === 2, r.data);

  // fluxo recebimento → financeiro
  r = await call('p', 'PUT', `/cases/${cid}`, { ...caso, resultado: 'recebido', valorRecebido: 25000, dataRecebimento: '2026-09-25', fluxoRecebimento: 'escritorio', lancarFinanceiro: true });
  check('parceiro marca recebido: fica pendente de lançamento (não lança)', r.status === 200 && r.data.case.resultado === 'recebido' && r.data.case.financeiroStatus === 'pendente', r);
  r = await call('a', 'GET', '/finance');
  check('nenhum lançamento criado pelo parceiro', r.data.finance.length === 0, r.data);
  r = await call('a', 'PUT', `/cases/${cid}`, { ...caso, parceiroId: pid, fase: 'julgado', resultado: 'recebido', valorRecebido: 25000, dataRecebimento: '2026-09-25', fluxoRecebimento: 'escritorio', lancarFinanceiro: true });
  check('admin confirma e lança no financeiro', r.status === 200 && r.data.case.financeiroStatus === 'lancado' && r.data.case.recebido === true && r.data.case.valorRecebido === 25000, r);
  r = await call('a', 'GET', '/finance');
  const rec = r.data.finance.find(e => e.tipo === 'receita'), desp = r.data.finance.find(e => e.tipo === 'despesa');
  check('gera receita do total (alvará) e despesa do repasse (40%) vinculadas ao processo', rec && desp && rec.valor === 25000 && rec.categoria === 'Alvará de honorários finais' && desp.valor === 10000 && desp.categoria === 'Repasse a parceiro' && rec.caseId === cid && desp.caseId === cid && rec.data === '2026-09-25', r.data);
  r = await call('a', 'PUT', `/cases/${cid}`, { ...caso, parceiroId: pid, resultado: 'recebido', valorRecebido: 30000, dataRecebimento: '2026-09-25', lancarFinanceiro: true });
  r = await call('a', 'GET', '/finance');
  check('salvar de novo não duplica lançamentos', r.data.finance.length === 2, r.data);
  r = await call('a', 'PUT', `/cases/${cid}`, { ...caso, parceiroId: pid, resultado: 'em_andamento' });
  check('voltar para em andamento limpa o vínculo', r.status === 200 && r.data.case.financeiroStatus === 'nao' && r.data.case.recebido === false, r);
  r = await call('a', 'GET', '/finance');
  check('lançamentos vinculados foram removidos', r.data.finance.length === 0, r.data);
  r = await call('a', 'PUT', `/cases/${cid}`, { ...caso, parceiroId: pid, resultado: 'recebido', valorRecebido: 20000, dataRecebimento: '2026-09-26', fluxoRecebimento: 'parceiro', lancarFinanceiro: true });
  r = await call('a', 'GET', '/finance');
  check('parceiro recebeu e repassou: só a receita da nossa parte (60%)', r.data.finance.length === 1 && r.data.finance[0].tipo === 'receita' && r.data.finance[0].valor === 12000, r.data);
  r = await call('a', 'PUT', `/cases/${cid}`, { ...caso, parceiroId: pid, resultado: 'perdido', dataEncerramento: '2026-09-27' });
  check('perdido: sem recebimento, com data de encerramento, lançamentos removidos', r.status === 200 && r.data.case.resultado === 'perdido' && r.data.case.dataEncerramento === '2026-09-27' && r.data.case.recebido === false, r);
  r = await call('a', 'GET', '/finance'); check('financeiro zerado após perdido', r.data.finance.length === 0, r.data);
  r = await call('a', 'PUT', `/cases/${cid}`, { ...caso, parceiroId: pid, resultado: 'ganho' });
  check('situação inválida é recusada', r.status === 400, r);
  r = await call('a', 'PUT', `/cases/${cid}`, { ...caso, parceiroId: pid, recebido: true, valorRecebido: 25000, dataRecebimento: '2026-09-25' });
  check('admin marca recebido (compatibilidade com o campo antigo)', r.status === 200 && r.data.case.recebido === true && r.data.case.valorRecebido === 25000 && r.data.case.financeiroStatus === 'pendente', r);
  r = await call('a', 'POST', `/partners/${pid}/ativo`, { ativo: false });
  check('admin desativa parceiro', r.status === 200 && r.data.partner.ativo === false, r);
  r = await call('p', 'GET', '/bootstrap');
  check('parceiro desativado perde acesso', r.status === 401, r);
  r = await call('a', 'POST', `/partners/${pid}/ativo`, { ativo: true });
  r = await call('a', 'POST', `/partners/${pid}/password`, { senha: 'novaSenha9' });
  r = await call('p2', 'POST', '/login', { usuario: 'mariana.lopes', senha: 'novaSenha9' });
  check('nova senha do parceiro funciona', r.status === 200, r);
  r = await call('a', 'POST', '/password', { senhaAtual: 'senha-forte-123', novaSenha: 'outra-senha-456' });
  check('admin troca a própria senha', r.status === 200, r);
  r = await call('a', 'DELETE', `/cases/${cid2}`);
  check('admin exclui processo', r.status === 200, r);

  // compra de créditos — exclusivo da administração
  const credito = { numeroProcesso: '08099999920268170001', cedente: 'Fulano Cedente', dataCompra: '2026-08-01', dataPrevista: '2027-03-15', valorCompra: 10000, valorReceber: 16000, recebido: false };
  r = await call('p2', 'POST', '/credits', credito);
  check('parceiro não registra crédito', r.status === 403, r);
  r = await call('p2', 'GET', '/credits');
  check('parceiro não lista créditos', r.status === 403, r);
  r = await call('a', 'POST', '/credits', credito);
  check('admin registra crédito com possível data de recebimento', r.status === 201 && r.data.credit.valorReceber === 16000 && r.data.credit.dataPrevista === '2027-03-15', r);
  const crid = r.data.id;
  r = await call('a', 'POST', '/credits', { ...credito, dataPrevista: '15/03/2027' });
  check('data prevista em formato inválido é recusada', r.status === 400, r);
  r = await call('a', 'POST', '/credits', { ...credito, dataPrevista: '' });
  check('data prevista é opcional', r.status === 201 && r.data.credit.dataPrevista === null, r);
  await call('a', 'DELETE', `/credits/${r.data.id}`);
  r = await call('a', 'PUT', `/credits/${crid}`, { ...credito, recebido: true, valorRecebido: 15500, dataRecebimento: '2026-09-15' });
  check('admin marca crédito como recebido', r.status === 200 && r.data.credit.recebido && r.data.credit.valorRecebido === 15500, r);
  r = await call('a', 'GET', '/bootstrap');
  check('bootstrap do admin traz créditos', Array.isArray(r.data.credits) && r.data.credits.length === 1, r.data);
  r = await call('p2', 'GET', '/bootstrap');
  check('bootstrap do parceiro não traz créditos', r.data.credits === undefined, r.data);
  r = await call('a', 'DELETE', `/credits/${crid}`);
  check('admin exclui crédito', r.status === 200, r);

  // financeiro — exclusivo da administração
  r = await call('p2', 'POST', '/finance', { tipo: 'despesa', categoria: 'Aluguel', valor: 3000, data: '2026-09-05' });
  check('parceiro não lança no financeiro', r.status === 403, r);
  r = await call('a', 'POST', '/finance', { tipo: 'despesa', categoria: 'Aluguel', valor: 3000, data: '2026-09-05' });
  check('admin lança despesa', r.status === 201 && r.data.entry.tipo === 'despesa' && r.data.entry.valor === 3000, r);
  const fid = r.data.id;
  r = await call('a', 'POST', '/finance', { tipo: 'receita', categoria: 'Honorários iniciais', descricao: 'Cliente X', valor: 8500.5, data: '2026-09-12' });
  check('admin lança receita', r.status === 201 && r.data.entry.valor === 8500.5, r);
  r = await call('a', 'POST', '/finance', { tipo: 'outro', categoria: 'Aluguel', valor: 10, data: '2026-09-05' });
  check('tipo inválido é recusado', r.status === 400, r);
  r = await call('a', 'POST', '/finance', { tipo: 'despesa', categoria: 'Energia', valor: 0, data: '2026-09-05' });
  check('valor zero é recusado', r.status === 400, r);
  r = await call('a', 'GET', '/finance?ano=2026');
  check('lista do ano traz os lançamentos', r.status === 200 && r.data.finance.length === 2, r.data);
  r = await call('a', 'PUT', `/finance/${fid}`, { tipo: 'despesa', categoria: 'Aluguel', valor: 3200, data: '2026-09-05' });
  check('admin edita lançamento', r.status === 200 && r.data.entry.valor === 3200, r);
  r = await call('a', 'GET', '/bootstrap');
  check('bootstrap do admin traz o financeiro', Array.isArray(r.data.finance) && r.data.finance.length === 2, r.data);
  r = await call('p2', 'GET', '/bootstrap');
  check('bootstrap do parceiro não traz o financeiro', r.data.finance === undefined, r.data);
  r = await call('a', 'DELETE', `/finance/${fid}`);
  check('admin exclui lançamento', r.status === 200, r);
  // limpa o financeiro para os blocos seguintes
  r = await call('a', 'GET', '/finance'); for (const e of r.data.finance) await call('a', 'DELETE', `/finance/${e.id}`);
  const finance = async () => (await call('a', 'GET', '/finance')).data.finance;

  // advogado associado — bonificação % sobre o ganho + salário fixo
  r = await call('a', 'POST', '/partners', { tipo: 'associado', nome: 'Carla Nunes', usuario: 'carla', senha: 'associada1', pctBonificacaoPadrao: 20, salarioFixo: 4500 });
  check('associado sem área de atuação é recusado', r.status === 400, r);
  r = await call('a', 'POST', '/partners', { tipo: 'associado', nome: 'Carla Nunes', usuario: 'carla', senha: 'associada1', areaAtuacao: 'ADVOGADA ASSOCIADA TRABALHISTA', especializacao: 'Direito do Trabalho', termos: 'Salário fixo + 20% sobre o êxito', pctBonificacaoPadrao: 20, salarioFixo: 4500 });
  check('admin cadastra advogado associado (percentuais derivados da bonificação)', r.status === 201 && r.data.partner.tipo === 'associado' && r.data.partner.pctParceiroPadrao === 20 && r.data.partner.pctNossoPadrao === 80 && r.data.partner.salarioFixo === 4500 && r.data.partner.areaAtuacao === 'ADVOGADA ASSOCIADA TRABALHISTA', r);
  const aid = r.data.id;
  r = await call('a', 'POST', '/cases', { ...caso, parceiroId: aid, numeroProcesso: '0800002-22.2026.8.17.0001', cliente: 'Empresa Ré', pctParceiro: 25, pctNosso: 75, fase: 'em_curso', resultado: 'recebido', valorRecebido: 10000, dataRecebimento: '2026-09-28', lancarFinanceiro: true });
  check('processo do associado com divisão própria (25%) recebido e lançado', r.status === 201 && r.data.case.financeiroStatus === 'lancado' && r.data.case.pctParceiro === 25, r);
  const cidA = r.data.id;
  let fin = await finance();
  const bon = fin.find(e => e.categoria === 'Bonificação de associado'), honA = fin.find(e => e.caseId === cidA && e.tipo === 'receita');
  check('gera receita total + despesa "Bonificação de associado" (25%) vinculada ao associado', fin.length === 2 && honA && honA.valor === 10000 && honA.categoria === 'Honorários de êxito' && bon && bon.valor === 2500 && bon.associadoId === aid, fin);
  r = await call('a', 'POST', '/finance', { tipo: 'despesa', categoria: 'Advogados associados (salário)', descricao: 'Salário — Carla Nunes', valor: 4500, data: '2026-09-30', competencia: '2026-09', associadoId: aid });
  check('salário do associado entra como despesa por competência', r.status === 201 && r.data.entry.competencia === '2026-09' && r.data.entry.associadoId === aid, r);
  r = await call('a', 'POST', '/finance', { tipo: 'despesa', categoria: 'Energia', valor: 10, data: '2026-09-30', competencia: '09/2026' });
  check('competência fora do padrão AAAA-MM é recusada', r.status === 400, r);

  // processo somente do escritório (sem parceiro nem associado)
  r = await call('a', 'POST', '/cases', { titularidade: 'escritorio', numeroProcesso: '0800003-33.2026.8.17.0001', cliente: 'Cliente Direto', tipoAcao: 'Ação indenizatória', dataProtocolo: '2026-09-15', valorAcao: 40000, pctHonorarios: 20, pctParceiro: 40, pctNosso: 60 });
  check('processo só do escritório: sem parceiro, 100% nosso, honorários previstos = 20% do valor pretendido da ação', r.status === 201 && r.data.case.parceiroId === null && r.data.case.titularidade === 'escritorio' && r.data.case.pctNosso === 100 && r.data.case.pctParceiro === 0 && r.data.case.valorAcao === 40000 && r.data.case.pctHonorarios === 20 && r.data.case.honorariosPretendidos === 8000 && r.data.case.valorCondenacao === null, r);
  const cidE = r.data.id;
  r = await call('a', 'POST', '/cases', { titularidade: 'escritorio', numeroProcesso: '0800006-66.2026.8.17.0001', cliente: 'Cliente Direto 2', tipoAcao: 'Ação', dataProtocolo: '2026-09-15', valorAcao: 40000, pctHonorarios: 20, honorariosPretendidos: 9000 });
  check('honorários informados à mão prevalecem sobre o cálculo', r.status === 201 && r.data.case.honorariosPretendidos === 9000, r);
  await call('a', 'DELETE', `/cases/${r.data.id}`);
  r = await call('a', 'PUT', `/cases/${cidE}`, { titularidade: 'escritorio', numeroProcesso: '0800003-33.2026.8.17.0001', cliente: 'Cliente Direto', tipoAcao: 'Ação indenizatória', dataProtocolo: '2026-09-15', valorAcao: 40000, pctHonorarios: 20, fase: 'julgado', valorCondenacao: 50000 });
  check('julgado: valor da condenação guardado e honorários recalculados sobre ele (20% de 50 mil)', r.status === 200 && r.data.case.fase === 'julgado' && r.data.case.valorCondenacao === 50000 && r.data.case.honorariosPretendidos === 10000, r);
  r = await call('a', 'PUT', `/cases/${cidE}`, { titularidade: 'escritorio', numeroProcesso: '0800003-33.2026.8.17.0001', cliente: 'Cliente Direto', tipoAcao: 'Ação indenizatória', dataProtocolo: '2026-09-15', valorAcao: 40000, pctHonorarios: 20, fase: 'em_curso', valorCondenacao: 50000 });
  check('voltar para em curso descarta o valor da condenação', r.status === 200 && r.data.case.valorCondenacao === null && r.data.case.honorariosPretendidos === 8000, r);
  r = await call('a', 'POST', '/cases', { titularidade: 'parceria', numeroProcesso: '0800004-44.2026.8.17.0001', cliente: 'X', tipoAcao: 'Y', dataProtocolo: '2026-09-15', honorariosPretendidos: 1, pctParceiro: 50, pctNosso: 50 });
  check('parceria sem parceiro selecionado é recusada', r.status === 400, r);
  r = await call('p2', 'POST', '/cases', { ...caso, titularidade: 'escritorio', numeroProcesso: '0800005-55.2026.8.17.0001' });
  check('parceiro não cadastra processo só do escritório (forçado à própria parceria)', r.status === 201 && r.data.case.titularidade === 'parceria' && r.data.case.parceiroId === pid, r);
  await call('a', 'DELETE', `/cases/${r.data.id}`);
  r = await call('a', 'PUT', `/cases/${cidE}`, { titularidade: 'escritorio', numeroProcesso: '0800003-33.2026.8.17.0001', cliente: 'Cliente Direto', tipoAcao: 'Ação indenizatória', dataProtocolo: '2026-09-15', valorAcao: 40000, pctHonorarios: 20, fase: 'julgado', valorCondenacao: 50000, resultado: 'recebido', valorRecebido: 9500, dataRecebimento: '2026-09-29', lancarFinanceiro: true });
  check('escritório recebe (quanto recebemos ≠ previsto): só a receita, sem repasse', r.status === 200 && r.data.case.financeiroStatus === 'lancado' && r.data.case.valorRecebido === 9500 && r.data.case.honorariosPretendidos === 10000, r);
  fin = await finance();
  const recE = fin.filter(e => e.caseId === cidE);
  check('receita do alvará com o valor efetivamente recebido, vinculada ao processo', recE.length === 1 && recE[0].tipo === 'receita' && recE[0].valor === 9500 && recE[0].categoria === 'Alvará de honorários finais', recE);
  r = await call('a', 'POST', '/finance', { tipo: 'receita', categoria: 'Honorários iniciais', descricao: 'Cliente Direto — entrada', valor: 3000, data: '2026-09-16', caseId: cidE });
  check('honorários iniciais lançados no Financeiro, vinculados ao processo (opcional)', r.status === 201 && r.data.entry.caseId === cidE && r.data.entry.categoria === 'Honorários iniciais', r);
  await call('a', 'DELETE', `/finance/${r.data.id}`);

  // honorários iniciais parcelados → créditos provisionados → baixa
  const grupo = 'grp-teste-1';
  const parcelas = [];
  for (let k = 1; k <= 3; k++) {
    const data = `2026-${String(9 + k).padStart(2, '0')}-10`; // 10/10, 10/11, 10/12
    r = await call('a', 'POST', '/finance', { tipo: 'receita', categoria: 'Honorários iniciais', descricao: 'Cliente Direto — entrada', valor: 1333.33, data, vencimento: data, status: k === 1 ? 'realizado' : 'provisionado', parcela: `${k}/3`, grupoId: grupo, caseId: cidE });
    check(`parcela ${k}/3 gravada como ${k === 1 ? 'realizada' : 'provisionada'}`, r.status === 201 && r.data.entry.status === (k === 1 ? 'realizado' : 'provisionado') && r.data.entry.parcela === `${k}/3` && r.data.entry.grupoId === grupo && r.data.entry.caseId === cidE, r);
    parcelas.push(r.data.id);
  }
  r = await call('a', 'POST', '/finance', { tipo: 'despesa', categoria: 'Aluguel', valor: 100, data: '2026-10-01', status: 'provisionado' });
  check('despesa provisionada é recusada', r.status === 400, r);
  r = await call('a', 'POST', '/finance', { tipo: 'receita', categoria: 'Honorários iniciais', valor: 100, data: '2026-10-01', status: 'provisionado' });
  check('provisionado sem vencimento assume a data do lançamento', r.status === 201 && r.data.entry.vencimento === '2026-10-01', r);
  await call('a', 'DELETE', `/finance/${r.data.id}`);
  r = await call('a', 'POST', '/finance', { tipo: 'receita', categoria: 'Honorários iniciais', valor: 100, data: '2026-10-01', status: 'atrasado' });
  check('situação desconhecida é recusada', r.status === 400, r);
  r = await call('a', 'PUT', `/finance/${parcelas[1]}`, { tipo: 'receita', categoria: 'Honorários iniciais', descricao: 'Cliente Direto — entrada', valor: 1333.33, data: '2026-11-12', vencimento: '2026-11-10', status: 'realizado', parcela: '2/3', grupoId: grupo, caseId: cidE });
  check('baixa da parcela 2/3: vira receita realizada mantendo vencimento, grupo e processo', r.status === 200 && r.data.entry.status === 'realizado' && r.data.entry.data === '2026-11-12' && r.data.entry.vencimento === '2026-11-10' && r.data.entry.grupoId === grupo, r);
  fin = await finance();
  check('resta 1 parcela provisionada do grupo', fin.filter(e => e.grupoId === grupo && e.status === 'provisionado').length === 1 && fin.filter(e => e.grupoId === grupo).length === 3, fin.filter(e => e.grupoId === grupo));

  // contratos com empresas → receita mensal por competência
  r = await call('p2', 'POST', '/contracts', { empresa: 'Empresa Alfa', valorMensal: 2500, dataInicio: '2026-01-01' });
  check('parceiro não cadastra contrato', r.status === 403, r);
  r = await call('a', 'POST', '/contracts', { empresa: '', valorMensal: 2500, dataInicio: '2026-01-01' });
  check('contrato sem empresa é recusado', r.status === 400, r);
  r = await call('a', 'POST', '/contracts', { empresa: 'Empresa Alfa', valorMensal: 0, dataInicio: '2026-01-01' });
  check('contrato sem valor mensal é recusado', r.status === 400, r);
  r = await call('a', 'POST', '/contracts', { empresa: 'Empresa Alfa', valorMensal: 2500, dataInicio: '2026-06-01', dataFim: '2026-01-01' });
  check('término anterior ao início é recusado', r.status === 400, r);
  r = await call('a', 'POST', '/contracts', { empresa: 'Empresa Alfa', cnpj: '12.345.678/0001-90', contato: 'Fulano', servico: 'Consultoria trabalhista', valorMensal: 2500, diaVencimento: 10, dataInicio: '2026-06-01' });
  check('admin cadastra contrato', r.status === 201 && r.data.contract.empresa === 'Empresa Alfa' && r.data.contract.valorMensal === 2500 && r.data.contract.diaVencimento === 10 && r.data.contract.ativo === true, r);
  const ctid = r.data.id;
  r = await call('a', 'POST', '/contracts', { empresa: 'Empresa Beta', valorMensal: 1000, diaVencimento: 40, dataInicio: '2026-06-01' });
  check('dia de vencimento inválido é recusado', r.status === 400, r);
  r = await call('a', 'POST', '/finance', { tipo: 'receita', categoria: 'Contratos com empresas', descricao: 'Empresa Alfa — 09/2026', valor: 2500, data: '2026-09-10', contractId: ctid, competencia: '2026-09' });
  check('recebimento mensal do contrato vira receita com contrato e competência', r.status === 201 && r.data.entry.contractId === ctid && r.data.entry.competencia === '2026-09', r);
  const ctfin = r.data.id;
  r = await call('a', 'PUT', `/contracts/${ctid}`, { empresa: 'Empresa Alfa Ltda', valorMensal: 2800, dataInicio: '2026-06-01', ativo: false });
  check('admin edita contrato (reajuste e encerramento)', r.status === 200 && r.data.contract.empresa === 'Empresa Alfa Ltda' && r.data.contract.valorMensal === 2800 && r.data.contract.ativo === false, r);
  r = await call('a', 'GET', '/bootstrap');
  check('bootstrap do admin traz contratos', Array.isArray(r.data.contracts) && r.data.contracts.length === 1, r.data.contracts);
  r = await call('p2', 'GET', '/bootstrap');
  check('bootstrap do parceiro não traz contratos', r.data.contracts === undefined, r.data);
  r = await call('a', 'DELETE', `/contracts/${ctid}`);
  check('admin exclui contrato', r.status === 200, r);
  fin = await finance();
  const kept = fin.find(e => e.id === ctfin);
  check('receita já recebida permanece após excluir o contrato (desvinculada)', kept && kept.contractId === null && kept.valor === 2500, kept);

  // compra de créditos → compra como despesa e recebimento como receita
  r = await call('a', 'POST', '/credits', { ...credito, numeroProcesso: '08088888820268170001', lancarCompra: true });
  check('crédito registrado com a compra lançada como despesa', r.status === 201 && r.data.credit.financeiroCompra === 'lancado' && r.data.credit.financeiroRecebimento === 'nao', r);
  const crid2 = r.data.id;
  fin = await finance();
  const compra = fin.find(e => e.creditId === crid2);
  check('despesa "Compra de créditos" vinculada ao crédito', compra && compra.tipo === 'despesa' && compra.categoria === 'Compra de créditos' && compra.valor === 10000 && compra.data === '2026-08-01', fin);
  r = await call('a', 'PUT', `/credits/${crid2}`, { ...credito, numeroProcesso: '08088888820268170001', recebido: true, valorRecebido: 16000, dataRecebimento: '2026-09-20', lancarRecebimento: true });
  check('recebimento do crédito lançado como receita', r.status === 200 && r.data.credit.financeiroRecebimento === 'lancado' && r.data.credit.financeiroCompra === 'lancado', r);
  fin = await finance();
  check('receita "Créditos comprados" + despesa da compra (sem duplicar)', fin.filter(e => e.creditId === crid2).length === 2 && fin.some(e => e.creditId === crid2 && e.tipo === 'receita' && e.categoria === 'Créditos comprados' && e.valor === 16000 && e.data === '2026-09-20'), fin.filter(e => e.creditId === crid2));
  r = await call('a', 'PUT', `/credits/${crid2}`, { ...credito, numeroProcesso: '08088888820268170001', recebido: true, valorRecebido: 16000, dataRecebimento: '2026-09-20', lancarRecebimento: true, lancarCompra: true });
  fin = await finance();
  check('salvar o crédito de novo não duplica lançamentos', fin.filter(e => e.creditId === crid2).length === 2, fin.filter(e => e.creditId === crid2));
  r = await call('a', 'PUT', `/credits/${crid2}`, { ...credito, numeroProcesso: '08088888820268170001', recebido: false });
  check('desmarcar recebido remove a receita e mantém a despesa da compra', r.status === 200 && r.data.credit.financeiroRecebimento === 'nao' && r.data.credit.financeiroCompra === 'lancado', r);
  fin = await finance();
  check('só a despesa da compra permanece vinculada', fin.filter(e => e.creditId === crid2).length === 1 && fin.find(e => e.creditId === crid2).tipo === 'despesa', fin.filter(e => e.creditId === crid2));
  r = await call('a', 'DELETE', `/credits/${crid2}`);
  fin = await finance();
  check('excluir crédito desvincula a despesa já lançada', r.status === 200 && fin.filter(e => e.creditId === crid2).length === 0 && fin.some(e => e.categoria === 'Compra de créditos' && e.creditId === null), fin);

  // ---- estagiários e controle de ponto ----
  r = await call('a', 'POST', '/partners', { tipo: 'estagiario', nome: 'Pedro Lima', usuario: 'pedro', senha: 'estagio1', curso: 'Direito', instituicao: 'UFMA', bolsa: 900, jornada: { dias: [1, 2, 3, 4, 5], blocos: [['08:00', '12:00']] } });
  check('admin cadastra estagiário com bolsa e jornada da manhã', r.status === 201 && r.data.partner.tipo === 'estagiario' && r.data.partner.bolsa === 900 && r.data.partner.jornada.blocos.length === 1 && r.data.partner.pctNossoPadrao === 100, r);
  const eid = r.data.id;
  r = await call('a', 'POST', '/partners', { tipo: 'estagiario', nome: 'X', usuario: 'xx1', senha: 'estagio1', jornada: { dias: [1], blocos: [['09:00', '08:00']] } });
  check('jornada com turno invertido é recusada', r.status === 400, r);
  r = await call('a', 'GET', '/partners');
  const carla = r.data.partners.find(p => p.usuario === 'carla');
  check('associado sem jornada informada recebe a integral (3 batidas)', carla && carla.jornada && carla.jornada.blocos.length === 2 && carla.jornada.blocos[1][0] === '14:00', carla);
  r = await call('e', 'POST', '/login', { usuario: 'pedro', senha: 'estagio1' });
  check('estagiário entra e a sessão traz o tipo', r.status === 200 && r.data.session.tipo === 'estagiario' && r.data.session.partnerId === eid, r);
  r = await call('e', 'GET', '/bootstrap');
  check('bootstrap do estagiário: só ele mesmo, sem processos, com ponto e configuração pública', r.status === 200 && r.data.partners.length === 1 && Array.isArray(r.data.cases) && r.data.cases.length === 0 && Array.isArray(r.data.ponto) && r.data.pontoConfig && r.data.pontoConfig.ips === undefined && r.data.finance === undefined, r.data);
  r = await call('e', 'GET', '/cases');
  check('estagiário não acessa processos', r.status === 403, r);
  r = await call('e', 'POST', '/cases', { ...caso });
  check('estagiário não cadastra processos', r.status === 403, r);
  r = await call('p2', 'POST', '/ponto', { tipo: 'entrada' });
  check('parceiro não bate ponto', r.status === 403, r);
  r = await call('e', 'PUT', '/ponto/config', { lat: -2.5, lng: -44.3 });
  check('estagiário não configura o ponto', r.status === 403, r);

  // sem configuração: a batida vale sem prova
  r = await call('e', 'POST', '/ponto', { tipo: 'entrada' });
  check('sem validação configurada a batida é registrada como válida (horário do servidor)', r.status === 201 && r.data.entry.status === 'valido' && /^\d{2}:\d{2}:\d{2}$/.test(r.data.entry.hora) && r.data.avaliacao.configurado === false, r);
  r = await call('e', 'POST', '/ponto', { tipo: 'entrada' });
  check('segunda entrada no mesmo dia é recusada', r.status === 400, r);
  // configuração: rede do escritório = IP local do teste
  r = await call('a', 'GET', '/ponto/meu-ip');
  const meuIp = r.data.ip;
  r = await call('a', 'PUT', '/ponto/config', { endereco: 'Escritório', lat: -2.4950, lng: -44.3020, raioM: 150, ips: [meuIp], toleranciaMin: 20, exigirProva: true, fuso: 'America/Fortaleza' });
  check('admin configura localização, raio, IP e tolerância', r.status === 200 && r.data.config.ips.includes(meuIp) && r.data.config.raioM === 150, r);
  r = await call('a', 'PUT', '/ponto/config', { lat: -2.4950 });
  check('latitude sem longitude é recusada', r.status === 400, r);
  r = await call('e', 'POST', '/ponto', { tipo: 'saida' });
  check('batida pela rede do escritório vale (rede_ok) mesmo sem GPS', r.status === 201 && r.data.entry.status === 'valido' && r.data.entry.redeOk === true && r.data.entry.gpsOk === false && r.data.entry.ip === meuIp, r);
  // só GPS: troca o IP autorizado por outro
  r = await call('a', 'PUT', '/ponto/config', { lat: -2.4950, lng: -44.3020, raioM: 150, ips: ['10.255.255.1'], toleranciaMin: 20, exigirProva: true });
  r = await call('e', 'POST', '/ponto', { tipo: 'volta', lat: -2.4953, lng: -44.3024, precisao: 25 });
  check('batida dentro do raio vale por GPS, com distância calculada', r.status === 201 && r.data.entry.status === 'valido' && r.data.entry.gpsOk === true && r.data.entry.distanciaM < 150, r);
  await call('a', 'DELETE', `/ponto/${r.data.id}`);
  r = await call('e', 'POST', '/ponto', { tipo: 'volta', lat: -2.5300, lng: -44.3020, precisao: 20 });
  check('batida fora do raio não é recusada: fica pendente', r.status === 201 && r.data.entry.status === 'pendente' && r.data.entry.gpsOk === false && r.data.entry.distanciaM > 1000, r);
  const pendId = r.data.id;
  r = await call('e', 'POST', '/ponto', { tipo: 'volta', lat: -2.5300, lng: -44.3020 });
  check('mesmo pendente, não duplica a mesma batida no dia', r.status === 400, r);
  r = await call('e', 'POST', `/ponto/${pendId}/decisao`, { decisao: 'aprovado' });
  check('estagiário não decide pendências', r.status === 403, r);
  r = await call('a', 'POST', `/ponto/${pendId}/decisao`, { decisao: 'aprovado', observacao: 'estava em audiência' });
  check('admin aprova a batida pendente', r.status === 200 && r.data.entry.status === 'aprovado' && r.data.entry.observacao === 'estava em audiência', r);
  // ajuste (esqueci de bater)
  r = await call('e', 'POST', '/ponto/ajuste', { data: '2026-09-28', hora: '08:05', tipo: 'entrada' });
  check('ajuste sem justificativa é recusado', r.status === 400, r);
  r = await call('e', 'POST', '/ponto/ajuste', { data: '2099-01-01', hora: '08:05', tipo: 'entrada', justificativa: 'x' });
  check('ajuste em data futura é recusado', r.status === 400, r);
  r = await call('e', 'POST', '/ponto/ajuste', { data: '2026-09-28', hora: '08:05', tipo: 'entrada', justificativa: 'celular sem bateria' });
  check('pedido de ajuste entra como pendente, origem ajuste', r.status === 201 && r.data.entry.origem === 'ajuste' && r.data.entry.status === 'pendente' && r.data.entry.hora === '08:05:00', r);
  const ajId = r.data.id;
  r = await call('a', 'POST', `/ponto/${ajId}/decisao`, { decisao: 'recusado', observacao: 'sem comprovação' });
  check('admin recusa o ajuste', r.status === 200 && r.data.entry.status === 'recusado', r);
  r = await call('a', 'POST', '/ponto/manual', { partnerId: eid, data: '2026-09-28', hora: '12:02', tipo: 'saida', observacao: 'informado por WhatsApp' });
  check('batida manual do admin entra aprovada', r.status === 201 && r.data.entry.origem === 'manual' && r.data.entry.status === 'aprovado', r);
  r = await call('a', 'POST', '/ponto/manual', { partnerId: pid, data: '2026-09-28', hora: '12:02', tipo: 'saida' });
  check('batida manual para parceiro é recusada', r.status === 400, r);
  r = await call('e', 'GET', '/ponto?mes=2026-09');
  check('estagiário lista só os próprios registros do mês', r.status === 200 && r.data.ponto.length === 2 && r.data.ponto.every(x => x.partnerId === eid), r.data);
  r = await call('a', 'GET', `/ponto?partnerId=${eid}`);
  check('admin lista os registros da pessoa (período padrão)', r.status === 200 && r.data.ponto.length >= 4 && r.data.config.ips.length === 1, r.data);
  r = await call('a', 'GET', '/bootstrap');
  check('bootstrap do admin traz ponto e configuração completa', Array.isArray(r.data.ponto) && r.data.pontoConfig && Array.isArray(r.data.pontoConfig.ips), r.data.pontoConfig);
  r = await call('p2', 'GET', '/bootstrap');
  check('bootstrap do parceiro não traz ponto', r.data.ponto === undefined, r.data);
  // bolsa do estagiário no financeiro
  r = await call('a', 'POST', '/finance', { tipo: 'despesa', categoria: 'Estagiários (bolsa)', descricao: 'Bolsa — Pedro Lima', valor: 900, data: '2026-09-30', competencia: '2026-09', associadoId: eid });
  check('bolsa do estagiário entra como despesa própria por competência', r.status === 201 && r.data.entry.categoria === 'Estagiários (bolsa)' && r.data.entry.associadoId === eid, r);
  r = await call('a', 'POST', `/partners/${eid}/ativo`, { ativo: false });
  r = await call('e', 'POST', '/ponto', { tipo: 'saida' });
  check('estagiário desativado não bate ponto', r.status === 401, r);

  {
    const res = await fetch(`http://localhost:${PORT}/api/backup`, { headers: { Cookie: jars.a } });
    const buf = Buffer.from(await res.arrayBuffer());
    check('admin baixa um backup do banco (arquivo SQLite)', res.status === 200 && /attachment; filename="parcerias-backup-/.test(res.headers.get('content-disposition') || '') && buf.slice(0, 15).toString() === 'SQLite format 3', { status: res.status, head: buf.slice(0, 15).toString() });
    const res2 = await fetch(`http://localhost:${PORT}/api/backup`, { headers: { Cookie: jars.p2 } });
    check('parceiro não baixa backup', res2.status === 403, res2.status);
  }
  r = await call('a', 'GET', '/health');
  check('health ok', r.status === 200 && r.data.ok, r);
} finally {
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} verificação(ões) falharam.` : '\nTodas as verificações passaram.');
process.exit(failures ? 1 : 0);
