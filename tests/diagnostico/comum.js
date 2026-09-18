const T = require('path').resolve(__dirname, '..');
const { chromium, firefox } = require(T + '/node_modules/@playwright/test');
const { subirServidor } = require(T + '/apoio/servidor.js');
const { gerarDados } = require(T + '/fixtures/dados.js');
const OUT = __dirname + '/out';
require('fs').mkdirSync(OUT, { recursive: true });
async function novaPagina(browser, srv, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1366, height: 900 }, colorScheme: opts.tema || 'dark', ...opts.ctx });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date('2026-09-17T12:00:00'));
  page.erros = [];
  page.on('console', m => { if (m.type() === 'error') page.erros.push(m.text()); });
  page.on('pageerror', e => page.erros.push('PAGEERROR ' + e.message));
  return { ctx, page };
}
async function entrar(page, url, u = 'admin', s = '12345678') {
  await page.goto(url);
  await page.fill('#loginUser', u);
  await page.fill('#loginPass', s);
  await page.click('#loginForm button[type=submit]');
  await page.waitForSelector('#app:not(.hidden)');
  await page.waitForTimeout(400);
}
module.exports = { chromium, firefox, subirServidor, gerarDados, novaPagina, entrar, OUT };
