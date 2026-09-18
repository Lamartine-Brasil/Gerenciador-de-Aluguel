const { chromium, firefox, subirServidor, gerarDados, novaPagina, entrar } = require('./comum');
(async () => {
  const srv = await subirServidor({ dados: gerarDados() });
  for (const [nome, tipo, args] of [['chromium --lang=pt-BR', chromium, ['--lang=pt-BR']], ['firefox', firefox, []]]) {
    const browser = await tipo.launch({ args, firefoxUserPrefs: { 'intl.locale.requested': 'pt-BR', 'intl.accept_languages': 'pt-BR' } });
    const { page } = await novaPagina(browser, srv, { ctx: { locale: 'pt-BR' } });
    await entrar(page, srv.url);
    await page.click('.tab-btn[data-tab="despesas"]');
    for (const texto of ['1.250,50', '1250,50', '1250.50']) {
      await page.fill('#despValor', '');
      await page.click('#despValor');
      await page.keyboard.type(texto);
      const r = await page.$eval('#despValor', el => ({ value: el.value, num: el.valueAsNumber, valido: el.validity.valid, badInput: el.validity.badInput }));
      console.log(nome, JSON.stringify(texto), '=>', JSON.stringify(r), '| Number(value)=', Number(r.value) || 0);
    }
    await browser.close();
  }
  await srv.parar();
})();
