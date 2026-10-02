#!/usr/bin/env node
/*
 * Cópia de segurança consistente do banco (mesmo com o sistema no ar).
 *   npm run backup                → backups/parcerias-AAAA-MM-DD-HHMM.db
 *   npm run backup -- /outro/dir  → grava no diretório informado
 * Mantém os últimos 30 arquivos. Agende no cron, por exemplo, todo dia às 3h.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { db } = require('../server/db');

const dir = process.argv[2] || process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const dest = path.join(dir, `parcerias-${stamp}.db`);

db.backup(dest).then(() => {
  const files = fs.readdirSync(dir).filter(f => /^parcerias-.*\.db$/.test(f)).sort();
  while (files.length > 30) fs.unlinkSync(path.join(dir, files.shift()));
  console.log('Backup gravado em', dest);
  process.exit(0);
}).catch(e => { console.error('Falha no backup:', e.message); process.exit(1); });
