'use strict';

const { test, expect } = require('../apoio/fixtures');

// Cada rota: a tela que deve aparecer, o título da aba, e o que conferir para
// saber que os parâmetros do endereço foram aplicados.
const ROTAS = [
  { rota: '#/', painel: 'dashboard', titulo: 'Dashboard' },
  { rota: '#/imoveis?busca=vaga&pagina=2', painel: 'imoveis', titulo: 'Imóveis',
    conferir: async (page) => {
      await expect(page.locator('#uiImoveisSearch')).toHaveValue('vaga');
      await expect(page.locator('#uiImoveisPagination .pagination-info')).toContainText('Página 2 de 2');
    } },
  { rota: '#/contratos?busca=%23&status=atrasado&pagina=2', painel: 'contratos', titulo: 'Contratos',
    conferir: async (page) => {
      await expect(page.locator('#searchContratos')).toHaveValue('#');
      await expect(page.locator('#filterStatus')).toHaveValue('atrasado');
    } },
  { rota: '#/contratos?pagina=2', painel: 'contratos', titulo: 'Contratos',
    conferir: async (page) => {
      await expect(page.locator('#contratosPagination .pagination-info')).toContainText('Página 2 de 2');
    } },
  { rota: '#/atrasos', painel: 'atrasos', titulo: 'Atrasos' },
  { rota: '#/historico?contrato=5&pagina=2', painel: 'historico', titulo: 'Histórico',
    conferir: async (page) => {
      await expect(page.locator('#historicoFiltroContrato option:checked')).toContainText('Ricardo Mendes');
      await expect(page.locator('#historicoPagination .pagination-info')).toContainText('Página 2 de 3');
    } },
  { rota: '#/despesas?ano=2025&mes=4', painel: 'despesas', titulo: 'Despesas',
    conferir: async (page) => {
      await expect(page.locator('#despesaFiltroAno')).toHaveValue('2025');
      await expect(page.locator('#despesaFiltroMes')).toHaveValue('3');
    } },
  { rota: '#/graficos?ano=2025&agrupar=imovel', painel: 'graficos', titulo: 'Gráficos',
    conferir: async (page) => {
      await expect(page.locator('#graficoAno')).toHaveValue('2025');
      await expect(page.locator('#inadimplenciaAgrupador')).toHaveValue('imovel');
    } },
  { rota: '#/relatorios?ano=2025&mes=7', painel: 'relatorios', titulo: 'Relatórios',
    conferir: async (page) => {
      await expect(page.locator('#relatorioMes')).toHaveValue('6');
      await expect(page.locator('#tab-relatorios [data-periodo]').first()).toHaveText('em Julho');
    } },
  { rota: '#/calendario?mes=2026-08&dia=2026-08-10', painel: 'calendario', titulo: 'Calendário',
    conferir: async (page) => {
      await expect(page.locator('#calendarioMesAno')).toHaveText('Agosto 2026');
      await expect(page.locator('#calendarioDetalheTitulo')).toContainText('10-08-2026');
    } },
  { rota: '#/auditoria?usuario=gerente', painel: 'auditoria', titulo: 'Auditoria',
    conferir: async (page) => {
      await expect(page.locator('#auditoriaList .card')).toHaveCount(1);
    } },
  { rota: '#/usuarios', painel: 'usuarios', titulo: 'Usuários' },
  { rota: '#/configuracoes', painel: 'config', titulo: 'Financeiro · Configurações',
    conferir: async (page) => {
      await expect(page.locator('[data-config-section="financeiro"]')).toBeVisible();
    } },
  ...['carteiras', 'recibo', 'dados', 'perigo'].map(sub => ({
    rota: `#/configuracoes/${sub}`, painel: 'config',
    titulo: { carteiras: 'Carteiras', recibo: 'Recibo', dados: 'Dados', perigo: 'Zona de perigo' }[sub] + ' · Configurações',
    conferir: async (page) => {
      await expect(page.locator(`[data-config-section="${sub}"]`)).toBeVisible();
      await expect(page.locator(`[data-config-tab="${sub}"]`)).toHaveAttribute('aria-current', 'page');
    },
  })),
];

test.describe('Cada tela com endereço próprio', () => {
  for (const r of ROTAS) {
    test(`${r.rota} abre direto e continua igual depois do F5`, async ({ page, app }) => {
      await app.entrar(r.rota);
      const conferir = async () => {
        await expect(page.locator(`#tab-${r.painel}`)).toBeVisible();
        await expect(page.locator('.tab-panel.active h1')).toHaveCount(1);
        await expect(page).toHaveTitle(`${r.titulo} — Gestão de Aluguéis`);
        if (r.conferir) await r.conferir(page);
      };
      await conferir();
      const endereco = await app.hash();
      await app.recarregar();
      await conferir();
      expect(await app.hash()).toBe(endereco);
    });
  }

  test('o item do menu da tela atual tem aria-current e os itens são links de verdade', async ({ page, app }) => {
    await app.entrar('#/historico');
    const atual = page.locator('#tabsNav a[aria-current="page"]');
    await expect(atual).toHaveCount(1);
    await expect(atual).toHaveAttribute('href', '#/historico');
    const hrefs = await page.locator('#tabsNav a.tab-btn').evaluateAll(as => as.map(a => a.getAttribute('href')));
    expect(hrefs).toEqual(['#/', '#/imoveis', '#/contratos', '#/atrasos', '#/historico', '#/despesas',
      '#/graficos', '#/relatorios', '#/calendario', '#/auditoria', '#/usuarios', '#/configuracoes']);
  });

  test('parâmetro inválido é ignorado e some do endereço', async ({ page, app }) => {
    await app.entrar('#/contratos?status=xyz&pagina=-3&foo=1');
    await expect(page.locator('#filterStatus')).toHaveValue('');
    expect(await app.hash()).toBe('#/contratos');
    await app.ir('#/calendario?mes=2026-13&dia=abc');
    expect(await app.hash()).toBe('#/calendario');
  });

  test('endereço desconhecido mostra "Página não encontrada" com link para o Dashboard', async ({ page, app }) => {
    await app.entrar('#/nao-existe');
    await expect(page.getByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeVisible();
    await page.getByRole('link', { name: 'Ir para o Dashboard' }).click();
    await expect(page.locator('#tab-dashboard')).toBeVisible();
    expect(await app.hash()).toBe('#/');
  });

  test('trocar de tela empilha histórico; filtro só substitui; Voltar e Avançar funcionam', async ({ page, app }) => {
    await app.entrar('#/');
    await page.locator('#tabsNav a[href="#/contratos"]').click();
    await page.locator('#filterStatus').selectOption('pago');
    await page.locator('#searchContratos').fill('vaga');
    await page.locator('#tabsNav a[href="#/despesas"]').click();
    await expect(page.locator('#tab-despesas')).toBeVisible();

    await page.goBack();
    await expect(page.locator('#tab-contratos')).toBeVisible();
    expect(await app.hash()).toBe('#/contratos?busca=vaga&status=pago');
    await expect(page.locator('#filterStatus')).toHaveValue('pago');

    await page.goBack();
    await expect(page.locator('#tab-dashboard')).toBeVisible();
    await page.goForward();
    await expect(page.locator('#tab-contratos')).toBeVisible();
    await expect(page.locator('#searchContratos')).toHaveValue('vaga');
  });

  test('ao trocar de tela o foco vai para o título e a página volta ao topo', async ({ page, app }) => {
    await app.entrar('#/contratos');
    await page.mouse.wheel(0, 2000);
    await page.locator('#tabsNav a[href="#/historico"]').click();
    await expect(page.locator('#tab-historico h1')).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('no primeiro carregamento o foco não é mexido', async ({ page, app }) => {
    await app.entrar('#/contratos');
    expect(await app.foco()).toBe('body');
  });

  test('link direto sem estar logado leva ao login e, depois de entrar, à tela pedida', async ({ page, app }) => {
    await app.entrarPelaTela('#/relatorios?ano=2025&mes=7');
    await expect(page.locator('#tab-relatorios')).toBeVisible();
    await expect(page.locator('#relatorioAno')).toHaveValue('2025');
    expect(await app.hash()).toBe('#/relatorios?ano=2025&mes=7');
  });

  test('a busca do topo leva a Contratos sem empilhar histórico e sem tirar o cursor do campo', async ({ page, app }) => {
    await app.entrar('#/atrasos');
    const antes = await page.evaluate(() => history.length);
    await page.locator('#globalSearch').pressSequentially('Maria');
    await expect(page.locator('#tab-contratos')).toBeVisible();
    expect(await app.hash()).toBe('#/contratos?busca=Maria');
    expect(await page.evaluate(() => history.length)).toBe(antes);
    await expect(page.locator('#globalSearch')).toBeFocused();
  });

  test('Voltar com um modal aberto fecha o modal e fica na mesma tela', async ({ page, app }) => {
    await app.entrar('#/');
    await page.locator('#tabsNav a[href="#/contratos"]').click();
    await page.locator('#btnNovoContrato').click();
    await expect(page.locator('#modalContrato')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#modalContrato')).toBeHidden();
    await expect(page.locator('#tab-contratos')).toBeVisible();
  });

  test('trocar de tela com formulário alterado pergunta antes', async ({ page, app }) => {
    await app.entrar('#/despesas');
    await page.locator('#despDescricao').fill('rascunho');
    await page.locator('#tabsNav a[href="#/imoveis"]').click();
    await expect(page.locator('#modalConfirmacao')).toBeVisible();
    await page.getByRole('button', { name: 'Continuar editando' }).click();
    await expect(page.locator('#tab-despesas')).toBeVisible();
    await expect(page.locator('#despDescricao')).toHaveValue('rascunho');

    await page.locator('#tabsNav a[href="#/imoveis"]').click();
    await page.getByRole('button', { name: 'Sair sem salvar' }).click();
    await expect(page.locator('#tab-imoveis')).toBeVisible();
  });

  test('recarregar com formulário alterado pede confirmação (beforeunload)', async ({ page, app }) => {
    await app.entrar('#/despesas');
    await page.locator('#despDescricao').fill('rascunho');
    let perguntou = false;
    page.once('dialog', async (d) => { perguntou = d.type() === 'beforeunload'; await d.dismiss(); });
    // a navegação é cancelada no diálogo, então o reload não termina: tempo curto
    await page.reload({ timeout: 2000 }).catch(() => {});
    expect(perguntou).toBeTruthy();
    await expect(page.locator('#despDescricao')).toHaveValue('rascunho');
  });

  test('sair limpa a memória e volta ao login', async ({ page, app }) => {
    await app.entrar('#/usuarios');
    await page.locator('#uiUserButton').click();
    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page.locator('#loginScreen')).toBeVisible();
    expect(await app.hash()).toBe('#/');
    expect(await page.evaluate(() => state.contratos.length)).toBe(0);
  });
});
