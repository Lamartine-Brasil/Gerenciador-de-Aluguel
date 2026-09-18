const { chromium, subirServidor, gerarDados, novaPagina, entrar } = require('./comum');
const log = (...a) => console.log(...a);
(async () => {
  const browser = await chromium.launch();
  // A
  { const srv = await subirServidor({ dados: gerarDados() }); const { page } = await novaPagina(browser, srv);
    let posts = 0; let falhar = true;
    await page.route('**/api/data.php', r => { if (r.request().method() === 'POST') posts++; return (r.request().method() === 'GET' && falhar) ? r.fulfill({ status: 500, body: '{"error":"x"}' }) : r.continue(); });
    await page.goto(srv.url); await page.fill('#loginUser', 'admin'); await page.fill('#loginPass', '12345678'); await page.click('#loginForm button[type=submit]'); await page.waitForTimeout(600);
    log('A tela de erro?', await page.isVisible('#telaErroCarga'), '| app escondido?', await page.isHidden('#app'), '| POSTs:', posts, '| foco no título?', await page.evaluate(() => document.activeElement.tagName));
    falhar = false; await page.click('#btnTentarCarregar'); await page.waitForTimeout(600);
    log('A tentar de novo abre?', await page.isVisible('#app'), '| contratos:', await page.textContent('#statAtivos'), '| erros', page.erros.filter(e=>!e.includes('500')));
    await srv.parar(); }
  // B
  { const srv = await subirServidor({ dados: gerarDados() }); const { ctx, page: p1 } = await novaPagina(browser, srv); await entrar(p1, srv.url);
    const p2 = await ctx.newPage(); await p2.clock.setFixedTime(new Date('2026-09-17T12:00:00')); await p2.goto(srv.url); await p2.waitForSelector('#app:not(.hidden)'); await p2.waitForTimeout(300);
    await p1.click('.tab-btn[data-tab="imoveis"]'); await p1.fill('#newImovelNome', 'Imovel da aba 1'); await p1.click('#btnSalvarImovel'); await p1.waitForTimeout(400);
    await p2.click('.tab-btn[data-tab="despesas"]'); await p2.fill('#despDescricao', 'Despesa da aba 2'); await p2.fill('#despValor', '99'); await p2.click('#btnSalvarDespesa'); await p2.waitForTimeout(500);
    const d = srv.lerDados();
    log('B imóvel aba 1 salvo?', d.imoveis.some(i => i.nome === 'Imovel da aba 1'), '| despesa aba 2 gravada?', d.despesas.some(x => x.descricao === 'Despesa da aba 2'), '| aviso conflito?', await p2.isVisible('#modalConflito'), '| indicador:', await p2.textContent('#statusGravacao'));
    await p2.click('#btnConflitoRecarregar'); await p2.waitForTimeout(500);
    await p2.click('.tab-btn[data-tab="imoveis"]'); log('B após recarregar aba 2 vê imóvel da aba 1?', (await p2.textContent('#imoveisList')).includes('Imovel da aba 1'));
    await ctx.close(); await srv.parar(); }
  // C
  { const srv = await subirServidor({ dados: gerarDados() }); const { page } = await novaPagina(browser, srv); await entrar(page, srv.url);
    let falhar = true;
    await page.route('**/api/data.php', async r => { if (r.request().method() === 'POST') { await new Promise(x => setTimeout(x, 400)); if (falhar) return r.fulfill({ status: 500, body: '{"ok":false,"error":"Disco cheio."}' }); } return r.continue(); });
    await page.click('.tab-btn[data-tab="despesas"]'); await page.fill('#despDescricao', 'Nunca salva'); await page.fill('#despValor', '10');
    await page.click('#btnSalvarDespesa'); await page.waitForTimeout(100);
    log('C durante gravação: botão desabilitado?', await page.isDisabled('#btnSalvarDespesa'), '| indicador:', await page.textContent('#statusGravacao'), '| toast sucesso:', JSON.stringify(await page.textContent('#toast')));
    await page.waitForTimeout(4000);
    log('C erro continua na tela após 4s?', await page.isVisible('#toastErro'), await page.textContent('#toastErroTexto'));
    falhar = false; await page.click('#toastErroAcao'); await page.waitForTimeout(800);
    log('C tentar de novo gravou?', srv.lerDados().despesas.some(x => x.descricao === 'Nunca salva'), '| toast:', await page.textContent('#toast'));
    await srv.parar(); }
  // D
  { const srv = await subirServidor({ dados: gerarDados() }); const { ctx, page } = await novaPagina(browser, srv); await entrar(page, srv.url);
    await ctx.clearCookies();
    await page.click('.tab-btn[data-tab="despesas"]'); await page.fill('#despDescricao', 'Feita com sessão expirada'); await page.fill('#despValor', '10'); await page.click('#btnSalvarDespesa'); await page.waitForTimeout(500);
    log('D pede login?', await page.isVisible('#modalSessao'), '| foco:', await page.evaluate(() => document.activeElement.id));
    await page.fill('#sessaoSenha', 'errada'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    log('D senha errada:', await page.textContent('#sessaoErro'));
    await page.fill('#sessaoSenha', '12345678'); await page.keyboard.press('Enter'); await page.waitForTimeout(800);
    log('D gravou depois de entrar?', srv.lerDados().despesas.some(x => x.descricao === 'Feita com sessão expirada'), '| continua em despesas?', await page.isVisible('#tab-despesas'), '| toast:', await page.textContent('#toast'));
    await srv.parar(); }
  await browser.close();
})();
