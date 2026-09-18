const { chromium, subirServidor, gerarDados, novaPagina, entrar } = require('./comum');
const crypto = require('crypto');
const log = (...a) => console.log(...a);
(async () => {
  const browser = await chromium.launch();

  // ---------- A: falha ao carregar ----------
  {
    const srv = await subirServidor({ dados: gerarDados() });
    const { page } = await novaPagina(browser, srv);
    let falhar = true;
    await page.route('**/api/data.php', r => (r.request().method() === 'GET' && falhar) ? r.fulfill({ status: 500, body: 'erro' }) : r.continue());
    await entrar(page, srv.url);
    log('A toast:', await page.textContent('#toast'));
    falhar = false;
    await page.click('.tab-btn[data-tab="imoveis"]');
    await page.fill('#newImovelNome', 'Imovel qualquer');
    await page.click('#btnSalvarImovel');
    await page.waitForTimeout(500);
    const d = srv.lerDados();
    log('A depois de gravar: contratos=', d.contratos.length, 'imoveis=', d.imoveis.length, 'despesas=', d.despesas.length);
    await srv.parar();
  }

  // ---------- B: duas abas ----------
  {
    const srv = await subirServidor({ dados: gerarDados() });
    const { ctx, page: p1 } = await novaPagina(browser, srv);
    await entrar(p1, srv.url);
    const p2 = await ctx.newPage(); await p2.clock.setFixedTime(new Date('2026-09-17T12:00:00'));
    await p2.goto(srv.url); await p2.waitForSelector('#app:not(.hidden)'); await p2.waitForTimeout(400);
    await p1.click('.tab-btn[data-tab="imoveis"]'); await p1.fill('#newImovelNome', 'Imovel da aba 1'); await p1.click('#btnSalvarImovel'); await p1.waitForTimeout(400);
    await p2.click('.tab-btn[data-tab="despesas"]'); await p2.fill('#despDescricao', 'Despesa da aba 2'); await p2.fill('#despValor', '99'); await p2.click('#btnSalvarDespesa'); await p2.waitForTimeout(400);
    const d = srv.lerDados();
    log('B imovel aba1 salvo?', d.imoveis.some(i => i.nome === 'Imovel da aba 1'), '| despesa aba2 salva?', d.despesas.some(x => x.descricao === 'Despesa da aba 2'));
    await ctx.close(); await srv.parar();
  }

  // ---------- C: sucesso antes de salvar ----------
  {
    const srv = await subirServidor({ dados: gerarDados() });
    const { page } = await novaPagina(browser, srv);
    await entrar(page, srv.url);
    await page.route('**/api/data.php', r => r.request().method() === 'POST' ? r.fulfill({ status: 500, body: '{}' }) : r.continue());
    await page.click('.tab-btn[data-tab="despesas"]');
    await page.fill('#despDescricao', 'Nunca salva'); await page.fill('#despValor', '10');
    await page.click('#btnSalvarDespesa');
    await page.waitForTimeout(80);
    log('C toast imediato:', await page.textContent('#toast'));
    await page.waitForTimeout(600);
    log('C toast depois:', await page.textContent('#toast'));
    await page.waitForTimeout(2600);
    log('C toast visível após 3,2s?', await page.isVisible('#toast'));
    log('C gravou?', srv.lerDados().despesas.some(x => x.descricao === 'Nunca salva'));
    // envio duplo
    await page.unroute('**/api/data.php');
    await page.route('**/api/data.php', async r => { if (r.request().method() === 'POST') await new Promise(x => setTimeout(x, 800)); r.continue(); });
    await page.click('.tab-btn[data-tab="contratos"]');
    await page.click('#btnNovoContrato');
    await page.selectOption('#fImovel', { label: 'Loja 1 - Rua Nova, 7' });
    await page.fill('#fInquilino', 'Duplo Clique'); await page.fill('#fAluguel', '1000');
    await page.fill('#fDataInicio', '2026-09-10');
    await page.dblclick('#formContrato button[type=submit]');
    await page.waitForTimeout(2000);
    log('C contratos "Duplo Clique":', srv.lerDados().contratos.filter(c => c.inquilino === 'Duplo Clique').length);
    await srv.parar();
  }

  // ---------- D: sessão expirada ----------
  {
    const srv = await subirServidor({ dados: gerarDados() });
    const { ctx, page } = await novaPagina(browser, srv);
    await entrar(page, srv.url);
    await ctx.clearCookies();
    await page.click('.tab-btn[data-tab="despesas"]');
    await page.fill('#despDescricao', 'Feita com sessão expirada'); await page.fill('#despValor', '10');
    await page.click('#btnSalvarDespesa');
    await page.waitForTimeout(500);
    log('D toast:', await page.textContent('#toast'), '| login visível?', await page.isVisible('#loginScreen'));
    await srv.parar();
  }

  // ---------- F: cookie forjado com a chave pública ----------
  {
    const srv = await subirServidor({ dados: gerarDados() });
    const payload = `admin|${Math.floor(Date.now()/1000) + 86400}`;
    const sig = crypto.createHmac('sha256', 'x7K9pQ2mZ4rL8vN1sT6wA3yB5cD0eF-troque-esta-chave').update(payload).digest('hex');
    const cookie = `aluguel_auth=${Buffer.from(payload).toString('base64')}.${sig}`;
    const r = await fetch(srv.url + 'api/data.php', { headers: { Cookie: cookie } });
    const j = await r.json();
    log('F status sem senha:', r.status, '| contratos lidos:', (j.contratos || []).length);
    await srv.parar();
  }
  await browser.close();
})();
