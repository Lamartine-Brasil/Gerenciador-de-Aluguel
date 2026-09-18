'use strict';

const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect } = require('../apoio/fixtures');

const ROTAS = ['#/', '#/imoveis', '#/contratos', '#/atrasos', '#/historico', '#/despesas', '#/graficos',
  '#/relatorios', '#/calendario', '#/auditoria', '#/usuarios', '#/configuracoes/financeiro',
  '#/configuracoes/carteiras', '#/configuracoes/recibo', '#/configuracoes/dados', '#/configuracoes/perigo',
  '#/nao-existe'];

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

function resumo(violacoes) {
  return violacoes.map(v => `${v.impact} ${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
}

for (const tema of ['dark', 'light']) {
  test.describe(`axe, tema ${tema === 'dark' ? 'escuro' : 'claro'}`, () => {
    // sem animação: o axe mede o contraste no meio de um fade-in e erra
    test.use({ colorScheme: tema, reducedMotion: 'reduce' });

    test('tela de login', async ({ page, servidor }) => {
      await page.goto(servidor.url);
      await expect(page.locator('#loginScreen')).toBeVisible();
      const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(resumo(r.violations.filter(v => ['serious', 'critical'].includes(v.impact)))).toEqual([]);
      expect(resumo(r.violations)).toEqual([]);
    });

    test('todas as telas', async ({ page, app }) => {
      test.slow();
      await app.entrar('#/');
      for (const rota of ROTAS) {
        await app.ir(rota);
        await page.waitForTimeout(150);
        const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        expect(resumo(r.violations.filter(v => ['serious', 'critical'].includes(v.impact))), rota).toEqual([]);
        expect(resumo(r.violations), rota).toEqual([]);
      }
    });

    test('modais abertos', async ({ page, app }) => {
      await app.entrar('#/contratos');
      for (const abrir of ['#btnNovoContrato', '#contratosList [data-grupo-action="editar"] >> nth=0',
        '#contratosList [data-grupo-action="historico"] >> nth=0']) {
        await page.locator(abrir).click();
        const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        expect(resumo(r.violations.filter(v => ['serious', 'critical'].includes(v.impact))), abrir).toEqual([]);
        await page.keyboard.press('Escape');
      }
    });
  });
}

test.describe('Área clicável e telas estreitas', () => {
  test('botões e links do conteúdo têm pelo menos 24×24 px', async ({ page, app }) => {
    await app.entrar('#/');
    for (const rota of ['#/', '#/contratos', '#/atrasos', '#/historico', '#/despesas', '#/calendario', '#/usuarios']) {
      await app.ir(rota);
      const pequenos = await page.evaluate(() => Array.from(document.querySelectorAll('#app button, #app a[href], #app select, #app input'))
        .filter(el => el.getClientRects().length && !el.closest('.sr-only'))
        // link dentro de um texto corrido é exceção prevista na WCAG 2.5.8
        .filter(el => !(el.tagName === 'A' && getComputedStyle(el).display === 'inline'))
        .map(el => { const r = el.getBoundingClientRect(); return { el: el.id || el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30), w: r.width, h: r.height }; })
        .filter(x => x.w < 24 || x.h < 24));
      expect(pequenos, rota).toEqual([]);
    }
  });

  for (const tamanho of [{ width: 320, height: 640 }, { width: 640, height: 400 }]) {
    test(`${tamanho.width}×${tamanho.height} (celular pequeno / zoom de 200%): nada vaza da tela`, async ({ page, app }) => {
      await page.setViewportSize(tamanho);
      await app.entrar('#/');
      for (const rota of ROTAS) {
        await app.ir(rota);
        const vaza = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(vaza, rota).toBeLessThanOrEqual(0);
      }
    });
  }
});

test.describe('Valores digitados', () => {
  test('lerNumero aceita os jeitos de escrever que aparecem na prática', async ({ page, app }) => {
    await app.entrar('#/');
    const r = await page.evaluate(() => Object.fromEntries(
      ['1.250,50', '1250,50', '1250.50', '1.250', '12.500', '1.250.000,00', 'R$ 99,9', '0,5', '', 'abc', '1,250,50', '1250.500']
        .map(t => [t, lerNumero(t)])));
    expect(r['1.250,50']).toBe(1250.5);
    expect(r['1250,50']).toBe(1250.5);
    expect(r['1250.50']).toBe(1250.5);
    expect(r['1.250']).toBe(1250);
    expect(r['12.500']).toBe(12500);
    expect(r['1.250.000,00']).toBe(1250000);
    expect(r['R$ 99,9']).toBe(99.9);
    expect(r['0,5']).toBe(0.5);
    expect(r['']).toBe(null);
    expect(r['abc']).toBeNaN();
    expect(r['1,250,50']).toBeNaN();
    expect(r['1250.500']).toBeNaN();
  });

  for (const digitado of ['1.250,50', '1250,50', '1250.50']) {
    test(`"${digitado}" numa despesa é gravado como 1250,50`, async ({ page, app, servidor }) => {
      await app.entrar('#/despesas');
      await page.locator('#despDescricao').fill('Teste de valor');
      await page.locator('#despValor').pressSequentially(digitado);
      await page.keyboard.press('Enter');
      await expect(page.locator('#toast')).toContainText('Despesa adicionada');
      expect(servidor.lerDados().despesas.find(d => d.descricao === 'Teste de valor').valor).toBe(1250.5);
    });
  }

  test('valor inválido: erro ao lado do campo, ligado por aria-describedby, e nada é gravado', async ({ page, app, servidor }) => {
    await app.entrar('#/despesas');
    await page.locator('#despDescricao').fill('Inválida');
    await page.locator('#despValor').fill('abc');
    await page.keyboard.press('Enter');
    await expect(page.locator('#despValor-erro')).toHaveText('Digite um valor em reais, como 1.250,50.');
    await expect(page.locator('#despValor')).toBeFocused();
    await expect(page.locator('#despValor')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#despValor')).toHaveAttribute('aria-describedby', /despValor-erro/);
    expect(servidor.lerDados().despesas.some(d => d.descricao === 'Inválida')).toBe(false);
    await page.locator('#despValor').fill('10');
    await expect(page.locator('#despValor-erro')).toHaveCount(0);
  });
});
