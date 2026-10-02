#!/usr/bin/env node
/*
 * Administração pela linha de comando (no servidor):
 *   npm run admin -- create <usuario>       cria um administrador
 *   npm run admin -- reset  <usuario>       redefine a senha de qualquer usuário (admin ou parceiro)
 *   npm run admin -- list                   lista usuários
 * A senha é pedida no terminal (ou lida da variável NOVA_SENHA, útil em automações).
 */
require('dotenv').config();
const readline = require('readline');
const { db, nowISO, uuid, audit } = require('../server/db');
const { hash } = require('../server/auth');
const { username, password } = require('../server/validate');

function ask(q, hidden) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const onData = c => { if (c.toString() !== '\n' && c.toString() !== '\r') readline.moveCursor(process.stdout, -1, 0); };
      rl.question(q, a => { rl.close(); resolve(a); });
      rl._writeToOutput = s => { if (s.includes(q)) process.stdout.write(q); else process.stdout.write('*'); };
      void onData;
    } else rl.question(q, a => { rl.close(); resolve(a); });
  });
}
async function getPassword() {
  if (process.env.NOVA_SENHA) return password(process.env.NOVA_SENHA, 8);
  const p1 = await ask('Nova senha (mínimo 8 caracteres): ', true); process.stdout.write('\n');
  const p2 = await ask('Confirme a senha: ', true); process.stdout.write('\n');
  if (p1 !== p2) { console.error('As senhas não conferem.'); process.exit(1); }
  return password(p1, 8);
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === 'list') {
      const rows = db.prepare(`SELECT u.usuario, u.role, u.ativo, p.nome FROM users u LEFT JOIN partners p ON p.id = u.partner_id ORDER BY u.role, u.usuario`).all();
      for (const r of rows) console.log(`${r.role.padEnd(8)} ${r.usuario.padEnd(24)} ${r.ativo ? 'ativo  ' : 'inativo'} ${r.nome || ''}`);
      if (!rows.length) console.log('Nenhum usuário cadastrado.');
    } else if (cmd === 'create') {
      const u = username(arg);
      if (db.prepare('SELECT 1 FROM users WHERE usuario = ?').get(u)) throw new Error('Já existe um usuário com este login.');
      const senha = await getPassword(); const now = nowISO(); const id = uuid();
      db.prepare('INSERT INTO users (id, usuario, senha_hash, role, ativo, criado_em, atualizado_em) VALUES (?,?,?,?,1,?,?)').run(id, u, await hash(senha), 'admin', now, now);
      audit({ acao: 'cli_create_admin', entidade: 'user', entidadeId: id, detalhes: { usuario: u } });
      console.log(`Administrador "${u}" criado.`);
    } else if (cmd === 'reset') {
      const u = username(arg);
      const row = db.prepare('SELECT id FROM users WHERE usuario = ?').get(u);
      if (!row) throw new Error('Usuário não encontrado.');
      const senha = await getPassword();
      db.prepare('UPDATE users SET senha_hash = ?, ativo = 1, atualizado_em = ? WHERE id = ?').run(await hash(senha), nowISO(), row.id);
      audit({ acao: 'cli_reset_password', entidade: 'user', entidadeId: row.id, detalhes: { usuario: u } });
      console.log(`Senha de "${u}" redefinida.`);
    } else {
      console.log('Uso: npm run admin -- create <usuario> | reset <usuario> | list');
      process.exit(1);
    }
  } catch (e) { console.error('Erro:', e.message); process.exit(1); }
})();
