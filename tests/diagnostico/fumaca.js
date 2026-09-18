const { chromium, subirServidor, gerarDados, novaPagina, entrar, OUT } = require('./comum');
(async () => {
  const srv = await subirServidor({ dados: gerarDados() });
  const browser = await chromium.launch();
  const { page } = await novaPagina(browser, srv);
  await entrar(page, srv.url);
  const abas = await page.$$eval('.tab-btn', b => b.map(x => x.dataset.tab));
  for (const aba of abas) {
    await page.click(`.tab-btn[data-tab="${aba}"]`);
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUT}/fumaca-${aba}.png`, fullPage: false });
    console.log(aba, 'URL=', page.url(), 'h1=', await page.$$eval('h1', h => h.filter(x => x.offsetParent).map(x => x.textContent.trim())), 'title=', await page.title());
  }
  const d = srv.lerDados();
  console.log('contratos', d.contratos.length, 'dividas', d.contratos.reduce((s,c)=>s+c.dividas.length,0), 'auditoria', d.auditoria.length);
  console.log('ERROS', page.erros);
  await page.reload(); await page.waitForTimeout(600);
  console.log('após F5 aba ativa:', await page.$eval('.tab-btn.active', b => b.dataset.tab));
  await browser.close(); await srv.parar();
})();
