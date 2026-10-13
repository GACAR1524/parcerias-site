/* Captura: janela de feriados e aviso na aba de controle de horário. Uso: node test/shot-feriados.mjs */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parcerias-shot-'));
const PORT = 3994, BASE = `http://localhost:${PORT}`;
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
  await page.click('[data-tab="partners"]'); await page.click('[data-act="new-estagiario"]'); await page.waitForSelector('#p-form');
  await page.fill('#p-nome', 'Pedro Lima'); await page.press('#p-nome', 'Tab'); await page.fill('#p-bolsa', '900'); await page.uncheck('#p-prov'); await page.click('#p-save'); await page.waitForSelector('#cred-ok'); await page.click('#cred-ok');
  await page.click('[data-tab="ponto"]'); await page.waitForSelector('[data-act="ponto-feriados"]');
  await page.click('[data-act="ponto-feriados"]'); await page.waitForSelector('#hd-form');
  await page.click('#hd-nac'); await page.waitForFunction(() => document.querySelectorAll('#hd-list .prov-row').length >= 13, null, { timeout: 8000 });
  await page.click('#hd-ma'); await page.waitForTimeout(400);
  await page.fill('#hd-de', '2026-12-22'); await page.fill('#hd-ate', '2027-01-06'); await page.fill('#hd-nome', 'Recesso de fim de ano'); await page.click('#hd-add'); await page.waitForTimeout(400);
  await (await page.$('#sheet-b')).screenshot({ path: path.join(shots, 'feriados-janela.png') });
  await page.click('#hd-ok'); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, 'feriados-aba.png') });
  console.log('Capturas em test/shots/feriados-*.png');
} finally { await browser.close(); server.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
