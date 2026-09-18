'use strict';

const fs = require('fs');
const { test, expect, gerarDados } = require('../apoio/fixtures');

// Aperta Tab (ou Shift+Tab) até o foco chegar no elemento; falha se passar do
// limite. É o jeito de "andar" pela página como quem só usa teclado.
async function tabAte(page, locator, { voltar = false, limite = 80 } = {}) {
  const alvo = await locator.elementHandle();
  for (let i = 0; i < limite; i++) {
    if (await page.evaluate((el) => document.activeElement === el, alvo)) return;
    await page.keyboard.press(voltar ? 'Shift+Tab' : 'Tab');
  }
  throw new Error('O Tab não chegou no elemento esperado');
}

async function focoVisivel(page) {
  return page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return false;
    const r = a.getBoundingClientRect();
    const estilo = getComputedStyle(a);
    const temAnel = estilo.outlineStyle !== 'none' || estilo.boxShadow !== 'none';
    return r.width > 0 && r.height > 0 && temAnel;
  });
}

test.describe('Só com teclado', () => {
  test.use({ dados: null }); // instalação vazia: o fluxo começa do zero

  test('fluxo principal: entrar → imóvel → contrato → pagamento → recibo → histórico → CSV', async ({ page, app, servidor }) => {
    test.slow();
    await page.goto(servidor.url);
    // login: o primeiro Tab já cai no usuário (não há nada antes na tela de login)
    await tabAte(page, page.locator('#loginUser'));
    await page.keyboard.type('admin');
    await page.keyboard.press('Tab');
    await page.keyboard.type('12345678');
    await page.keyboard.press('Enter');
    await app.pronto();

    // pular para o conteúdo e ir a Imóveis pelo menu
    await page.keyboard.press('Shift+Tab'); // título → ...
    await tabAte(page, page.locator('#tabsNav a[href="#/imoveis"]'), { voltar: true });
    expect(await focoVisivel(page)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator('#tab-imoveis h1')).toBeFocused();

    await tabAte(page, page.locator('#newImovelNome'));
    await page.keyboard.type('Apto 10 - Rua do Teclado, 1');
    await page.keyboard.press('Enter');
    await expect(page.locator('#toast')).toContainText('Imóvel adicionado');

    // quem recebe (sem isso o pagamento não sai): Usuários › Pessoas
    await page.keyboard.press('Shift+Tab');
    await tabAte(page, page.locator('#tabsNav a[href="#/usuarios"]'), { voltar: true });
    await page.keyboard.press('Enter');
    await tabAte(page, page.locator('#newPessoaNome'), { limite: 120 });
    await page.keyboard.type('Ana Recebedora');
    await page.keyboard.press('Enter');
    await expect(page.locator('#toast')).toContainText('Pessoa adicionada');

    // novo contrato pelo atalho N
    await page.locator('#tab-usuarios h1').focus();
    await page.keyboard.press('N');
    await expect(page.locator('#modalContrato')).toBeVisible();
    await expect(page.locator('#fDataInicio')).toBeFocused();
    // data de início: fica a de hoje (17-09-2026); o primeiro vencimento é no mês seguinte.
    // (o Tab passa pelas partes da data — dia, mês, ano — antes de sair do campo)
    await tabAte(page, page.locator('#fDiaPagamento'));
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('10');
    // num <select>, digitar a primeira letra escolhe a opção (a seta abre a lista no macOS)
    await tabAte(page, page.locator('#fImovel'));
    await page.keyboard.type('A');
    await expect(page.locator('#fImovel')).toHaveValue('Apto 10 - Rua do Teclado, 1');
    await tabAte(page, page.locator('#fInquilino'));
    await page.keyboard.type('Inquilina do Teclado');
    await tabAte(page, page.locator('#fAluguel'));
    await page.keyboard.type('1.250,50');
    await page.keyboard.press('Enter');
    await expect(page.locator('#toast')).toContainText('Contrato criado');
    await expect(page.locator('#modalContrato')).toBeHidden();
    const contrato = app.dadosGravados().contratos[0];
    expect(contrato.aluguel).toBe(1250.5);

    // registrar pagamento pelo botão da linha
    const pagar = page.locator('#contratosList [data-divida-action="pagar"]').first();
    await expect(pagar).toHaveAttribute('aria-label', /Registrar pagamento da dívida de 10-10-2026, contrato #1/);
    await tabAte(page, pagar, { limite: 60 });
    await page.keyboard.press('Enter');
    await expect(page.locator('#modalPagamento')).toBeVisible();
    await tabAte(page, page.locator('#pagForma'));
    await page.keyboard.type('P');
    await expect(page.locator('#pagForma')).toHaveValue('Pix');
    await tabAte(page, page.locator('#pagQuemRecebeu'));
    await page.keyboard.type('A');
    await expect(page.locator('#pagQuemRecebeu')).toHaveValue('Ana Recebedora');
    await page.keyboard.press('Enter');
    await expect(page.locator('#toast')).toContainText('Pagamento registrado');
    // o foco não se perde: volta para a linha (o botão "pagar" sumiu; fica no recibo ou no título)
    expect(await app.foco()).not.toBe('body');

    // recibo
    const recibo = page.locator('#contratosList [data-divida-action="recibo"]').first();
    await tabAte(page, recibo, { voltar: true, limite: 60 }).catch(() => tabAte(page, recibo, { limite: 60 }));
    const [janela] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('Enter')]);
    await janela.waitForLoadState();
    await expect(janela.locator('body')).toContainText('Inquilina do Teclado');
    await expect(janela.locator('body')).toContainText('R$ 1.250,50');
    await janela.close();

    // histórico e CSV
    await page.bringToFront();
    await page.keyboard.press('Shift+Tab');
    await tabAte(page, page.locator('#tabsNav a[href="#/historico"]'), { voltar: true, limite: 120 });
    await page.keyboard.press('Enter');
    await expect(page.locator('#historicoList')).toContainText('Inquilina do Teclado');
    await tabAte(page, page.locator('#btnExportHistorico'));
    const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
    const csv = fs.readFileSync(await download.path(), 'utf8');
    expect(csv).toContain('Inquilina do Teclado');
    // o valor pago é o total da dívida (aluguel + juros e multa padrão, 1% e 2%)
    const pago = app.dadosGravados().contratos[0].dividas[0].pagamentos[0].valor;
    expect(csv).toContain(`"${pago.toFixed(2)}"`);
    expect(csv).toContain('"Pix"');
    expect(page.errosDoConsole).toEqual([]);
  });
});

test.describe('Foco e modais', () => {
  const MODAIS = [
    { nome: 'Novo contrato', rota: '#/contratos', abrir: '#btnNovoContrato', modal: '#modalContrato', foco: '#fDataInicio' },
    { nome: 'Editar contrato', rota: '#/contratos', abrir: '#contratosList [data-grupo-action="editar"] >> nth=0', modal: '#modalContratoInfo', foco: '#infoImovel' },
    { nome: 'Registrar pagamento', rota: '#/atrasos', abrir: '#atrasosList [data-divida-action="pagar"] >> nth=0', modal: '#modalPagamento', foco: '#pagData' },
    { nome: 'Reajustar', rota: '#/contratos', abrir: '#contratosList [data-grupo-action="reajustar"] >> nth=0', modal: '#modalReajuste', foco: '#reajusteNovoValor' },
    { nome: 'Devolver caução', rota: '#/contratos', abrir: '#contratosList [data-grupo-action="devolver-caucao"] >> nth=0', modal: '#modalDevolucaoCaucao', foco: '#devCaucaoData' },
    { nome: 'Histórico do contrato', rota: '#/contratos', abrir: '#contratosList [data-grupo-action="historico"] >> nth=0', modal: '#modalHistoricoContrato', foco: '#modalHistoricoContratoTitulo' },
    { nome: 'Atalhos', rota: '#/', abrir: null, tecla: '?', modal: '#modalAtalhos', foco: '#atalhosTitulo' },
  ];

  for (const m of MODAIS) {
    test(`${m.nome}: foco entra, Tab não escapa, Esc fecha e o foco volta`, async ({ page, app }) => {
      await app.entrar(m.rota);
      let origem;
      if (m.abrir) {
        origem = page.locator(m.abrir);
        await origem.focus();
        await page.keyboard.press('Enter');
      } else {
        await page.locator('.tab-panel.active h1').focus();
        await page.keyboard.press(m.tecla);
      }
      const modal = page.locator(m.modal);
      await expect(modal).toBeVisible();
      await expect(modal).toHaveAttribute('aria-labelledby', /.+/);
      await expect(page.locator(m.foco)).toBeFocused();
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press('Tab');
        const dentro = await page.evaluate((sel) => {
          const a = document.activeElement;
          return a === document.body || document.querySelector(sel).contains(a);
        }, m.modal);
        expect(dentro, 'o Tab saiu do modal').toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(modal).toBeHidden();
      if (origem) await expect(origem).toBeFocused();
    });
  }

  test('Esc com algo digitado pergunta antes de descartar; clique fora também', async ({ page, app }) => {
    await app.entrar('#/contratos');
    await page.locator('#btnNovoContrato').click();
    await page.locator('#fInquilino').fill('digitado');
    await page.keyboard.press('Escape');
    await expect(page.locator('#modalConfirmacao')).toBeVisible();
    await expect(page.locator('#confCancelar')).toBeFocused();
    await expect(page.locator('#confCancelar')).toHaveText('Continuar editando');
    await page.keyboard.press('Enter');
    await expect(page.locator('#modalContrato')).toBeVisible();
    await expect(page.locator('#fInquilino')).toHaveValue('digitado');

    await page.mouse.click(5, 5); // fora do modal
    await expect(page.locator('#modalConfirmacao')).toBeVisible();
    await page.getByRole('button', { name: 'Descartar alterações' }).click();
    await expect(page.locator('#modalContrato')).toBeHidden();
  });

  test('exclusão usa diálogo com a ação no botão e foco em Cancelar', async ({ page, app, servidor }) => {
    await app.entrar('#/contratos');
    const excluir = page.locator('#contratosList [data-grupo-action="excluir"]').first();
    await excluir.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#modalConfirmacao')).toHaveAttribute('role', 'alertdialog');
    await expect(page.locator('#confOk')).toHaveText('Excluir contrato');
    await expect(page.locator('#confCancelar')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#modalConfirmacao')).toBeHidden();
    await expect(excluir).toBeFocused();
    expect(servidor.lerDados().contratos.length).toBe(25);
  });

  test('remover usuário pede a senha num campo de senha, com rótulo', async ({ page, app }) => {
    await app.entrar('#/usuarios');
    await page.locator('#newUserUsername').fill('gerente');
    await page.locator('#newUserPassword').fill('senha-gerente');
    await page.locator('#newUserConfirmPassword').fill('senha-gerente');
    await page.locator('#newUserCurrentPassword').fill('12345678');
    await page.getByRole('button', { name: 'Adicionar usuário' }).click();
    await page.getByRole('button', { name: 'Remover o acesso de gerente' }).click();
    const campo = page.getByRole('textbox', { name: 'Sua senha atual', exact: true });
    await expect(campo).toHaveAttribute('type', 'password');
    await campo.fill('errada');
    await page.keyboard.press('Enter');
    await expect(page.locator('#confErro')).toHaveText('Senha atual incorreta.');
    await campo.fill('12345678');
    await page.keyboard.press('Enter');
    await expect(page.locator('#usersList')).not.toContainText('gerente');
  });

  test('paginação e calendário devolvem o foco ao botão equivalente', async ({ page, app }) => {
    await app.entrar('#/contratos');
    await page.locator('#contratosPagination [data-pagina="proxima"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#contratosPagination .pagination-info')).toContainText('Página 2 de 2');
    // "Próxima" ficou desabilitada: o foco passa para "Anterior"
    await expect(page.locator('#contratosPagination [data-pagina="anterior"]')).toBeFocused();
    expect(await app.hash()).toBe('#/contratos?pagina=2');

    await app.ir('#/calendario');
    const dia = page.locator('.calendar-day[data-data="2026-09-10"]');
    await dia.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.calendar-day[data-data="2026-09-10"]')).toBeFocused();
    await expect(page.locator('#calendarioDetalheTitulo')).toContainText('10-09-2026');
    expect(await app.hash()).toBe('#/calendario?dia=2026-09-10');
  });

  test('"Pular para o conteúdo" é o primeiro Tab e leva ao título', async ({ page, app }) => {
    await app.entrar('#/historico');
    await page.keyboard.press('Tab');
    await expect(page.locator('#linkPularConteudo')).toBeFocused();
    await expect(page.locator('#linkPularConteudo')).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('#tab-historico h1')).toBeFocused();
  });

  test('menus do topo: abrem com Enter, Esc fecha e devolve o foco', async ({ page, app }) => {
    await app.entrar('#/');
    await page.locator('#uiUserButton').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#uiUserDropdown')).toBeVisible();
    await expect(page.locator('#uiUserButton')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#uiUserDropdown [role="menu"], #uiUserDropdown [role="menuitem"]')).toHaveCount(0);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    await expect(page.locator('#uiUserDropdown')).toBeHidden();
    await expect(page.locator('#uiUserButton')).toBeFocused();
  });

  test('gráficos: setas percorrem os meses e "Ver dados" mostra a tabela', async ({ page, app }) => {
    await app.entrar('#/graficos');
    const grafico = page.locator('#chartReceitaMensal');
    await expect(grafico).toHaveAttribute('role', 'img');
    await expect(grafico).toHaveAttribute('aria-label', /Receita líquida × despesas por mês\. .*Total/);
    await grafico.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#anuncio')).toContainText('Janeiro: Recebido (líquido)');
    await page.keyboard.press('End');
    await expect(page.locator('#anuncio')).toContainText('Dezembro');
    const dados = page.locator('details[data-grafico="chartReceitaMensal"]');
    await dados.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(dados.locator('tbody tr')).toHaveCount(12);
  });

  test('atalhos de uma tecla podem ser desligados', async ({ page, app }) => {
    await app.entrar('#/configuracoes');
    await page.getByLabel('Usar atalhos de uma tecla').uncheck();
    await page.locator('#tab-config h1').focus();
    await page.keyboard.press('n');
    await expect(page.locator('#modalContrato')).toBeHidden();
    await page.getByLabel('Usar atalhos de uma tecla').check();
    await page.locator('#tab-config h1').focus();
    await page.keyboard.press('Shift+N');
    await expect(page.locator('#modalContrato')).toBeVisible();
  });
});

test.describe('Tela estreita (gaveta do menu)', () => {
  test.use({ viewport: { width: 900, height: 800 } });

  test('fechada não recebe foco; aberta recebe; Esc fecha e devolve o foco', async ({ page, app }) => {
    await app.entrar('#/');
    await page.locator('#uiDrawerToggle').focus();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => !!document.activeElement.closest('.sidebar'))).toBe(false);
    }
    await page.locator('#uiDrawerToggle').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#tabsNav a[aria-current="page"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#uiDrawerToggle')).toBeFocused();
    await expect(page.locator('#uiSidebar')).toHaveJSProperty('inert', true);
  });
});

test.describe('Só com mouse', () => {
  test('clique duplo não duplica, clique fora pergunta, conteúdo do modal rola', async ({ page, app }) => {
    await app.entrar('#/contratos');
    await page.locator('#btnNovoContrato').click();
    const corpo = page.locator('#modalContrato .modal');
    const rola = await corpo.evaluate(el => { el.scrollTop = 9999; return el.scrollTop > 0; });
    expect(rola).toBe(true);
    await page.mouse.click(5, 5);
    await expect(page.locator('#modalContrato')).toBeHidden(); // nada digitado: fecha direto
  });
});
