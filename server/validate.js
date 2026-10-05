/*
 * Validação e normalização das entradas da API.
 * Cada função devolve o objeto limpo ou lança { status: 400, message }.
 */
class ValidationError extends Error { constructor(m) { super(m); this.status = 400; } }
const fail = m => { throw new ValidationError(m); };

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const money = v => { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 1e12) fail('Valor monetário inválido.'); return Math.round(n * 100) / 100; };
const pctv = v => { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 100) fail('Percentual inválido.'); return Math.round(n * 100) / 100; };
const dateISO = (v, label) => { const s = str(v, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) fail(`Data inválida: ${label}.`); return s; };
const normUser = u => String(u ?? '').trim().toLowerCase().replace(/\s+/g, '.');
const cnj = raw => { const d = String(raw ?? '').replace(/\D/g, ''); if (d.length === 20) return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`; return String(raw ?? '').trim(); };

function username(u) {
  const s = normUser(u);
  if (!/^[a-z0-9._-]{3,40}$/.test(s)) fail('Usuário: use de 3 a 40 caracteres, só letras minúsculas, números, ponto, hífen ou sublinhado.');
  return s;
}
function password(p, min = 8) {
  const s = String(p ?? '');
  if (s.length < min) fail(`A senha precisa ter pelo menos ${min} caracteres.`);
  if (s.length > 128) fail('Senha longa demais.');
  return s;
}

function caseInput(b) {
  const natureza = str(b.natureza || 'judicial', 20).toLowerCase();
  if (natureza !== 'judicial' && natureza !== 'administrativo') fail('Natureza inválida: use judicial ou administrativo.');
  const fase = str(b.fase || 'em_curso', 20).toLowerCase();
  if (fase !== 'em_curso' && fase !== 'julgado') fail('Fase inválida: use em_curso ou julgado.');
  const resultado = str(b.resultado || (b.recebido ? 'recebido' : 'em_andamento'), 20).toLowerCase();
  if (!['em_andamento', 'recebido', 'perdido'].includes(resultado)) fail('Situação inválida: use em_andamento, recebido ou perdido.');
  const titularidade = str(b.titularidade || (b.parceiroId ? 'parceria' : 'escritorio'), 20).toLowerCase();
  if (titularidade !== 'parceria' && titularidade !== 'escritorio') fail('Titularidade inválida: use parceria ou escritorio.');
  const baseHonorarios = str(b.baseHonorarios || (titularidade === 'escritorio' ? 'valor_causa' : 'fixo'), 20).toLowerCase();
  if (!['valor_causa', 'reducao_debito', 'fixo'].includes(baseHonorarios)) fail('Base dos honorários inválida: use valor_causa, reducao_debito ou fixo.');
  const c = {
    parceiroId: titularidade === 'escritorio' ? null : str(b.parceiroId, 64),
    titularidade,
    valorAcao: b.valorAcao == null || b.valorAcao === '' ? null : money(b.valorAcao),
    valorCondenacao: fase === 'julgado' && b.valorCondenacao != null && b.valorCondenacao !== '' ? money(b.valorCondenacao) : null,
    baseHonorarios,
    valorDebito: baseHonorarios === 'reducao_debito' && b.valorDebito != null && b.valorDebito !== '' ? money(b.valorDebito) : null,
    valorDevido: baseHonorarios === 'reducao_debito' && b.valorDevido != null && b.valorDevido !== '' ? money(b.valorDevido) : null,
    valorReconhecido: baseHonorarios === 'reducao_debito' && fase === 'julgado' && b.valorReconhecido != null && b.valorReconhecido !== '' ? money(b.valorReconhecido) : null,
    honorariosIniciais: money(b.honorariosIniciais ?? 0),
    pctHonorarios: baseHonorarios !== 'fixo' && b.pctHonorarios != null && b.pctHonorarios !== '' ? pctv(b.pctHonorarios) : null,
    natureza, fase, resultado,
    numeroProcesso: natureza === 'judicial' ? cnj(str(b.numeroProcesso, 40)) : str(b.numeroProcesso, 60),
    cliente: str(b.cliente, 160),
    tipoAcao: str(b.tipoAcao, 120),
    dataProtocolo: dateISO(b.dataProtocolo, 'data do protocolo'),
    honorariosPretendidos: money(b.honorariosPretendidos ?? 0),
    custoLead: money(b.custoLead ?? 0),
    pctParceiro: titularidade === 'escritorio' ? 0 : pctv(b.pctParceiro),
    pctNosso: titularidade === 'escritorio' ? 100 : pctv(b.pctNosso),
    recebido: resultado === 'recebido',
    valorRecebido: null, dataRecebimento: null, dataEncerramento: null, fluxoRecebimento: 'escritorio',
    temCorretor: !!b.temCorretor,
    nomeCorretor: '', valorCorretor: 0, corretorPago: false,
    observacoes: str(b.observacoes, 4000)
  };
  if (titularidade === 'parceria' && !c.parceiroId) fail('Selecione o advogado parceiro ou associado.');
  if (titularidade === 'escritorio') { c.pctParceiro = 0; c.pctNosso = 100; c.fluxoRecebimento = 'escritorio'; }
  // honorários finais = % sobre a base (valor da causa/condenação ou redução do débito), salvo valor informado à mão
  if (baseHonorarios !== 'fixo' && !(c.honorariosPretendidos > 0) && c.pctHonorarios != null) {
    let base = null;
    if (baseHonorarios === 'valor_causa') base = fase === 'julgado' && c.valorCondenacao != null ? c.valorCondenacao : c.valorAcao;
    else { const alvo = fase === 'julgado' && c.valorReconhecido != null ? c.valorReconhecido : c.valorDevido; if (c.valorDebito != null && alvo != null) base = Math.max(0, c.valorDebito - alvo); }
    if (base != null) c.honorariosPretendidos = Math.round(base * c.pctHonorarios) / 100;
  }
  if (baseHonorarios === 'reducao_debito' && c.valorDebito != null && c.valorDevido != null && c.valorDevido > c.valorDebito) fail('O valor que entendemos devido não pode ser maior que o valor cobrado na execução.');
  if (!c.numeroProcesso) fail('Informe o número do processo.');
  if (!c.cliente) fail('Informe o nome do cliente.');
  if (!c.tipoAcao) fail('Informe o tipo de ação.');
  if (Math.abs(c.pctParceiro + c.pctNosso - 100) > 0.01) fail('Os percentuais precisam somar 100%.');
  if (c.recebido) {
    c.valorRecebido = b.valorRecebido == null || b.valorRecebido === '' ? c.honorariosPretendidos : money(b.valorRecebido);
    c.dataRecebimento = dateISO(b.dataRecebimento, 'data do recebimento');
    c.fluxoRecebimento = b.fluxoRecebimento === 'parceiro' ? 'parceiro' : 'escritorio';
  }
  if (resultado === 'perdido') c.dataEncerramento = b.dataEncerramento ? dateISO(b.dataEncerramento, 'data do encerramento') : new Date().toISOString().slice(0, 10);
  if (c.temCorretor) {
    c.nomeCorretor = str(b.nomeCorretor, 160);
    c.valorCorretor = money(b.valorCorretor ?? 0);
    c.corretorPago = !!b.corretorPago;
  }
  return c;
}

/* Jornada de trabalho: dias da semana (0 = domingo) e 1 ou 2 blocos de horário "HH:MM". */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const JORNADA_PADRAO = {
  associado: { dias: [1, 2, 3, 4, 5], blocos: [['08:00', '12:00'], ['14:00', '17:30']] },
  estagiario: { dias: [1, 2, 3, 4, 5], blocos: [['08:00', '12:00']] }
};
function jornadaInput(j, tipo) {
  if (j == null || j === '') return JORNADA_PADRAO[tipo] ? { ...JORNADA_PADRAO[tipo] } : null;
  if (typeof j === 'string') { try { j = JSON.parse(j); } catch { fail('Jornada inválida.'); } }
  const dias = Array.from(new Set((Array.isArray(j.dias) ? j.dias : [1, 2, 3, 4, 5]).map(Number))).filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (!dias.length) fail('Informe ao menos um dia da semana na jornada.');
  const blocos = (Array.isArray(j.blocos) ? j.blocos : []).map(b => [str(b?.[0], 5), str(b?.[1], 5)]);
  if (blocos.length < 1 || blocos.length > 2) fail('A jornada precisa ter 1 ou 2 turnos.');
  const toMin = h => +h.slice(0, 2) * 60 + +h.slice(3, 5);
  let last = -1;
  for (const [a, b] of blocos) {
    if (!HHMM.test(a) || !HHMM.test(b)) fail('Horário da jornada inválido (use HH:MM).');
    if (toMin(a) <= last || toMin(b) <= toMin(a)) fail('Os turnos da jornada precisam estar em ordem e sem sobreposição.');
    last = toMin(b);
  }
  return { dias, blocos };
}

function partnerInput(b) {
  const tipo = str(b.tipo || 'parceiro', 20).toLowerCase();
  if (!['parceiro', 'associado', 'estagiario'].includes(tipo)) fail('Tipo inválido: use parceiro, associado ou estagiario.');
  const est = tipo === 'estagiario', ass = tipo === 'associado';
  const p = {
    tipo, nome: str(b.nome, 160), escritorio: est || ass ? '' : str(b.escritorio, 200), oab: str(b.oab, 40), email: str(b.email, 160), telefone: str(b.telefone, 40),
    usuario: username(b.usuario),
    areaAtuacao: ass ? str(b.areaAtuacao, 120) : '', especializacao: ass ? str(b.especializacao, 160) : '', termos: ass || est ? str(b.termos, 2000) : '',
    salarioFixo: ass ? money(b.salarioFixo ?? 0) : 0,
    pctBonificacaoPadrao: ass ? pctv(b.pctBonificacaoPadrao ?? 0) : 0,
    pctParceiroPadrao: est ? 0 : pctv(b.pctParceiroPadrao ?? 50), pctNossoPadrao: est ? 100 : pctv(b.pctNossoPadrao ?? 50),
    curso: est ? str(b.curso, 160) : '', instituicao: est ? str(b.instituicao, 160) : '', supervisor: est ? str(b.supervisor, 160) : '',
    inicioEstagio: est && b.inicioEstagio ? dateISO(b.inicioEstagio, 'início do estágio') : null, fimEstagio: est && b.fimEstagio ? dateISO(b.fimEstagio, 'término do estágio') : null,
    bolsa: est ? money(b.bolsa ?? 0) : 0,
    jornada: ass || est ? jornadaInput(b.jornada, tipo) : null
  };
  if (!p.nome) fail(est ? 'Informe o nome do estagiário.' : 'Informe o nome do advogado.');
  if (ass) { p.pctParceiroPadrao = p.pctBonificacaoPadrao; p.pctNossoPadrao = Math.round((100 - p.pctBonificacaoPadrao) * 100) / 100; if (!p.areaAtuacao) fail('Informe a área de atuação do associado.'); }
  else if (!est && Math.abs(p.pctParceiroPadrao + p.pctNossoPadrao - 100) > 0.01) fail('Os percentuais padrão precisam somar 100%.');
  if (p.fimEstagio && p.inicioEstagio && p.fimEstagio < p.inicioEstagio) fail('O término do estágio não pode ser anterior ao início.');
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) fail('E-mail inválido.');
  return p;
}

/* ---- controle de ponto ---- */
const PONTO_TIPOS = ['entrada', 'volta', 'saida'];
const coord = (v, label, lim) => { if (v == null || v === '') return null; const n = Number(v); if (!Number.isFinite(n) || Math.abs(n) > lim) fail(`${label} inválida.`); return n; };
function pontoConfigInput(b) {
  const c = {
    endereco: str(b.endereco, 200),
    lat: coord(b.lat, 'Latitude', 90), lng: coord(b.lng, 'Longitude', 180),
    raioM: b.raioM == null || b.raioM === '' ? 150 : Number(b.raioM),
    ips: Array.from(new Set((Array.isArray(b.ips) ? b.ips : String(b.ips || '').split(/[\s,;]+/)).map(x => str(x, 64)).filter(Boolean))),
    toleranciaMin: b.toleranciaMin == null || b.toleranciaMin === '' ? 20 : Number(b.toleranciaMin),
    exigirProva: b.exigirProva == null ? true : !!b.exigirProva,
    fuso: str(b.fuso || 'America/Fortaleza', 64)
  };
  if ((c.lat == null) !== (c.lng == null)) fail('Informe latitude e longitude juntas.');
  if (!Number.isFinite(c.raioM) || c.raioM < 20 || c.raioM > 5000) fail('Raio inválido (20 a 5000 metros).');
  if (!Number.isInteger(c.toleranciaMin) || c.toleranciaMin < 0 || c.toleranciaMin > 180) fail('Tolerância inválida (0 a 180 minutos).');
  for (const ip of c.ips) if (!/^[0-9a-fA-F.:*]{3,64}$/.test(ip)) fail(`IP inválido: ${ip}`);
  try { new Intl.DateTimeFormat('en-US', { timeZone: c.fuso }); } catch { fail('Fuso horário inválido.'); }
  return c;
}
function punchInput(b) {
  const tipo = str(b.tipo, 10).toLowerCase();
  if (!PONTO_TIPOS.includes(tipo)) fail('Tipo de batida inválido.');
  const lat = coord(b.lat, 'Latitude', 90), lng = coord(b.lng, 'Longitude', 180);
  const precisao = b.precisao == null || b.precisao === '' ? null : Math.max(0, Number(b.precisao) || 0);
  return { tipo, lat, lng: lat == null ? null : lng, precisao };
}
function adjustInput(b, { admin } = {}) {
  const tipo = str(b.tipo, 10).toLowerCase();
  if (!PONTO_TIPOS.includes(tipo)) fail('Tipo de batida inválido.');
  const data = dateISO(b.data, 'data da batida'), hora = str(b.hora, 5);
  if (!HHMM.test(hora)) fail('Hora inválida (use HH:MM).');
  const hoje = new Date().toISOString().slice(0, 10);
  if (data > hoje) fail('Não é possível registrar batida em data futura.');
  const justificativa = str(b.justificativa ?? b.observacao, 500);
  if (!admin && !justificativa) fail('Explique o motivo do ajuste.');
  return { tipo, data, hora: hora + ':00', justificativa, partnerId: admin ? str(b.partnerId, 64) : null };
}

function contractInput(b) {
  const c = {
    empresa: str(b.empresa, 160), cnpj: str(b.cnpj, 20), contato: str(b.contato, 160), servico: str(b.servico, 200),
    valorMensal: money(b.valorMensal), diaVencimento: b.diaVencimento == null || b.diaVencimento === '' ? null : Number(b.diaVencimento),
    dataInicio: dateISO(b.dataInicio, 'data de início'), dataFim: b.dataFim ? dateISO(b.dataFim, 'data de término') : null,
    ativo: b.ativo == null ? true : !!b.ativo, observacoes: str(b.observacoes, 2000)
  };
  if (!c.empresa) fail('Informe o nome da empresa.');
  if (!(c.valorMensal > 0)) fail('Informe o valor mensal do contrato.');
  if (c.diaVencimento != null && (!Number.isInteger(c.diaVencimento) || c.diaVencimento < 1 || c.diaVencimento > 31)) fail('Dia de vencimento inválido (1 a 31).');
  if (c.dataFim && c.dataFim < c.dataInicio) fail('A data de término não pode ser anterior ao início.');
  return c;
}

function creditInput(b) {
  const c = {
    numeroProcesso: cnj(str(b.numeroProcesso, 40)),
    cedente: str(b.cedente, 160),
    dataCompra: dateISO(b.dataCompra, 'data da compra'),
    dataPrevista: b.dataPrevista ? dateISO(b.dataPrevista, 'possível data de recebimento') : null,
    valorCompra: money(b.valorCompra),
    valorReceber: money(b.valorReceber),
    recebido: !!b.recebido,
    valorRecebido: null, dataRecebimento: null,
    observacoes: str(b.observacoes, 4000)
  };
  if (!c.numeroProcesso) fail('Informe o número do processo.');
  if (c.recebido) {
    c.valorRecebido = b.valorRecebido == null || b.valorRecebido === '' ? c.valorReceber : money(b.valorRecebido);
    c.dataRecebimento = dateISO(b.dataRecebimento, 'data do recebimento');
  }
  return c;
}

function financeInput(b) {
  const tipo = str(b.tipo, 10).toLowerCase();
  if (tipo !== 'receita' && tipo !== 'despesa') fail('Tipo inválido: use receita ou despesa.');
  const f = {
    tipo, categoria: str(b.categoria, 80), descricao: str(b.descricao, 200),
    valor: money(b.valor), data: dateISO(b.data, 'data do lançamento'), observacoes: str(b.observacoes, 2000),
    contractId: b.contractId ? str(b.contractId, 64) : null, creditId: b.creditId ? str(b.creditId, 64) : null, associadoId: b.associadoId ? str(b.associadoId, 64) : null,
    caseId: b.caseId ? str(b.caseId, 64) : null,
    competencia: b.competencia ? str(b.competencia, 7) : null,
    status: str(b.status || 'realizado', 20).toLowerCase(), vencimento: b.vencimento ? dateISO(b.vencimento, 'vencimento') : null,
    parcela: b.parcela ? str(b.parcela, 12) : null, grupoId: b.grupoId ? str(b.grupoId, 64) : null
  };
  if (!f.categoria) fail('Informe a categoria.');
  if (!(f.valor > 0)) fail('Informe um valor maior que zero.');
  if (f.competencia && !/^\d{4}-\d{2}$/.test(f.competencia)) fail('Competência inválida (use AAAA-MM).');
  if (f.status !== 'realizado' && f.status !== 'provisionado') fail('Situação inválida: use realizado ou provisionado.');
  if (f.status === 'provisionado' && tipo !== 'receita') fail('Só receitas podem ser provisionadas.');
  if (f.status === 'provisionado' && !f.vencimento) f.vencimento = f.data;
  return f;
}

module.exports = { ValidationError, caseInput, partnerInput, contractInput, creditInput, financeInput, pontoConfigInput, punchInput, adjustInput, jornadaInput, JORNADA_PADRAO, username, password, normUser, cnj };
