const { chromium, subirServidor, gerarDados, novaPagina, entrar, OUT } = require('./comum');
(async () => {
  const srv = await subirServidor({ dados: gerarDados() });
  const browser = await chromium.launch();
  for (const vp of [{ width: 320, height: 640 }, { width: 640, height: 400 }]) {
    const { page, ctx } = await novaPagina(browser, srv, { viewport: vp });
    await entrar(page, srv.url);
    const abas = ['dashboard','imoveis','contratos','atrasos','historico','despesas','graficos','relatorios','calendario','auditoria','usuarios','config'];
    for (const aba of abas) {
      await page.evaluate(a => { document.querySelector(`.tab-btn[data-tab="${a}"]`).click(); }, aba);
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const W = document.documentElement.clientWidth;
        const vazam = [];
        document.querySelectorAll('#app *').forEach(el => {
          if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return;
          if (el.closest('.sidebar')) return;
          let p = el.parentElement, rolavel = false;
          while (p) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX)) { rolavel = true; break; } p = p.parentElement; }
          if (rolavel) return;
          const b = el.getBoundingClientRect();
          if (b.right > W + 1 && b.width > 0) vazam.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]) + ` (${Math.round(b.right)}>${W})`);
        });
        return { scroll: document.documentElement.scrollWidth - W, vazam: vazam.slice(0, 4) };
      });
      if (r.scroll > 0 || r.vazam.length) console.log(`${vp.width}px ${aba}: rolagem horizontal ${r.scroll}px`, r.vazam);
    }
    await page.evaluate(() => document.querySelector('.tab-btn[data-tab="contratos"]').click());
    await page.screenshot({ path: `${OUT}/estreito-${vp.width}-contratos.png` });
    await page.evaluate(() => document.getElementById('btnNovoContrato').click()); await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/estreito-${vp.width}-modal.png` });
    await ctx.close();
  }
  console.log('fim');
  await browser.close(); await srv.parar();
})();
