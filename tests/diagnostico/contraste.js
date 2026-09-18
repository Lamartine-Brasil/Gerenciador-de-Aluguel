const { chromium, subirServidor, gerarDados, novaPagina, entrar } = require('./comum');
const AxeBuilder = require('../node_modules/@axe-core/playwright').default;
(async () => {
  const srv = await subirServidor({ dados: gerarDados() });
  const browser = await chromium.launch();
  for (const tema of ['dark', 'light']) {
    const pares = {};
    const { page, ctx } = await novaPagina(browser, srv, { tema });
    await entrar(page, srv.url);
    const abas = await page.$$eval('.tab-btn', b => b.map(x => x.dataset.tab));
    for (const aba of abas) {
      await page.click(`.tab-btn[data-tab="${aba}"]`); await page.waitForTimeout(250);
      const r = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
      r.violations.forEach(v => v.nodes.forEach(n => { const d = n.any[0] && n.any[0].data; if (!d) return; const k = `${d.fgColor} sobre ${d.bgColor} = ${d.contrastRatio} (precisa ${d.expectedContrastRatio})`; pares[k] = pares[k] || { n: 0, ex: n.target[0] }; pares[k].n++; }));
    }
    console.log('\n== tema', tema);
    Object.entries(pares).sort((a, b) => b[1].n - a[1].n).forEach(([k, v]) => console.log(String(v.n).padStart(4), k, ' ex:', String(v.ex).slice(0, 80)));
    await ctx.close();
  }
  await browser.close(); await srv.parar();
})();
