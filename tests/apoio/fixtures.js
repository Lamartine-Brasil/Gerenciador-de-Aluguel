'use strict';

/* Fixture comum dos testes.
 *
 *   test('...', async ({ app, servidor, page }) => { ... })
 *
 * - `servidor`: php -S isolado, já com os dados fictícios (use
 *   test.use({ dados: ... }) para outro conjunto; `null` = instalação vazia).
 * - `app`: ajudantes (entrar, ir para uma rota, esperar o sistema pronto...).
 * - O relógio do navegador fica em 17/09/2026 12:00, e window.print não faz
 *   nada (recibo e PDF abrem a janela de impressão sozinhos).
 */

const base = require('@playwright/test');
const { subirServidor } = require('./servidor');
const { gerarDados } = require('../fixtures/dados');

const AGORA = new Date('2026-09-17T12:00:00');

const test = base.test.extend({
  dados: [gerarDados(), { option: true }],
  subpasta: ['', { option: true }],

  servidor: async ({ dados, subpasta }, use) => {
    const srv = await subirServidor({ dados, subpasta });
    await use(srv);
    await srv.parar();
  },

  context: async ({ context }, use) => {
    await context.addInitScript(() => { window.print = () => {}; });
    await use(context);
  },

  page: async ({ page }, use) => {
    await page.clock.setFixedTime(AGORA);
    page.errosDoConsole = [];
    page.on('pageerror', (e) => page.errosDoConsole.push(e.message));
    await use(page);
  },

  app: async ({ page, servidor }, use) => {
    const app = {
      url: (rota = '') => servidor.url + rota,

      // Entra pela tela de login (como uma pessoa faria).
      async entrarPelaTela(rota = '', usuario = 'admin', senha = '12345678') {
        await page.goto(servidor.url + rota);
        await page.locator('#loginUser').fill(usuario);
        await page.locator('#loginPass').fill(senha);
        await page.locator('#loginForm button[type="submit"]').click();
        await app.pronto();
      },

      // Abre a sessão pela API (mais rápido) e vai para a rota.
      async entrar(rota = '') {
        const res = await page.request.post(servidor.url + 'api/login.php', {
          data: { username: 'admin', password: '12345678' },
        });
        base.expect(res.ok()).toBeTruthy();
        await page.goto(servidor.url + rota);
        await app.pronto();
      },

      async pronto() {
        await base.expect(page.locator('#app')).toBeVisible();
        await base.expect(page.locator('.tab-panel.active')).toBeVisible();
      },

      // Troca de rota como um link faria (mesmo documento).
      async ir(rota) {
        await page.evaluate((r) => { location.hash = r; }, rota);
        await base.expect(page.locator('.tab-panel.active')).toBeVisible();
      },

      async recarregar() {
        await page.reload();
        await app.pronto();
      },

      hash: () => page.evaluate(() => location.hash),

      // Descrição curta do elemento com foco, para as verificações de teclado.
      foco: () => page.evaluate(() => {
        const a = document.activeElement;
        if (!a || a === document.body) return 'body';
        return a.id ? '#' + a.id : (a.getAttribute('aria-label') || a.textContent.trim().slice(0, 40));
      }),

      dadosGravados: () => servidor.lerDados(),
    };
    await use(app);
  },
});

module.exports = { test, expect: base.expect, AGORA, gerarDados };
