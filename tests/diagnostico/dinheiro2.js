const { chromium, subirServidor, gerarDados, novaPagina, entrar } = require('./comum');
(async () => {
  const srv = await subirServidor({ dados: gerarDados() });
  const browser = await chromium.launch();
  const { page } = await novaPagina(browser, srv);
  await entrar(page, srv.url);
  console.log('lerNumero:', JSON.stringify(await page.evaluate(() => ['1.250,50', '1250,50', '1250.50', '1.250', '12.500', '1.250.000,00', 'R$ 99,9', '0,5', '1,250,50', 'abc', '', '-5', '1250.500'].map(t => [t, lerNumero(t)]))));
  await page.goto(srv.url + '#/despesas'); await page.waitForTimeout(300);
  for (const [t, desc] of [['1.250,50', 'A'], ['1250,50', 'B'], ['1250.50', 'C']]) {
    await page.fill('#despDescricao', 'Teste ' + desc); await page.fill('#despValor', t); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    console.log(t, '→ gravado:', srv.lerDados().despesas.find(d => d.descricao === 'Teste ' + desc)?.valor);
  }
  await page.fill('#despDescricao', 'Invalida'); await page.fill('#despValor', 'abc'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  console.log('abc → erro:', await page.textContent('#despValor-erro'), '| foco:', await page.evaluate(() => document.activeElement.id), '| describedby:', await page.getAttribute('#despValor', 'aria-describedby'), '| gravou?', !!srv.lerDados().despesas.find(d => d.descricao === 'Invalida'));
  await page.fill('#despValor', '0'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  console.log('0 → erro:', await page.textContent('#despValor-erro'));
  await page.fill('#despValor', '10'); await page.waitForTimeout(100); console.log('corrigido → erro some?', !(await page.$('#despValor-erro')));
  await page.fill('#despDescricao', ''); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  console.log('vazio → erro:', await page.textContent('#despDescricao-erro'), '| foco', await page.evaluate(() => document.activeElement.id));
  // pagamento
  await page.goto(srv.url + '#/atrasos'); await page.waitForTimeout(300);
  console.log('saindo com rascunho pergunta?', await page.isVisible('#modalConfirmacao'), await page.textContent('#confTitulo'));
  await page.click('#confOk'); await page.waitForTimeout(100);
  await page.goto(srv.url + '#/atrasos'); await page.waitForTimeout(300);
  await page.locator('#atrasosList [data-divida-action="pagar"]').first().click(); await page.waitForTimeout(200);
  console.log('valor sugerido:', await page.inputValue('#pagValor'), '| prévia:', await page.textContent('#pagLiquidoPrevia'));
  await page.fill('#pagValor', '1.000,5'); await page.dispatchEvent('#pagValor', 'input'); console.log('prévia com 1.000,5:', await page.textContent('#pagLiquidoPrevia'));
  await page.fill('#pagDesconto', '100'); await page.dispatchEvent('#pagDesconto', 'input'); console.log('com desconto 100 → valor', await page.inputValue('#pagValor'));
  await page.click('#formPagamento button[type=submit]'); await page.waitForTimeout(200);
  console.log('sem forma → erros:', await page.$$eval('#formPagamento .campo-erro', e => e.map(x => x.id + ': ' + x.textContent)), '| foco', await page.evaluate(() => document.activeElement.id));
  // novo contrato: dia 40
  await page.keyboard.press('Escape'); await page.waitForTimeout(150); if (await page.isVisible('#modalConfirmacao')) await page.click('#confOk');
  await page.goto(srv.url + '#/contratos'); await page.waitForTimeout(300); await page.click('#btnNovoContrato');
  await page.fill('#fDiaPagamento', '40'); await page.fill('#fAluguel', '1.500'); await page.click('#formContrato button[type=submit]'); await page.waitForTimeout(200);
  console.log('contrato → erros:', await page.$$eval('#formContrato .campo-erro', e => e.map(x => x.id + ': ' + x.textContent)));
  console.log('config juros:', await page.evaluate(() => { location.hash = '#/configuracoes'; return 1; }));
  await page.waitForTimeout(300); console.log('juros mostrado:', await page.inputValue('#configTaxaJuros'), '| corretor', await page.inputValue('#configCorretorPercentualPadrao'));
  console.log(page.erros);
  await browser.close(); await srv.parar();
})();
