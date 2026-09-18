const { chromium, subirServidor, gerarDados, novaPagina, entrar, OUT } = require('./comum');
const log = (...a) => console.log(...a);
const ativo = (page) => page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return 'BODY'; return (a.id ? '#' + a.id : a.tagName.toLowerCase() + '.' + (a.className || '').toString().split(' ')[0]) + (a.closest('.modal-overlay') ? ' [modal]' : '') + (a.closest('.sidebar') ? ' [sidebar]' : ''); });
(async () => {
  const srv = await subirServidor({ dados: gerarDados() });
  const browser = await chromium.launch();
  const { page } = await novaPagina(browser, srv);
  await entrar(page, srv.url);

  // O: primeiro Tab
  await page.keyboard.press('Tab'); log('O primeiro Tab:', await ativo(page));
  let n = 1; while (!(await ativo(page)).includes('globalSearch') && n < 60) { await page.keyboard.press('Tab'); n++; }
  log('O Tabs até a busca do topo:', n);

  // I: modal
  await page.click('.tab-btn[data-tab="contratos"]');
  await page.focus('#btnNovoContrato'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  log('I foco ao abrir modal:', await ativo(page));
  const fora = [];
  for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); const a = await ativo(page); if (!a.includes('[modal]')) fora.push(a); }
  log('I tabs fora do modal (de 40):', fora.length, fora.slice(0, 3));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  log('I foco após Esc:', await ativo(page));
  const semNome = await page.$$eval('.modal-overlay', ms => ms.filter(m => !m.getAttribute('aria-labelledby') && !m.getAttribute('aria-label')).map(m => m.id));
  log('I modais sem nome:', semNome);
  // Esc com formulário preenchido
  await page.click('#btnNovoContrato'); await page.fill('#fInquilino', 'Texto digitado'); await page.keyboard.press('Escape');
  log('I Esc com texto digitado fecha sem aviso?', await page.isHidden('#modalContrato'));
  await page.click('#btnNovoContrato'); log('I reabrir mantém o texto?', await page.inputValue('#fInquilino'));
  await page.keyboard.press('Escape');

  // K: paginação e calendário
  await page.click('.tab-btn[data-tab="contratos"]');
  await page.focus('#btnPaginaProxima'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  log('K foco após "Próxima" (contratos):', await ativo(page), '| scrollY', await page.evaluate(() => scrollY));
  await page.click('.tab-btn[data-tab="calendario"]'); await page.waitForTimeout(200);
  await page.focus('.calendar-day[data-data="2026-09-10"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  log('K foco após escolher dia no calendário:', await ativo(page));
  await page.click('.tab-btn[data-tab="historico"]');
  await page.focus('#btnHistoricoProxima'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  log('K foco após "Próxima" (histórico):', await ativo(page));

  // L: menus do topo
  await page.focus('#uiNotifButton'); await page.keyboard.press('Enter'); await page.keyboard.press('ArrowDown');
  log('L foco após seta no menu de notificações:', await ativo(page));
  await page.keyboard.press('Escape'); log('L foco após Esc no menu:', await ativo(page));

  // M: abas de configurações
  const abasCfg = await page.$$eval('[data-config-tab]', b => b.map(x => ({ controls: x.getAttribute('aria-controls'), tabindex: x.getAttribute('tabindex') })));
  log('M abas config:', JSON.stringify(abasCfg[0]));

  // N: gráficos
  await page.click('.tab-btn[data-tab="graficos"]'); await page.waitForTimeout(300);
  log('N canvas focáveis / com nome:', await page.$$eval('canvas', cs => cs.map(c => (c.tabIndex >= 0 ? 'foco' : '-') + '/' + (c.getAttribute('aria-label') || c.getAttribute('role') || '-')).join(' ')));

  // P: regiões de anúncio
  log('P toast role/aria-live:', await page.$eval('#toast', t => [t.getAttribute('role'), t.getAttribute('aria-live')]), '| loginError:', await page.$eval('#loginError', t => [t.getAttribute('role'), t.getAttribute('aria-live')]));

  // Q: atalho N maiúsculo
  await page.click('.tab-btn[data-tab="dashboard"]'); await page.focus('body'); await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Shift+N'); await page.waitForTimeout(200);
  log('Q "N" maiúsculo abre novo contrato?', await page.isVisible('#modalContrato'));
  await page.keyboard.press('n'); await page.waitForTimeout(200);
  log('Q "n" minúsculo abre?', await page.isVisible('#modalContrato')); await page.keyboard.press('Escape');

  // R: botões de linha iguais
  await page.click('.tab-btn[data-tab="atrasos"]');
  const nomes = await page.$$eval('#atrasosList [aria-label]', b => b.map(x => x.getAttribute('aria-label')));
  log('R nomes de botões em Atrasos (amostra):', nomes.slice(0, 6), 'distintos:', new Set(nomes).size, 'de', nomes.length);

  // T: scroll-padding
  log('T scroll-padding-top:', await page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingTop));

  // S: sidebar recolhida
  await page.click('#uiSidebarToggle'); await page.waitForTimeout(400);
  const snap = await page.locator('#tabsNav').ariaSnapshot();
  log('S nomes com sidebar recolhida:\n' + snap.split('\n').slice(0, 5).join('\n'));
  await page.click('#uiSidebarToggle');

  // J: gaveta em 900px
  await page.setViewportSize({ width: 900, height: 800 }); await page.waitForTimeout(300);
  await page.evaluate(() => document.activeElement.blur()); await page.focus('#uiDrawerToggle');
  const naGaveta = [];
  for (let i = 0; i < 25; i++) { await page.keyboard.press('Shift+Tab'); const a = await ativo(page); if (a.includes('[sidebar]')) naGaveta.push(a); }
  log('J focos na gaveta FECHADA (25 Shift+Tab):', naGaveta.length);
  await browser.close(); await srv.parar();
})();
