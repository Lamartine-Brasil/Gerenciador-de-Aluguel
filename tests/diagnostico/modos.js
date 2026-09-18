const { chromium, subirServidor, gerarDados, novaPagina, entrar, OUT } = require('./comum');
(async () => {
  const browser = await chromium.launch();
  for (const [nome, dados] of [['vazio', null], ['nenhuma', gerarDados({ carteiras: 'nenhuma' })], ['uma', gerarDados({ carteiras: 'uma' })]]) {
    const srv = await subirServidor({ dados });
    const { page } = await novaPagina(browser, srv);
    await entrar(page, srv.url);
    const vazios = [];
    for (const aba of ['dashboard','imoveis','contratos','atrasos','historico','despesas','graficos','relatorios','calendario','auditoria','usuarios','config']) {
      await page.click(`.tab-btn[data-tab="${aba}"]`); await page.waitForTimeout(200);
      const t = await page.$$eval(`#tab-${aba} .empty-state`, e => e.filter(x => x.offsetParent).map(x => x.textContent.trim().slice(0, 70)));
      if (t.length) vazios.push(`${aba}: ${t.join(' | ')}`);
    }
    console.log(`\n== ${nome}: seletor de carteira visível? ${await page.isVisible('#carteiraSeletorWrap')} | erros: ${JSON.stringify(page.erros)}`);
    if (nome === 'vazio') {
      console.log(vazios.join('\n'));
      await page.click('.tab-btn[data-tab="contratos"]'); await page.click('#btnNovoContrato');
      console.log('aviso sem imóvel visível?', await page.isVisible('#fSemImovelHint'));
      await page.fill('#fInquilino', 'X'); await page.fill('#fAluguel', '100'); await page.click('#formContrato button[type=submit]');
      console.log('validação do navegador no imóvel:', await page.$eval('#fImovel', e => e.validationMessage));
      await page.keyboard.press('Escape');
      const d = srv.lerDados(); console.log('dados.json criado com chaves:', Object.keys(d).join(','));
    }
    await srv.parar();
  }
  // flash da tela de login no F5 de quem já está logado
  const srv = await subirServidor({ dados: gerarDados() });
  const { page } = await novaPagina(browser, srv);
  await entrar(page, srv.url);
  await page.route('**/api/session.php', async r => { await new Promise(x => setTimeout(x, 600)); r.continue(); });
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(150);
  console.log('\nF5 logado: tela de login aparece enquanto confere a sessão?', await page.isVisible('#loginScreen'));
  await browser.close(); await srv.parar();
})();
