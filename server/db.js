/*
 * Banco de dados — SQLite via better-sqlite3.
 * Um único arquivo (DB_PATH), modo WAL, chaves estrangeiras ativas.
 * Para migrar a PostgreSQL no futuro, este é o único módulo que muda de driver:
 * as consultas são SQL simples e ficam nas rotas.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'parcerias.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  escritorio TEXT DEFAULT '',
  oab TEXT DEFAULT '',
  email TEXT DEFAULT '',
  telefone TEXT DEFAULT '',
  pct_parceiro_padrao REAL NOT NULL DEFAULT 50,
  pct_nosso_padrao REAL NOT NULL DEFAULT 50,
  tipo TEXT NOT NULL DEFAULT 'parceiro',
  area_atuacao TEXT DEFAULT '',
  especializacao TEXT DEFAULT '',
  salario_fixo REAL NOT NULL DEFAULT 0,
  pct_bonificacao_padrao REAL NOT NULL DEFAULT 0,
  termos TEXT DEFAULT '',
  curso TEXT DEFAULT '',
  instituicao TEXT DEFAULT '',
  supervisor TEXT DEFAULT '',
  inicio_estagio TEXT,
  fim_estagio TEXT,
  bolsa REAL NOT NULL DEFAULT 0,
  jornada TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

-- Controle de ponto: cada batida é uma linha; nunca se edita, só se ajusta (nova linha com origem 'ajuste'/'manual').
CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES partners(id),
  tipo TEXT NOT NULL,
  data TEXT NOT NULL,
  hora TEXT NOT NULL,
  registrado_em TEXT NOT NULL,
  origem TEXT NOT NULL DEFAULT 'app',
  status TEXT NOT NULL DEFAULT 'valido',
  lat REAL, lng REAL, precisao REAL, distancia_m REAL,
  ip TEXT, rede_ok INTEGER NOT NULL DEFAULT 0, gps_ok INTEGER NOT NULL DEFAULT 0,
  justificativa TEXT DEFAULT '',
  decidido_por TEXT, decidido_em TEXT, observacao TEXT DEFAULT '',
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_time_partner_data ON time_entries(partner_id, data);
CREATE INDEX IF NOT EXISTS idx_time_data ON time_entries(data);

CREATE TABLE IF NOT EXISTS settings (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  usuario TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','partner')),
  partner_id TEXT REFERENCES partners(id) ON DELETE CASCADE,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_partner ON users(partner_id);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  partner_id TEXT REFERENCES partners(id),
  titularidade TEXT NOT NULL DEFAULT 'parceria',
  valor_acao REAL,
  valor_condenacao REAL,
  pct_honorarios REAL,
  base_honorarios TEXT NOT NULL DEFAULT 'valor_causa',
  valor_debito REAL,
  valor_devido REAL,
  valor_reconhecido REAL,
  honorarios_iniciais REAL NOT NULL DEFAULT 0,
  natureza TEXT NOT NULL DEFAULT 'judicial',
  fase TEXT NOT NULL DEFAULT 'em_curso',
  resultado TEXT NOT NULL DEFAULT 'em_andamento',
  numero_processo TEXT NOT NULL,
  cliente TEXT NOT NULL,
  tipo_acao TEXT NOT NULL DEFAULT '',
  data_protocolo TEXT NOT NULL,
  honorarios_pretendidos REAL NOT NULL DEFAULT 0,
  custo_lead REAL NOT NULL DEFAULT 0,
  pct_parceiro REAL NOT NULL DEFAULT 50,
  pct_nosso REAL NOT NULL DEFAULT 50,
  recebido INTEGER NOT NULL DEFAULT 0,
  valor_recebido REAL,
  data_recebimento TEXT,
  data_encerramento TEXT,
  fluxo_recebimento TEXT NOT NULL DEFAULT 'escritorio',
  financeiro_status TEXT NOT NULL DEFAULT 'nao',
  financeiro_em TEXT,
  tem_corretor INTEGER NOT NULL DEFAULT 0,
  nome_corretor TEXT DEFAULT '',
  valor_corretor REAL NOT NULL DEFAULT 0,
  corretor_pago INTEGER NOT NULL DEFAULT 0,
  observacoes TEXT DEFAULT '',
  criado_por TEXT,
  atualizado_por TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cases_partner ON cases(partner_id);
CREATE INDEX IF NOT EXISTS idx_cases_protocolo ON cases(data_protocolo);
CREATE INDEX IF NOT EXISTS idx_cases_numero ON cases(numero_processo);

CREATE TABLE IF NOT EXISTS credits (
  id TEXT PRIMARY KEY,
  numero_processo TEXT NOT NULL,
  cedente TEXT DEFAULT '',
  data_compra TEXT NOT NULL,
  valor_compra REAL NOT NULL DEFAULT 0,
  valor_receber REAL NOT NULL DEFAULT 0,
  data_prevista TEXT,
  recebido INTEGER NOT NULL DEFAULT 0,
  valor_recebido REAL,
  data_recebimento TEXT,
  financeiro_compra TEXT NOT NULL DEFAULT 'nao',
  financeiro_recebimento TEXT NOT NULL DEFAULT 'nao',
  observacoes TEXT DEFAULT '',
  criado_por TEXT,
  atualizado_por TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credits_compra ON credits(data_compra);

CREATE TABLE IF NOT EXISTS finance_entries (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('receita','despesa')),
  categoria TEXT NOT NULL,
  descricao TEXT DEFAULT '',
  valor REAL NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  observacoes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'realizado',
  vencimento TEXT,
  parcela TEXT,
  grupo_id TEXT,
  case_id TEXT,
  contract_id TEXT,
  competencia TEXT,
  credit_id TEXT,
  associado_id TEXT,
  criado_por TEXT,
  atualizado_por TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_finance_data ON finance_entries(data);
CREATE INDEX IF NOT EXISTS idx_finance_tipo ON finance_entries(tipo);

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  empresa TEXT NOT NULL,
  cnpj TEXT DEFAULT '',
  contato TEXT DEFAULT '',
  servico TEXT DEFAULT '',
  valor_mensal REAL NOT NULL DEFAULT 0,
  dia_vencimento INTEGER,
  data_inicio TEXT NOT NULL,
  data_fim TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  observacoes TEXT DEFAULT '',
  criado_por TEXT,
  atualizado_por TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  usuario TEXT,
  acao TEXT NOT NULL,
  entidade TEXT NOT NULL,
  entidade_id TEXT,
  detalhes TEXT,
  ip TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_criado ON audit_log(criado_em);
`;

db.exec(SCHEMA);

/* ---------- migrações (bancos criados por versões anteriores) ---------- */
const CURRENT_VERSION = 10;
const MIGRATIONS = {
  // v2: possível data de recebimento nas compras de crédito
  2: () => {
    const cols = db.prepare('PRAGMA table_info(credits)').all().map(c => c.name);
    if (!cols.includes('data_prevista')) db.exec('ALTER TABLE credits ADD COLUMN data_prevista TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_credits_prevista ON credits(data_prevista)');
  },
  // v3: financeiro do escritório (a tabela já é criada pelo SCHEMA; nada a converter)
  3: () => {},
  // v4: natureza do processo (judicial | administrativo)
  4: () => {
    const cols = db.prepare('PRAGMA table_info(cases)').all().map(c => c.name);
    if (!cols.includes('natureza')) db.exec("ALTER TABLE cases ADD COLUMN natureza TEXT NOT NULL DEFAULT 'judicial'");
  },
  // v5: fase (em curso/julgado), situação (em andamento/recebido/perdido) e integração com o financeiro
  5: () => {
    const cols = db.prepare('PRAGMA table_info(cases)').all().map(c => c.name);
    const add = (name, ddl) => { if (!cols.includes(name)) db.exec(`ALTER TABLE cases ADD COLUMN ${ddl}`); };
    add('fase', "fase TEXT NOT NULL DEFAULT 'em_curso'");
    add('resultado', "resultado TEXT NOT NULL DEFAULT 'em_andamento'");
    add('data_encerramento', 'data_encerramento TEXT');
    add('fluxo_recebimento', "fluxo_recebimento TEXT NOT NULL DEFAULT 'escritorio'");
    add('financeiro_status', "financeiro_status TEXT NOT NULL DEFAULT 'nao'");
    add('financeiro_em', 'financeiro_em TEXT');
    db.exec("UPDATE cases SET resultado = 'recebido', financeiro_status = 'pendente' WHERE recebido = 1 AND resultado = 'em_andamento'");
    const fcols = db.prepare('PRAGMA table_info(finance_entries)').all().map(c => c.name);
    if (!fcols.includes('case_id')) db.exec('ALTER TABLE finance_entries ADD COLUMN case_id TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_finance_case ON finance_entries(case_id)');
  },
  // v6: contratos com empresas, advogados associados, créditos no financeiro
  6: () => {
    const has = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c);
    const add = (t, c, ddl) => { if (!has(t, c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${ddl}`); };
    add('partners', 'tipo', "tipo TEXT NOT NULL DEFAULT 'parceiro'");
    add('partners', 'area_atuacao', "area_atuacao TEXT DEFAULT ''");
    add('partners', 'especializacao', "especializacao TEXT DEFAULT ''");
    add('partners', 'salario_fixo', 'salario_fixo REAL NOT NULL DEFAULT 0');
    add('partners', 'pct_bonificacao_padrao', 'pct_bonificacao_padrao REAL NOT NULL DEFAULT 0');
    add('partners', 'termos', "termos TEXT DEFAULT ''");
    add('credits', 'financeiro_compra', "financeiro_compra TEXT NOT NULL DEFAULT 'nao'");
    add('credits', 'financeiro_recebimento', "financeiro_recebimento TEXT NOT NULL DEFAULT 'nao'");
    add('finance_entries', 'contract_id', 'contract_id TEXT');
    add('finance_entries', 'competencia', 'competencia TEXT');
    add('finance_entries', 'credit_id', 'credit_id TEXT');
    add('finance_entries', 'associado_id', 'associado_id TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_finance_contract ON finance_entries(contract_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_finance_credit ON finance_entries(credit_id)');
  },
  // v7: processos só do escritório (sem parceiro) e receitas provisionadas (parcelas)
  7: () => {
    const has = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c);
    const add = (t, c, ddl) => { if (!has(t, c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${ddl}`); };
    add('finance_entries', 'status', "status TEXT NOT NULL DEFAULT 'realizado'");
    add('finance_entries', 'vencimento', 'vencimento TEXT');
    add('finance_entries', 'parcela', 'parcela TEXT');
    add('finance_entries', 'grupo_id', 'grupo_id TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_finance_status ON finance_entries(status)');
    add('cases', 'titularidade', "titularidade TEXT NOT NULL DEFAULT 'parceria'");
    add('cases', 'valor_acao', 'valor_acao REAL');
    add('cases', 'pct_honorarios_iniciais', 'pct_honorarios_iniciais REAL');
    // partner_id passa a aceitar nulo: SQLite exige recriar a tabela
    const partnerNotNull = db.prepare('PRAGMA table_info(cases)').all().find(c => c.name === 'partner_id')?.notnull === 1;
    if (partnerNotNull) {
      db.pragma('foreign_keys = OFF');
      const cols = db.prepare('PRAGMA table_info(cases)').all().map(c => c.name);
      const createSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cases'").get().sql
        .replace(/CREATE TABLE\s+cases/i, 'CREATE TABLE cases_new').replace(/partner_id TEXT NOT NULL REFERENCES partners\(id\)/i, 'partner_id TEXT REFERENCES partners(id)');
      db.exec(createSql);
      db.exec(`INSERT INTO cases_new (${cols.join(',')}) SELECT ${cols.join(',')} FROM cases`);
      db.exec('DROP TABLE cases'); db.exec('ALTER TABLE cases_new RENAME TO cases');
      db.exec('CREATE INDEX IF NOT EXISTS idx_cases_partner ON cases(partner_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_cases_protocolo ON cases(data_protocolo)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_cases_numero ON cases(numero_processo)');
      db.pragma('foreign_keys = ON');
    }
  },
  // v8: valor da condenação e % de honorários finais do escritório (os honorários iniciais passam a ser só receita do Financeiro)
  8: () => {
    const has = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c);
    const add = (t, c, ddl) => { if (!has(t, c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${ddl}`); };
    add('cases', 'valor_condenacao', 'valor_condenacao REAL');
    add('cases', 'pct_honorarios', 'pct_honorarios REAL');
    if (has('cases', 'pct_honorarios_iniciais')) { try { db.exec('ALTER TABLE cases DROP COLUMN pct_honorarios_iniciais'); } catch { /* SQLite antigo: a coluna fica sem uso */ } }
  },
  // v9: estagiários (bolsa, estágio, jornada), controle de ponto e configurações
  9: () => {
    const has = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c);
    const add = (t, c, ddl) => { if (!has(t, c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${ddl}`); };
    add('partners', 'curso', "curso TEXT DEFAULT ''");
    add('partners', 'instituicao', "instituicao TEXT DEFAULT ''");
    add('partners', 'supervisor', "supervisor TEXT DEFAULT ''");
    add('partners', 'inicio_estagio', 'inicio_estagio TEXT');
    add('partners', 'fim_estagio', 'fim_estagio TEXT');
    add('partners', 'bolsa', 'bolsa REAL NOT NULL DEFAULT 0');
    add('partners', 'jornada', 'jornada TEXT');
    // time_entries e settings já são criadas pelo SCHEMA (CREATE TABLE IF NOT EXISTS) ao subir
  },
  // v10: base de cálculo dos honorários finais (valor da causa | redução do débito | valor combinado) e honorários iniciais pagos
  10: () => {
    const has = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c);
    const add = (t, c, ddl) => { if (!has(t, c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${ddl}`); };
    const nova = !has('cases', 'base_honorarios');
    add('cases', 'base_honorarios', "base_honorarios TEXT NOT NULL DEFAULT 'valor_causa'");
    add('cases', 'valor_debito', 'valor_debito REAL');
    add('cases', 'valor_devido', 'valor_devido REAL');
    add('cases', 'valor_reconhecido', 'valor_reconhecido REAL');
    add('cases', 'honorarios_iniciais', 'honorarios_iniciais REAL NOT NULL DEFAULT 0');
    // processos de parceria antigos tinham honorários informados em valor fixo
    if (nova) db.exec("UPDATE cases SET base_honorarios = 'fixo' WHERE titularidade <> 'escritorio' OR partner_id IS NOT NULL");
  }
};
const verRow = db.prepare('SELECT version FROM schema_version').get();
let version = verRow ? verRow.version : 0;
if (!verRow) { db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(CURRENT_VERSION); version = CURRENT_VERSION; }
for (let v = version + 1; v <= CURRENT_VERSION; v++) {
  db.transaction(() => { MIGRATIONS[v]?.(); db.prepare('UPDATE schema_version SET version = ?').run(v); })();
  console.log(`Banco migrado para a versão ${v}.`);
}
/* Índices em colunas acrescentadas por migrações: criados depois delas (valem para bancos novos e antigos). */
db.exec(`
CREATE INDEX IF NOT EXISTS idx_credits_prevista ON credits(data_prevista);
CREATE INDEX IF NOT EXISTS idx_finance_case ON finance_entries(case_id);
CREATE INDEX IF NOT EXISTS idx_finance_contract ON finance_entries(contract_id);
CREATE INDEX IF NOT EXISTS idx_finance_credit ON finance_entries(credit_id);
CREATE INDEX IF NOT EXISTS idx_finance_status ON finance_entries(status);
`);

/* ---------- utilitários ---------- */
const nowISO = () => new Date().toISOString();
const uuid = () => require('crypto').randomUUID();

function audit({ user, acao, entidade, entidadeId, detalhes, ip }) {
  db.prepare('INSERT INTO audit_log (user_id, usuario, acao, entidade, entidade_id, detalhes, ip, criado_em) VALUES (?,?,?,?,?,?,?,?)')
    .run(user?.id || null, user?.usuario || null, acao, entidade, entidadeId || null, detalhes ? JSON.stringify(detalhes) : null, ip || null, nowISO());
}

/* Conversão linha SQL (snake_case) → objeto do front-end (camelCase) */
function partnerRow(r) {
  if (!r) return null;
  return {
    id: r.id, nome: r.nome, escritorio: r.escritorio || '', oab: r.oab || '', email: r.email || '', telefone: r.telefone || '',
    pctParceiroPadrao: r.pct_parceiro_padrao, pctNossoPadrao: r.pct_nosso_padrao, ativo: !!r.ativo,
    tipo: r.tipo || 'parceiro', areaAtuacao: r.area_atuacao || '', especializacao: r.especializacao || '', salarioFixo: r.salario_fixo || 0, pctBonificacaoPadrao: r.pct_bonificacao_padrao || 0, termos: r.termos || '',
    curso: r.curso || '', instituicao: r.instituicao || '', supervisor: r.supervisor || '', inicioEstagio: r.inicio_estagio || null, fimEstagio: r.fim_estagio || null, bolsa: r.bolsa || 0,
    jornada: parseJSON(r.jornada),
    usuario: r.usuario || '', criadoEm: r.criado_em, atualizadoEm: r.atualizado_em
  };
}
function parseJSON(v) { if (v == null || v === '') return null; try { return JSON.parse(v); } catch { return null; } }
function timeRow(r) {
  if (!r) return null;
  return {
    id: r.id, partnerId: r.partner_id, tipo: r.tipo, data: r.data, hora: r.hora, registradoEm: r.registrado_em, origem: r.origem, status: r.status,
    lat: r.lat, lng: r.lng, precisao: r.precisao, distanciaM: r.distancia_m, ip: r.ip || null, redeOk: !!r.rede_ok, gpsOk: !!r.gps_ok,
    justificativa: r.justificativa || '', decididoPor: r.decidido_por || null, decididoEm: r.decidido_em || null, observacao: r.observacao || '', criadoEm: r.criado_em
  };
}
/* Configurações gerais (JSON por chave). */
function getSetting(chave, padrao) { const r = db.prepare('SELECT valor FROM settings WHERE chave = ?').get(chave); return r ? (parseJSON(r.valor) ?? padrao) : padrao; }
function setSetting(chave, valor) { db.prepare('INSERT INTO settings (chave, valor, atualizado_em) VALUES (?,?,?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em').run(chave, JSON.stringify(valor), nowISO()); }
function caseRow(r) {
  if (!r) return null;
  return {
    id: r.id, parceiroId: r.partner_id || null, titularidade: r.titularidade || (r.partner_id ? 'parceria' : 'escritorio'), valorAcao: r.valor_acao, valorCondenacao: r.valor_condenacao, pctHonorarios: r.pct_honorarios,
    baseHonorarios: r.base_honorarios || (r.partner_id ? 'fixo' : 'valor_causa'), valorDebito: r.valor_debito, valorDevido: r.valor_devido, valorReconhecido: r.valor_reconhecido, honorariosIniciais: r.honorarios_iniciais || 0,
    natureza: r.natureza || 'judicial', fase: r.fase || 'em_curso', resultado: r.resultado || (r.recebido ? 'recebido' : 'em_andamento'),
    numeroProcesso: r.numero_processo, cliente: r.cliente, tipoAcao: r.tipo_acao || '',
    dataProtocolo: r.data_protocolo, honorariosPretendidos: r.honorarios_pretendidos, custoLead: r.custo_lead,
    pctParceiro: r.pct_parceiro, pctNosso: r.pct_nosso, recebido: !!r.recebido, valorRecebido: r.valor_recebido, dataRecebimento: r.data_recebimento,
    dataEncerramento: r.data_encerramento || null, fluxoRecebimento: r.fluxo_recebimento || 'escritorio', financeiroStatus: r.financeiro_status || 'nao', financeiroEm: r.financeiro_em || null,
    temCorretor: !!r.tem_corretor, nomeCorretor: r.nome_corretor || '', valorCorretor: r.valor_corretor, corretorPago: !!r.corretor_pago,
    observacoes: r.observacoes || '', criadoPor: r.criado_por, atualizadoPor: r.atualizado_por, criadoEm: r.criado_em, atualizadoEm: r.atualizado_em
  };
}

function creditRow(r) {
  if (!r) return null;
  return {
    id: r.id, numeroProcesso: r.numero_processo, cedente: r.cedente || '', dataCompra: r.data_compra, dataPrevista: r.data_prevista || null,
    valorCompra: r.valor_compra, valorReceber: r.valor_receber, recebido: !!r.recebido, valorRecebido: r.valor_recebido, dataRecebimento: r.data_recebimento,
    financeiroCompra: r.financeiro_compra || 'nao', financeiroRecebimento: r.financeiro_recebimento || 'nao',
    observacoes: r.observacoes || '', criadoPor: r.criado_por, atualizadoPor: r.atualizado_por, criadoEm: r.criado_em, atualizadoEm: r.atualizado_em
  };
}

function financeRow(r) {
  if (!r) return null;
  return {
    id: r.id, tipo: r.tipo, categoria: r.categoria, descricao: r.descricao || '', valor: r.valor, data: r.data, caseId: r.case_id || null,
    contractId: r.contract_id || null, competencia: r.competencia || null, creditId: r.credit_id || null, associadoId: r.associado_id || null,
    status: r.status || 'realizado', vencimento: r.vencimento || null, parcela: r.parcela || null, grupoId: r.grupo_id || null,
    observacoes: r.observacoes || '', criadoPor: r.criado_por, atualizadoPor: r.atualizado_por, criadoEm: r.criado_em, atualizadoEm: r.atualizado_em
  };
}

function contractRow(r) {
  if (!r) return null;
  return {
    id: r.id, empresa: r.empresa, cnpj: r.cnpj || '', contato: r.contato || '', servico: r.servico || '', valorMensal: r.valor_mensal, diaVencimento: r.dia_vencimento || null,
    dataInicio: r.data_inicio, dataFim: r.data_fim || null, ativo: !!r.ativo, observacoes: r.observacoes || '', criadoEm: r.criado_em, atualizadoEm: r.atualizado_em
  };
}

module.exports = { db, DB_PATH, nowISO, uuid, audit, partnerRow, caseRow, creditRow, financeRow, contractRow, timeRow, getSetting, setSetting };
