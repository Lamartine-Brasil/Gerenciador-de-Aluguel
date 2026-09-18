const { chromium, subirServidor, gerarDados, novaPagina, entrar } = require('./comum');
const log = (...a) => console.log(...a);
const estado = (page) => page.evaluate(() => ({ url: location.hash, titulo: document.title, painel: (document.querySelector('.tab-panel.active') || {}).id, h1: (document.querySelector('.tab-panel.active h1') || {}).textContent, atual: (document.querySelector('[aria-current="page"].tab-btn') || {}).textContent, foco: document.activeElement.tagName + (document.activeElement.id ? '#' + document.activeElement.id : '') }));
(async () => {
  const srv = await subirServidor({ dados: gerarDados() });
  const browser = await chromium.launch();
  const { page, ctx } = await novaPagina(browser, srv);
  await entrar(page, srv.url);
  log('início', JSON.stringify(await estado(page)));
  const rotas = ['#/', '#/imoveis?busca=vaga&pagina=2', '#/contratos?busca=%2312&status=atrasado', '#/contratos?pagina=2', '#/atrasos', '#/historico?busca=Ricardo&ano=2025&pagina=2', '#/historico?contrato=5', '#/despesas?ano=2025&mes=4', '#/despesas?pagina=2', '#/graficos?ano=2025&agrupar=imovel', '#/relatorios?ano=2025&mes=7', '#/calendario?mes=2026-08&dia=2026-08-10', '#/auditoria?usuario=gerente&mes=8', '#/usuarios', '#/configuracoes', '#/configuracoes/recibo', '#/configuracoes/perigo', '#/nada', '#/contratos?status=xyz&pagina=-3&foo=1', '#/calendario?mes=2026-13&dia=abc'];
  for (const r of rotas) {
    await page.goto(srv.url + r); await page.waitForSelector('#app:not(.hidden)'); await page.waitForTimeout(300);
    const e1 = await estado(page);
    await page.reload(); await page.waitForSelector('#app:not(.hidden)'); await page.waitForTimeout(300);
    const e2 = await estado(page);
    const extra = await page.evaluate(() => ({
      contratos: document.querySelectorAll('#contratosList .contrato-grupo').length,
      pagC: (document.querySelector('#contratosPagination .pagination-info') || {}).textContent,
      pagH: (document.querySelector('#historicoPagination .pagination-info') || {}).textContent,
      pagI: (document.querySelector('#uiImoveisPagination .pagination-info') || {}).textContent,
      histCont: document.getElementById('historicoCount').textContent,
      calTit: document.getElementById('calendarioDetalheTitulo').textContent,
      secao: (document.querySelector('[data-config-section].is-active') || {}).dataset?.configSection,
      desp: document.getElementById('statDespesaFiltro').textContent,
    }));
    log(`${r}\n   → ${e2.url} | ${e2.titulo} | ${e2.painel} | h1=${e2.h1} | menu=${e2.atual} | foco=${e2.foco} | F5 igual? ${JSON.stringify(e1) === JSON.stringify(e2)}`);
    if (/contratos/.test(r)) log('     contratos:', extra.contratos, extra.pagC);
    if (/historico/.test(r)) log('     histórico:', extra.histCont, extra.pagH);
    if (/imoveis/.test(r)) log('     imóveis:', extra.pagI);
    if (/calendario/.test(r)) log('     calendário:', extra.calTit);
    if (/configuracoes/.test(r)) log('     seção:', extra.secao);
    if (/despesas/.test(r)) log('     despesas:', extra.desp);
  }
  // Voltar / Avançar
  await page.goto(srv.url + '#/'); await page.waitForTimeout(300);
  await page.click('.tab-btn[data-tab="contratos"]'); await page.waitForTimeout(200);
  await page.selectOption('#filterStatus', 'pago'); await page.fill('#searchContratos', 'vaga'); await page.waitForTimeout(200);
  await page.click('.tab-btn[data-tab="despesas"]'); await page.waitForTimeout(200);
  log('\nclique no menu: foco', (await estado(page)).foco, '| url', (await estado(page)).url);
  await page.goBack(); await page.waitForTimeout(300); log('voltar →', (await estado(page)).url, '| filtro status:', await page.inputValue('#filterStatus'));
  await page.goBack(); await page.waitForTimeout(300); log('voltar →', (await estado(page)).url);
  await page.goForward(); await page.waitForTimeout(300); log('avançar →', (await estado(page)).url);
  // Voltar com modal aberto
  await page.click('#btnNovoContrato'); await page.waitForTimeout(200);
  await page.goBack(); await page.waitForTimeout(400); log('voltar com modal: modal fechado?', await page.isHidden('#modalContrato'), '| url', (await estado(page)).url);
  // busca do topo
  await page.click('.tab-btn[data-tab="atrasos"]'); await page.waitForTimeout(200);
  const antes = await page.evaluate(() => history.length);
  await page.click('#globalSearch'); await page.keyboard.type('Maria'); await page.waitForTimeout(300);
  log('busca do topo:', (await estado(page)).url, '| history cresceu:', (await page.evaluate(() => history.length)) - antes, '| foco:', (await estado(page)).foco);
  // formulário sujo ao trocar de tela
  await page.click('.tab-btn[data-tab="despesas"]'); await page.fill('#despDescricao', 'rascunho');
  await page.click('.tab-btn[data-tab="imoveis"]'); await page.waitForTimeout(200);
  log('sair com formulário sujo pergunta?', await page.isVisible('#modalConfirmacao'), await page.textContent('#confTitulo'));
  await page.click('#confCancelar'); await page.waitForTimeout(200); log('continuar editando: url', (await estado(page)).url, '| texto', await page.inputValue('#despDescricao'));
  // links do menu
  log('hrefs:', await page.$$eval('#tabsNav a', a => a.map(x => x.getAttribute('href')).join(' ')));
  // deslogado → login → tela pedida
  const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage();
  await p2.goto(srv.url + '#/relatorios?ano=2025'); await p2.waitForTimeout(400);
  log('\ndeslogado: login visível?', await p2.isVisible('#loginScreen'), '| url', await p2.evaluate(() => location.hash));
  await p2.fill('#loginUser', 'admin'); await p2.fill('#loginPass', '12345678'); await p2.click('#loginForm button[type=submit]'); await p2.waitForTimeout(700);
  log('depois de entrar:', JSON.stringify(await estado(p2)), '| ano', await p2.inputValue('#relatorioAno'));
  log('ERROS', page.erros, p2.erros);
  await browser.close(); await srv.parar();
})();
