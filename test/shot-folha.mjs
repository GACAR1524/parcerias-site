/* Captura: provisionamento de salário no cadastro do associado e folha em lote. Uso: node test/shot-folha.mjs */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parcerias-shot-'));
const PORT = 3995, BASE = `http://localhost:${PORT}`;
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
  // despesa global de salários em out/2026 (como o usuário fez)
  await page.click('[data-tab="finance"]'); await page.waitForSelector('[data-act="new-despesa"]');
  await page.click('[data-act="new-despesa"]'); await page.waitForSelector('#fn-form');
  await page.fill('#fn-cat', 'Advogados associados (salário)'); await page.fill('#fn-valor', '13500'); await page.fill('#fn-data', '2026-10-05'); await page.fill('#fn-desc', 'Salários dos associados (global)'); await page.click('#fn-save');
  await page.waitForFunction(() => !document.querySelector('#fn-form'), null, { timeout: 8000 });
  await page.click('[data-tab="partners"]'); await page.click('[data-act="new-associado"]'); await page.waitForSelector('#p-form');
  await page.fill('#p-nome', 'Carla Nunes'); await page.press('#p-nome', 'Tab'); await page.fill('#p-area', 'Trabalhista'); await page.fill('#p-sal', '4500'); await page.press('#p-sal', 'Tab'); await page.waitForTimeout(150);
  const fs1 = await page.$('#p-fin'); await fs1.scrollIntoViewIfNeeded(); await page.waitForTimeout(100);
  await fs1.screenshot({ path: path.join(shots, 'folha-cadastro.png') });
  await page.click('#p-save'); await page.waitForSelector('#cred-ok'); await page.click('#cred-ok');
  await page.click('[data-act="new-estagiario"]'); await page.waitForSelector('#p-form');
  await page.fill('#p-nome', 'Pedro Lima'); await page.press('#p-nome', 'Tab'); await page.fill('#p-bolsa', '900'); await page.uncheck('#p-prov'); await page.click('#p-save'); await page.waitForSelector('#cred-ok'); await page.click('#cred-ok');
  await page.waitForFunction(() => [...document.querySelectorAll('.pcard')].some(c => c.textContent.includes('Pedro Lima')), null, { timeout: 8000 });
  await page.screenshot({ path: path.join(shots, 'folha-cartoes.png') });
  await page.click('[data-act="payroll"]'); await page.waitForSelector('#pr-list .prov-row'); await page.waitForTimeout(100);
  await (await page.$('#sheet-b')).screenshot({ path: path.join(shots, 'folha-lote.png') });
  console.log('Capturas em test/shots/folha-*.png');
} finally { await browser.close(); server.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
