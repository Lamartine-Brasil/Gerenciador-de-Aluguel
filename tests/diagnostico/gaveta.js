const { chromium, subirServidor, gerarDados, novaPagina, entrar } = require('./comum');
const ativo = (page) => page.evaluate(() => { const a = document.activeElement; return (a.id ? '#' + a.id : a.tagName + '[' + (a.getAttribute('aria-label') || a.textContent.trim().slice(0, 20)) + ']') + (a.closest('.sidebar') ? ' [sidebar]' : ''); });
(async () => {
  const srv = await subirServidor({ dados: gerarDados() });
  const browser = await chromium.launch();
  const { page } = await novaPagina(browser, srv, { viewport: { width: 900, height: 800 } });
  await entrar(page, srv.url);
  await page.keyboard.press('Tab'); console.log('1º Tab:', await ativo(page));
  await page.keyboard.press('Enter'); await page.waitForTimeout(200); console.log('pular → foco', await ativo(page));
  let naGaveta = 0; await page.focus('#uiDrawerToggle');
  for (let i = 0; i < 25; i++) { await page.keyboard.press('Shift+Tab'); if ((await ativo(page)).includes('[sidebar]')) naGaveta++; }
  console.log('gaveta fechada, paradas na gaveta:', naGaveta);
  await page.focus('#uiDrawerToggle'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  console.log('abriu gaveta → foco', await ativo(page));
  let fora = 0; for (let i = 0; i < 20; i++) { await page.keyboard.press('Tab'); if (!(await ativo(page)).includes('[sidebar]')) fora++; }
  console.log('gaveta aberta, Tabs fora dela:', fora);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200); console.log('Esc → foco', await ativo(page), '| fechada?', !(await page.evaluate(() => document.documentElement.dataset.drawer)));
  await page.keyboard.press('Enter'); await page.waitForTimeout(200); await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  console.log('escolheu item → url', await page.evaluate(() => location.hash), '| foco', await ativo(page), '| gaveta fechada?', !(await page.evaluate(() => document.documentElement.dataset.drawer)));
  // menu do usuário
  await page.setViewportSize({ width: 1300, height: 800 });
  await page.focus('#uiUserButton'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  console.log('menu aberto?', await page.isVisible('#uiUserDropdown'), '| aria-expanded', await page.getAttribute('#uiUserButton', 'aria-expanded'), '| nome:', await page.evaluate(() => document.getElementById('uiUserButton').textContent.replace(/\s+/g, ' ').trim()));
  await page.keyboard.press('Tab'); console.log('Tab →', await ativo(page));
  await page.keyboard.press('Escape'); console.log('Esc → foco', await ativo(page), '| fechado?', await page.isHidden('#uiUserDropdown'));
  await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  console.log('item Configurações → url', await page.evaluate(() => location.hash), '| menu fechado?', await page.isHidden('#uiUserDropdown'));
  console.log(page.erros);
  await browser.close(); await srv.parar();
})();
