'use strict';

const fs = require('fs');
const { test, expect, gerarDados } = require('../apoio/fixtures');

// Confirma o diálogo de confirmação que estiver aberto.
async function confirmarDialogo(page, texto) {
  await expect(page.locator('#modalConfirmacao')).toBeVisible();
  if (texto !== undefined) await page.locator('#confEntrada').fill(texto);
  await page.locator('#confOk').click();
  await expect(page.locator('#modalConfirmacao')).toBeHidden();
}

test.describe('Só com mouse, conferindo a gravação depois do F5', () => {
  test('fluxo principal e registro na Auditoria', async ({ page, app, servidor }) => {
    test.slow();
    await app.entrar('#/imoveis');
    await page.locator('#newImovelNome').fill('Apto 77 - Rua do Mouse');
    await page.getByRole('button', { name: 'Adicionar imóvel' }).click();
    await expect(page.locator('#toast')).toContainText('Imóvel adicionado');

    await page.locator('#tabsNav a[href="#/contratos"]').click();
    await page.getByRole('button', { name: 'Novo contrato' }).click();
    await page.locator('#fDataInicio').fill('2026-06-03');
    await page.locator('#fDiaPagamento').fill('8');
    await page.locator('#fImovel').selectOption('Apto 77 - Rua do Mouse');
    await page.locator('#fInquilino').fill('Inquilino do Mouse');
    await page.locator('#fAluguel').fill('1000');
    await page.locator('#fCorretorNome').selectOption('Carlos Lima');
    await page.locator('#formContrato button[type="submit"]').click();
    // retroativo: pede confirmação dizendo quantas dívidas
    await expect(page.locator('#confOk')).toHaveText('Criar contrato com 3 dívidas');
    await confirmarDialogo(page);
    await expect(page.locator('#toast')).toContainText('Contrato criado com 3 dívidas');

    await app.recarregar();
    const contrato = servidor.lerDados().contratos.find(c => c.inquilino === 'Inquilino do Mouse');
    expect(contrato.dividas).toHaveLength(3);
    expect(contrato.corretorPercentual).toBe(5);

    await page.locator('#searchContratos').fill('Inquilino do Mouse');
    const linha = page.locator('#contratosList .divida-row').first();
    await linha.locator('[data-divida-action="pagar"]').click();
    await page.locator('#pagForma').selectOption('Pix');
    await page.locator('#pagQuemRecebeu').selectOption('Ana Souza');
    await page.getByRole('button', { name: 'Confirmar pagamento' }).click();
    await expect(page.locator('#toast')).toContainText('Pagamento registrado');

    const [recibo] = await Promise.all([
      page.waitForEvent('popup'),
      page.locator('#contratosList [data-divida-action="recibo"]').first().click(),
    ]);
    await expect(recibo.locator('body')).toContainText('Inquilino do Mouse');
    await recibo.close();

    await app.recarregar();
    const pago = servidor.lerDados().contratos.find(c => c.inquilino === 'Inquilino do Mouse').dividas.filter(d => d.pago);
    expect(pago).toHaveLength(1);

    await page.locator('#tabsNav a[href="#/auditoria"]').click();
    await expect(page.locator('#auditoriaList')).toContainText('Imóvel cadastrado: "Apto 77 - Rua do Mouse"');
    await expect(page.locator('#auditoriaList')).toContainText('Contrato criado com 3 dívidas');
    await expect(page.locator('#auditoriaList')).toContainText('Pagamento registrado: Apto 77 - Rua do Mouse');
  });

  test('encerrar, reabrir, reajustar e excluir contrato', async ({ page, app, servidor }) => {
    await app.entrar('#/contratos?busca=%2325');
    const card = page.locator('#contratosList .contrato-grupo').first();
    await card.getByRole('button', { name: 'Encerrar contrato #25' }).click();
    await confirmarDialogo(page);
    await expect(page.locator('#toast')).toContainText('Contrato encerrado');
    expect(servidor.lerDados().contratos.find(c => c.numero === 25).encerrado).toBe(true);

    await card.getByRole('button', { name: 'Reabrir contrato #25' }).click();
    await expect(page.locator('#toast')).toContainText('Contrato reaberto');

    await card.getByRole('button', { name: 'Reajustar contrato #25' }).click();
    await page.locator('#reajusteNovoValor').fill('200,00');
    await page.getByRole('button', { name: 'Aplicar reajuste' }).click();
    await expect(page.locator('#toast')).toContainText('Reajuste aplicado');
    expect(servidor.lerDados().contratos.find(c => c.numero === 25).aluguel).toBe(200);

    await card.getByRole('button', { name: 'Excluir contrato #25' }).click();
    await confirmarDialogo(page);
    await expect(page.locator('#toast')).toContainText('Contrato excluído');
    await app.recarregar();
    expect(servidor.lerDados().contratos.some(c => c.numero === 25)).toBe(false);
  });

  test('despesa: criar, editar e excluir; o Dashboard acompanha', async ({ page, app, servidor }) => {
    await app.entrar('#/');
    const antes = await page.locator('#statDespesasMesDashboard').textContent();
    await app.ir('#/despesas');
    await page.locator('#despDescricao').fill('Conserto do portão');
    await page.locator('#despValor').fill('300');
    await page.getByRole('button', { name: 'Adicionar despesa' }).click();
    await expect(page.locator('#toast')).toContainText('Despesa adicionada');
    await app.ir('#/');
    await expect(page.locator('#statDespesasMesDashboard')).not.toHaveText(antes);

    await app.ir('#/despesas?busca=port%C3%A3o');
    await page.getByRole('button', { name: /Editar despesa Conserto do portão/ }).click();
    await page.locator('#despValor').fill('350');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.locator('#toast')).toContainText('Despesa atualizada');
    expect(servidor.lerDados().despesas.find(d => d.descricao === 'Conserto do portão').valor).toBe(350);

    await page.getByRole('button', { name: /Excluir despesa Conserto do portão/ }).click();
    await confirmarDialogo(page);
    await expect(page.locator('#toast')).toContainText('Despesa excluída');
    await app.ir('#/');
    await expect(page.locator('#statDespesasMesDashboard')).toHaveText(antes);
  });
});

test.describe('Exportações batem com a tela', () => {
  test('CSV de Contratos respeita a busca por #número', async ({ page, app }) => {
    await app.entrar('#/contratos?busca=%235');
    await expect(page.locator('#contratosList .contrato-grupo')).toHaveCount(1);
    const [d] = await Promise.all([page.waitForEvent('download'), page.locator('#btnExportCSV').click()]);
    const linhas = fs.readFileSync(await d.path(), 'utf8').trim().split('\r\n').slice(1);
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas.every(l => l.startsWith('"5";'))).toBe(true);
  });

  test('CSV do Histórico tem o mesmo número de pagamentos do contador', async ({ page, app }) => {
    await app.entrar('#/historico?busca=Ricardo&ano=2025');
    const contador = await page.locator('#historicoCount').textContent();
    const [d] = await Promise.all([page.waitForEvent('download'), page.locator('#btnExportHistorico').click()]);
    const linhas = fs.readFileSync(await d.path(), 'utf8').trim().split('\r\n').length - 1;
    expect(contador.startsWith(`${linhas} pagamentos`)).toBe(true);
  });

  test('CSV e PDF do relatório saem do período escolhido', async ({ page, app }) => {
    await app.entrar('#/relatorios?ano=2026&mes=7');
    const [d] = await Promise.all([page.waitForEvent('download'), page.locator('#btnExportRelatorio').click()]);
    expect(fs.readFileSync(await d.path(), 'utf8')).toContain('Relatório — Julho de 2026');
    const [pdf] = await Promise.all([page.waitForEvent('popup'), page.locator('#btnExportRelatorioPDF').click()]);
    await expect(pdf.locator('h1')).toContainText('Julho de 2026');
  });
});

test.describe('Modos de uso', () => {
  test.describe('instalação vazia', () => {
    test.use({ dados: null });
    test('abre, mostra o caminho para começar e cria dados.json', async ({ page, app, servidor }) => {
      await app.entrar('#/');
      await expect(page.locator('#dashboardRecentList')).toContainText('Comece cadastrando um imóvel');
      await page.getByRole('link', { name: 'Cadastrar imóvel' }).click();
      await expect(page.locator('#tab-imoveis')).toBeVisible();
      expect(Object.keys(servidor.lerDados())).toEqual(expect.arrayContaining(['contratos', 'config', 'versao']));
    });
  });

  test.describe('sem carteiras', () => {
    test.use({ dados: gerarDados({ carteiras: 'nenhuma' }) });
    test('o seletor de carteira não aparece', async ({ page, app }) => {
      await app.entrar('#/contratos');
      await expect(page.locator('#carteiraSeletorWrap')).toBeHidden();
      await page.getByRole('button', { name: 'Novo contrato' }).click();
      await expect(page.locator('#fCampoCarteira')).toBeHidden();
    });
  });

  test.describe('uma carteira', () => {
    test.use({ dados: gerarDados({ carteiras: 'uma' }) });
    test('o seletor filtra o sistema e a escolha sobrevive ao F5', async ({ page, app }) => {
      await app.entrar('#/contratos');
      await page.locator('#carteiraSeletor').selectOption('cart_a');
      await expect(page.locator('#contratosList .contrato-grupo')).toHaveCount(2);
      await app.recarregar();
      await expect(page.locator('#carteiraSeletor')).toHaveValue('cart_a');
      await expect(page.locator('#contratosList .contrato-grupo')).toHaveCount(2);
    });
  });
});

test.describe('Sistema numa subpasta (https://site.com/aluguel/)', () => {
  test.use({ subpasta: 'aluguel/' });
  test('abre, entra, navega e grava', async ({ page, app, servidor }) => {
    expect(servidor.url).toMatch(/\/aluguel\/$/);
    await app.entrarPelaTela('#/imoveis');
    await expect(page).toHaveURL(/\/aluguel\/#\/imoveis$/);
    await page.locator('#newImovelNome').fill('Imóvel da subpasta');
    await page.getByRole('button', { name: 'Adicionar imóvel' }).click();
    await expect(page.locator('#toast')).toContainText('Imóvel adicionado');
    await app.recarregar();
    await expect(page.locator('#tab-imoveis')).toBeVisible();
    expect(servidor.lerDados().imoveis.some(i => i.nome === 'Imóvel da subpasta')).toBe(true);
  });
});
