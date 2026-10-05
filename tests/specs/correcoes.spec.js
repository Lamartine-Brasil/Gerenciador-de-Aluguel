'use strict';

/* Testes das correções da revisão de segurança e de funcionamento
 * (outubro/2026): escape de HTML, normalização dos dados, CSRF, cookie preso à
 * senha, nomes de usuário, vencimentos nos dias 29-31, juros/multa, busca "#N",
 * CSV (fórmulas, importação) e auditoria gravada pelo servidor.
 */

const { test, expect } = require('../apoio/fixtures');

function divida(vencimento, aluguel, extra = {}) {
  const d = {
    id: 'd_' + vencimento.replace(/-/g, ''), vencimento, aluguel, desconto: 0, juros: 0, multa: 0,
    condominio: 0, condominioDireto: false, valorAtrasoBase: 0, observacao: '', pago: false,
    dataPagamento: null, pagamentos: [], criadoEm: 1, ...extra,
  };
  d.total = d.aluguel - d.desconto + d.juros + d.multa + (d.condominioDireto ? 0 : d.condominio);
  return d;
}

function contrato(numero, extra = {}) {
  return {
    id: 'c_teste_' + numero, numero, imovel: `Imóvel ${numero}`, carteiraId: '', inquilino: `Inquilino ${numero}`,
    quemRecebeu: '', dataInicio: '2025-12-15', diaPagamento: 10, aluguel: 1000, desconto: 0, juros: 0, multa: 0,
    condominio: 0, condominioDireto: false, anexoContrato: null, corretorNome: '', corretorPercentual: 0,
    caucao: 0, dataUltimoReajuste: '2025-12-15', caucaoDevolvida: false, dataCaucaoDevolvida: null,
    valorCaucaoDevolvida: null, encerrado: false, dataEncerramento: null, criadoEm: numero, dividas: [],
    ...extra,
  };
}

function base(contratos, extra = {}) {
  return {
    contratos, config: { taxaJurosMensal: 1, taxaMultaPercent: 2 }, auditoria: [], pessoas: [],
    despesas: [], imoveis: [], carteiras: [], versao: 1, ...extra,
  };
}

async function postJson(request, url, corpo, headers = {}) {
  return request.post(url, { headers: { 'Content-Type': 'application/json', ...headers }, data: JSON.stringify(corpo) });
}

test.describe('Segurança', () => {
  test.describe('textos e dados maliciosos não viram código', () => {
    const payload = 'Casa" style="animation:spin 1s" onanimationstart="window.__xss=1';
    test.use({
      dados: base([
        contrato(1, {
          imovel: payload, inquilino: '<img src=x onerror="window.__xss=2">',
          dividas: [divida('2026-08-10', 1000, { observacao: payload })],
        }),
        contrato('2<img src=x onerror="window.__xss=3">', {
          id: 'x"><img src=x onerror="window.__xss=4">',
          caucao: '<img src=x onerror="window.__xss=5">',
          dividas: [divida('2026-09-10', '<img src=x onerror="window.__xss=6">')],
        }),
      ], {
        pessoas: [{ id: 'p1', nome: payload, carteiraId: '' }],
        despesas: [{ id: 'e1', data: '2026-09-01', descricao: payload, valor: '<img src=x onerror="window.__xss=7">', contratoId: '', carteiraId: '' }],
      }),
    });

    test('nenhuma tela executa o que foi gravado', async ({ page, app }) => {
      await app.entrar('#/');
      for (const rota of ['#/', '#/contratos', '#/atrasos', '#/calendario', '#/historico', '#/despesas', '#/relatorios', '#/usuarios', '#/graficos']) {
        await app.ir(rota);
        await page.waitForTimeout(300);
      }
      expect(await page.evaluate(() => window.__xss)).toBeUndefined();
      expect(page.errosDoConsole).toEqual([]);
    });

    test('ids e números voltam ao tipo certo ao carregar', async ({ page, app }) => {
      await app.entrar('#/contratos');
      const c = await page.evaluate(() => state.contratos.map(x => ({ id: x.id, numero: x.numero, caucao: x.caucao, aluguel: x.dividas[0].aluguel })));
      for (const x of c) {
        expect(x.id).toMatch(/^[\w-]+$/);
        expect(typeof x.numero).toBe('number');
        expect(typeof x.caucao).toBe('number');
        expect(typeof x.aluguel).toBe('number');
      }
    });
  });

  test('escapeHtml escapa aspas e mostra o zero', async ({ page, app }) => {
    await app.entrar('#/');
    expect(await page.evaluate(() => escapeHtml(`a"b'c<d>&`))).toBe('a&quot;b&#39;c&lt;d&gt;&amp;');
    expect(await page.evaluate(() => escapeHtml(0))).toBe('0');
  });

  test('"__proto__" como forma de pagamento não polui os objetos', async ({ page, app }) => {
    await app.entrar('#/');
    await page.evaluate(() => {
      state.contratos[0].dividas[0].pagamentos.push({ data: '2026-09-01', valor: 1, forma: '__proto__', quemRecebeu: 'x' });
    });
    await app.ir('#/relatorios');
    await app.ir('#/graficos');
    expect(await page.evaluate(() => ({}).count)).toBeUndefined();
  });

  test('CSV exportado neutraliza fórmulas e mantém números negativos', async ({ page, app }) => {
    await app.entrar('#/');
    const r = await page.evaluate(() => [
      celulaCsvSegura('=HYPERLINK("x")'), celulaCsvSegura('+1'), celulaCsvSegura('@SUM(A1)'),
      celulaCsvSegura('-12,50'), celulaCsvSegura('-cmd'), celulaCsvSegura(-5), celulaCsvSegura('Ana'),
    ]);
    expect(r).toEqual(["'=HYPERLINK(\"x\")", "'+1", "'@SUM(A1)", '-12,50', "'-cmd", '-5', 'Ana']);
  });

  test('gravação vinda de outro site (formulário text/plain) é recusada', async ({ page, app, servidor }) => {
    await app.entrar('#/');
    const corpo = JSON.stringify({ baseVersao: 1, dados: { contratos: [], config: {} } });
    const r1 = await page.request.post(servidor.url + 'api/data.php', { headers: { 'Content-Type': 'text/plain' }, data: corpo });
    expect(r1.status()).toBe(403);
    const r2 = await page.request.post(servidor.url + 'api/data.php', {
      headers: { 'Content-Type': 'application/json', Origin: 'https://site-malicioso.example' }, data: corpo,
    });
    expect(r2.status()).toBe(403);
    expect(servidor.lerDados().contratos.length).toBeGreaterThan(0);
    // sair só por POST: um link ou imagem de outro site não desconecta ninguém
    const r3 = await page.request.get(servidor.url + 'api/logout.php');
    expect(r3.status()).toBe(405);
  });

  test('trocar a senha derruba os outros acessos do mesmo usuário', async ({ playwright, servidor }) => {
    const a = await playwright.request.newContext();
    const b = await playwright.request.newContext();
    try {
      const login = { username: 'admin', password: '12345678' };
      expect((await postJson(a, servidor.url + 'api/login.php', login)).ok()).toBeTruthy();
      expect((await postJson(b, servidor.url + 'api/login.php', login)).ok()).toBeTruthy();
      const r = await postJson(a, servidor.url + 'api/account.php', { currentPassword: '12345678', newUsername: 'admin', newPassword: 'outraSenha123' });
      expect(r.ok()).toBeTruthy();
      expect((await r.json()).senhaPadrao).toBe(false);
      expect((await (await a.get(servidor.url + 'api/session.php')).json()).authenticated).toBe(true);
      expect((await (await b.get(servidor.url + 'api/session.php')).json()).authenticated).toBe(false);
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });

  test('nome de usuário com "|" ou longo demais é recusado', async ({ page, app, servidor }) => {
    await app.entrar('#/');
    for (const username of ['ana|x', 'linha\nquebrada', 'x'.repeat(61)]) {
      const r = await postJson(page.request, servidor.url + 'api/users.php', { action: 'add', currentPassword: '12345678', username, password: 'senha12345' });
      expect(r.status()).toBe(400);
    }
  });

  test('a senha padrão mostra o aviso para trocar', async ({ page, app }) => {
    await app.entrar('#/');
    await expect(page.locator('#avisoSenhaPadrao')).toBeVisible();
    await page.locator('#avisoSenhaPadrao a').click();
    await expect(page.locator('#tab-usuarios')).toBeVisible();
  });

  test('a auditoria é decidida pelo servidor: não dá para apagar nem forjar o usuário', async ({ page, app, servidor }) => {
    await app.entrar('#/');
    // sai da página para nenhuma gravação automática dela correr junto com esta
    await page.waitForTimeout(500);
    await page.goto('about:blank');
    const antes = servidor.lerDados();
    const atual = (antes.auditoria || []).length;
    const dados = { ...antes, auditoria: [{ id: 'forjado1', timestamp: 1, usuario: 'outra-pessoa', acao: 'x', descricao: 'forjado', alteracoes: [] }] };
    delete dados.versao;
    const r = await postJson(page.request, servidor.url + 'api/data.php', { baseVersao: antes.versao || 0, dados });
    expect(r.ok(), await r.text()).toBeTruthy();
    const depois = servidor.lerDados().auditoria;
    expect(depois.length).toBe(Math.min(atual + 1, 300));
    const novo = depois[depois.length - 1];
    expect(novo.id).toBe('forjado1');
    expect(novo.usuario).toBe('admin');
    expect(novo.timestamp).toBeGreaterThan(1);
  });
});

test.describe('Contas e fluxos', () => {
  test.describe('vencimento no dia 31', () => {
    test.use({
      dados: base([contrato(1, {
        dataInicio: '2025-12-20', diaPagamento: 31, dataUltimoReajuste: '2025-12-20',
        dividas: [divida('2026-01-31', 1000), divida('2026-02-28', 1000)],
      })]),
    });

    test('depois de fevereiro volta para o dia 31 (ou o último dia do mês)', async ({ app }) => {
      await app.entrar('#/contratos');
      await expect.poll(() => app.dadosGravados().contratos[0].dividas.length).toBe(8);
      const vencs = app.dadosGravados().contratos[0].dividas.map(d => d.vencimento);
      expect(vencs).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31']);
    });
  });

  test.describe('juros e multa', () => {
    test.use({ dados: base([contrato(1, { dividas: [divida('2026-08-18', 1000, { juros: 10, multa: 20 })] })]) });

    test('o atraso é calculado sobre o aluguel, sem multa sobre multa', async ({ page, app }) => {
      await app.entrar('#/atrasos');
      // 30 dias de atraso (18/08 → 17/09): base 1.000 → juros 1% = 10, multa 2% = 20
      const atraso = await page.evaluate(() => calcAtrasoAtual(state.contratos[0].dividas[0]));
      expect(atraso).toBeCloseTo(30, 2);
    });

    test('contrato novo começa sem juros e multa fixos', async ({ page, app }) => {
      await app.entrar('#/contratos');
      await page.locator('#btnNovoContrato').click();
      await expect(page.locator('#fJurosPercentual')).toHaveValue('');
      await expect(page.locator('#fMultaPercentual')).toHaveValue('');
    });
  });

  test.describe('busca por número', () => {
    test.use({ dados: base(Array.from({ length: 12 }, (_, i) => contrato(i + 1, { dividas: [divida('2026-09-10', 1000)] }))) });

    test('"#1" encontra só o contrato nº 1', async ({ page, app }) => {
      await app.entrar('#/contratos?busca=%231');
      await expect(page.locator('#contratosList [data-grupo-action="editar"]')).toHaveCount(1);
    });
  });

  test.describe('reabrir e excluir', () => {
    test.use({
      dados: base([contrato(1, {
        encerrado: true, dataEncerramento: '2026-06-15',
        dividas: [divida('2026-05-10', 1000), divida('2026-06-10', 1000)],
      })]),
    });

    test('reabrir não cobra o período em que o contrato ficou encerrado', async ({ page, app }) => {
      await app.entrar('#/contratos');
      await page.evaluate(() => reabrirContrato(state.contratos[0].id));
      await expect.poll(() => app.dadosGravados().contratos[0].encerrado).toBe(false);
      await page.evaluate(() => { gerarDividasDeTodos(); return saveState(); });
      const vencs = app.dadosGravados().contratos[0].dividas.map(d => d.vencimento);
      // reaberto em 17/09 com dia 10: a próxima dívida é a de 10/10, nada de julho a setembro
      expect(vencs).toEqual(['2026-05-10', '2026-06-10']);
    });
  });

  test('CSV exportado e importado de volta remonta o contrato com as dívidas pagas', async ({ page, app }) => {
    await app.entrar('#/contratos?busca=%231');
    const original = await page.evaluate(() => {
      const c = state.contratos.find(x => x.numero === 1);
      return { imovel: c.imovel, dividas: c.dividas.length, pagas: c.dividas.filter(d => d.pago).length };
    });
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btnExportCSV').click()]);
    const conteudo = require('fs').readFileSync(await download.path());
    await page.evaluate(async () => {
      state.contratos = state.contratos.filter(x => x.numero !== 1);
      await saveState();
    });
    await page.locator('#inputImportCSV').setInputFiles({ name: 'contratos.csv', mimeType: 'text/csv', buffer: conteudo });
    await expect(page.locator('#toast')).toContainText('1 contrato(s) importado(s)');
    const importado = await page.evaluate((imovel) => {
      const lista = state.contratos.filter(x => x.imovel === imovel);
      return { qtd: lista.length, dividas: lista[0].dividas.length, pagas: lista[0].dividas.filter(d => d.pago).length };
    }, original.imovel);
    expect(importado).toEqual({ qtd: 1, dividas: original.dividas, pagas: original.pagas });
  });

  test('lerNumero entende "0.125" como decimal', async ({ page, app }) => {
    await app.entrar('#/');
    expect(await page.evaluate(() => [lerNumero('0.125'), lerNumero('1.250'), lerNumero('1.250,50')])).toEqual([0.125, 1250, 1250.5]);
  });

  test('CSV com observação de várias linhas e valores brasileiros é lido inteiro', async ({ page, app }) => {
    await app.entrar('#/');
    const linhas = await page.evaluate(() => parseCsv('"a";"b"\r\n"1";"linha1\nlinha2"\r\n"2";"1.250,50"\r\n'));
    expect(linhas).toEqual([['a', 'b'], ['1', 'linha1\nlinha2'], ['2', '1.250,50']]);
    expect(await page.evaluate(() => numeroDoCsv('1.250,50'))).toBe(1250.5);
  });
});
