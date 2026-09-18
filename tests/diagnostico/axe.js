const { chromium, subirServidor, gerarDados, novaPagina, entrar, OUT } = require('./comum');
const AxeBuilder = require('../node_modules/@axe-core/playwright').default;
(async () => {
  const srv = await subirServidor({ dados: gerarDados() });
  const browser = await chromium.launch();
  const resumo = {};
  for (const tema of ['dark', 'light']) {
    const { page, ctx } = await novaPagina(browser, srv, { tema });
    // login também
    await page.goto(srv.url); await page.waitForTimeout(400);
    const rl = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']).analyze();
    rl.violations.forEach(v => { const k = `${v.impact}|${v.id}`; resumo[k] = resumo[k] || { telas: new Set(), exemplos: new Set(), n: 0 }; resumo[k].telas.add('login-' + tema); resumo[k].n += v.nodes.length; v.nodes.slice(0, 2).forEach(n => resumo[k].exemplos.add(n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n')[1])); });
    await entrar(page, srv.url);
    const abas = await page.$$eval('.tab-btn', b => b.map(x => x.dataset.tab));
    for (const aba of abas) {
      await page.click(`.tab-btn[data-tab="${aba}"]`); await page.waitForTimeout(300);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']).analyze();
      r.violations.forEach(v => { const k = `${v.impact}|${v.id}`; resumo[k] = resumo[k] || { telas: new Set(), exemplos: new Set(), n: 0 }; resumo[k].telas.add(aba + '-' + tema); resumo[k].n += v.nodes.length; v.nodes.slice(0, 2).forEach(n => resumo[k].exemplos.add(n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n')[1])); });
    }
    await ctx.close();
  }
  for (const [k, v] of Object.entries(resumo).sort()) {
    console.log(`\n${k}  (${v.n} nós) telas: ${[...v.telas].join(', ')}`);
    [...v.exemplos].slice(0, 4).forEach(e => console.log('   -', e.slice(0, 220)));
  }
  await browser.close(); await srv.parar();
})();
