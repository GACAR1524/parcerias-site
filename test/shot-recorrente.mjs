/* Captura: formulário de despesa recorrente e caixa de contas a pagar. Uso: node test/shot-recorrente.mjs */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parcerias-shot-'));
const PORT = 3996, BASE = `http://localhost:${PORT}`;
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
  await page.click('[data-tab="finance"]'); await page.waitForSelector('[data-act="new-recorrente"]');
  await page.click('[data-act="new-recorrente"]'); await page.waitForSelector('#fn-form');
  await page.fill('#fn-cat', 'Aluguel'); await page.fill('#fn-valor', '3500'); await page.fill('#fn-r1', '2026-01'); await page.fill('#fn-r2', '2026-12'); await page.fill('#fn-rd', '5'); await page.press('#fn-rd', 'Tab'); await page.waitForTimeout(150);
  await (await page.$('#sheet-b')).screenshot({ path: path.join(shots, 'recorrente-form.png') });
  await page.click('#fn-save'); await page.waitForFunction(() => document.querySelector('.provbox.pay'), null, { timeout: 8000 });
  await page.click('[data-act="new-recorrente"]'); await page.waitForSelector('#fn-form');
  await page.fill('#fn-cat', 'Internet'); await page.fill('#fn-valor', '250'); await page.fill('#fn-r1', '2026-03'); await page.fill('#fn-r2', '2027-02'); await page.fill('#fn-rd', '20'); await page.click('#fn-save');
  await page.waitForFunction(() => !document.querySelector('#fn-form'), null, { timeout: 8000 }); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, 'recorrente-financeiro.png'), fullPage: true });
  await page.click('[data-act="open-pay"]'); await page.waitForSelector('.prov-row'); await page.click('.prov-row input[data-py]'); await page.waitForTimeout(100);
  await (await page.$('#sheet-b')).screenshot({ path: path.join(shots, 'recorrente-contas-a-pagar.png') });
  console.log('Capturas em test/shots/recorrente-*.png');
} finally { await browser.close(); server.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
