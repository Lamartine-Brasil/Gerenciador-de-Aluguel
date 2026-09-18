const { chromium, subirServidor, gerarDados, novaPagina, entrar } = require('./comum');
const ativo = (page) => page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return 'BODY'; return (a.id ? '#' + a.id : a.tagName.toLowerCase() + '[' + (a.getAttribute('aria-label') || a.textContent.trim().slice(0, 25)) + ']') + (a.closest('.modal-overlay') ? ' [' + a.closest('.modal-overlay').id + ']' : ''); });
(async () => {
  const srv = await subirServidor({ dados: gerarDados() });
  const browser = await chromium.launch();
  const { page } = await novaPagina(browser, srv);
  page.on('dialog', d => { console.log('!! diálogo nativo', d.message()); d.dismiss(); });
  await entrar(page, srv.url);
  await page.click('.tab-btn[data-tab="contratos"]');
  await page.focus('#btnNovoContrato'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  console.log('foco ao abrir:', await ativo(page));
  let fora = 0; for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if (!(await ativo(page)).includes('[modalContrato]')) fora++; }
  console.log('tabs fora do modal:', fora);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  console.log('Esc sem alteração fecha?', await page.isHidden('#modalContrato'), '| foco:', await ativo(page));
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  await page.fill('#fInquilino', 'digitado'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  console.log('Esc com texto: pergunta?', await page.isVisible('#modalConfirmacao'), await page.textContent('#confTitulo'), '| foco:', await ativo(page));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  console.log('Esc no diálogo: volta ao formulário?', await page.isVisible('#modalContrato'), await page.inputValue('#fInquilino'), '| foco:', await ativo(page));
  await page.click('#modalContrato .modal-close'); await page.waitForTimeout(150); await page.click('#confOk'); await page.waitForTimeout(200);
  console.log('× + Descartar fecha?', await page.isHidden('#modalContrato'), '| foco:', await ativo(page));
  // excluir dívida
  const btn = page.locator('#contratosList [data-divida-action="excluir"]').first();
  await btn.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  console.log('excluir dívida:', await page.textContent('#confTitulo'), '| botão:', await page.textContent('#confOk'), '| foco inicial:', await ativo(page));
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  console.log('Enter em Cancelar mantém?', await page.isHidden('#modalConfirmacao'), '| foco:', await ativo(page));
  // remover usuário com senha errada
  await page.click('.tab-btn[data-tab="usuarios"]');
  await page.fill('#newUserUsername', 'gerente'); await page.fill('#newUserPassword', 'abcdefgh1'); await page.fill('#newUserConfirmPassword', 'abcdefgh1'); await page.fill('#newUserCurrentPassword', '12345678');
  await page.click('#addUserForm button[type=submit]'); await page.waitForTimeout(500);
  await page.click('[data-remove-user]'); await page.waitForTimeout(200);
  console.log('campo de senha:', await page.getAttribute('#confEntrada', 'type'), '| rótulo:', await page.textContent('#confRotulo'));
  await page.fill('#confEntrada', 'errada'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  console.log('senha errada:', await page.textContent('#confErro'), '| ainda aberto?', await page.isVisible('#modalConfirmacao'));
  await page.fill('#confEntrada', '12345678'); await page.keyboard.press('Enter'); await page.waitForTimeout(700);
  console.log('removido?', !(await page.textContent('#usersList')).includes('gerente'), '| toast:', await page.textContent('#toast'));
  console.log('ERROS', page.erros);
  await browser.close(); await srv.parar();
})();
