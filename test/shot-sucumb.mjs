/* Captura de tela do formulário do processo com honorários sucumbenciais (parceria e escritório). Uso: node test/shot-sucumb.mjs */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parcerias-shot-'));
const PORT = 3997, BASE = `http://localhost:${PORT}`;
const env = { ...process.env, PORT: String(PORT), DB_PATH: path.join(tmp, 'shot.db'), JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres-ok', COOKIE_SECURE: 'false', TRUST_PROXY: '0' };
const server = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => server.stdout.on('data', d => { if (String(d).includes('rodando')) r(); }));
const shots = path.resolve('test/shots'); fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark', locale: 'pt-BR' });
  const page = await ctx.newPage();
  await page.goto(BASE); await page.waitForSelector('#setup-form');
  await page.fill('#st-user', 'admin'); await page.fill('#st-pass', 'senha-forte-123'); await page.fill('#st-pass2', 'senha-forte-123'); await page.click('#st-btn');
  await page.waitForSelector('#tabs');
  await page.click('[data-tab="partners"]'); await page.click('[data-act="new-partner"]');
  await page.fill('#p-nome', 'Mariana Lopes'); await page.fill('#p-esc', 'Lopes & Andrade Advogados'); await page.press('#p-nome', 'Tab'); await page.click('#p-save');
  await page.waitForSelector('#cred-ok'); await page.click('#cred-ok'); await page.waitForSelector('.pcard');
  // parceria: em curso, marcar recebido → pergunta da condenação desce para o recebimento
  await page.click('[data-tab="cases"]'); await page.click('[data-act="new-case"]');
  await page.selectOption('#c-partner', { index: 1 });
  await page.fill('#c-num', '08012345620268170001'); await page.fill('#c-cliente', 'João Pereira'); await page.fill('#c-tipo', 'Ação contra casa de apostas');
  await page.fill('#c-hon', '25000');
  await page.check('#c-res-rec'); await page.waitForSelector('#c-lancar');
  await page.fill('#c-vcond', '100000'); await page.press('#c-vcond', 'Tab'); await page.fill('#c-vsuc', '10000'); await page.press('#c-vsuc', 'Tab'); await page.waitForTimeout(150);
  const sheet = await page.$('#sheet-b');
  await sheet.screenshot({ path: path.join(shots, 'sucumb-parceria-recebido.png') });
  await page.click('#c-cancel');
  // escritório julgado
  await page.click('[data-act="new-case"]'); await page.check('#c-tit-esc');
  await page.fill('#c-num', '08000033320268170001'); await page.fill('#c-cliente', 'Cliente Direto'); await page.fill('#c-tipo', 'Ação indenizatória');
  await page.fill('#c-vacao', '80000'); await page.press('#c-vacao', 'Tab');
  await page.check('#c-fase-julg'); await page.fill('#c-vcond', '110000'); await page.press('#c-vcond', 'Tab'); await page.fill('#c-vsuc', '10000'); await page.press('#c-vsuc', 'Tab'); await page.waitForTimeout(150);
  await (await page.$('#sheet-b')).screenshot({ path: path.join(shots, 'sucumb-escritorio-julgado.png') });
  console.log('Capturas em test/shots/sucumb-*.png');
} finally { await browser.close(); server.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
