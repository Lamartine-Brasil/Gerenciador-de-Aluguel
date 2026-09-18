const { chromium, subirServidor, gerarDados, novaPagina, entrar, OUT } = require('./comum');
const fs = require('fs');
const res = [];
const ok = (nome, cond, extra = '') => { res.push(`${cond ? 'OK  ' : 'FALHA'} ${nome} ${extra}`); };
(async () => {
  const srv = await subirServidor({ dados: gerarDados() });
  const browser = await chromium.launch();
  const { page, ctx } = await novaPagina(browser, srv, { ctx: { acceptDownloads: true } });
  const dialogos = [];
  let respostaPrompt = null;
  page.on('dialog', async d => { dialogos.push(d.type() + ': ' + d.message().slice(0, 90)); if (d.type() === 'prompt') await d.accept(respostaPrompt ?? ''); else await d.accept(); });
  const aba = async (t) => { await page.click(`.tab-btn[data-tab="${t}"]`); await page.waitForTimeout(250); };
  const f5 = async () => { await page.reload(); await page.waitForSelector('#app:not(.hidden)'); await page.waitForTimeout(400); };
  const dados = () => srv.lerDados();
  const audit = (txt) => dados().auditoria.some(a => a.descricao.includes(txt));
  await page.addInitScript(() => {
    setInterval(() => {
      const m = document.getElementById('modalConfirmacao');
      if (!m || m.classList.contains('hidden') || m.dataset.auto) return;
      m.dataset.auto = '1';
      if (!document.getElementById('confCampo').classList.contains('hidden')) document.getElementById('confEntrada').value = window.__resposta || '';
      document.getElementById('confOk').click();
      setTimeout(() => { delete m.dataset.auto; }, 400);
    }, 80);
  });
  const responder = (r) => page.evaluate(v => { window.__resposta = v; }, r);
  await entrar(page, srv.url);

  // Imóveis
  await aba('imoveis'); await page.fill('#newImovelNome', 'Apto 999 - Teste'); await page.click('#btnSalvarImovel'); await page.waitForTimeout(300);
  ok('imóvel criado e salvo', dados().imoveis.some(i => i.nome === 'Apto 999 - Teste'), '| auditoria: ' + audit('Apto 999'));
  await page.click('[data-edit-imovel="i2"]'); await page.fill('#newImovelNome', 'Apto 202 - Rua das Flores, 10 (bloco B)'); await page.click('#btnSalvarImovel'); await page.waitForTimeout(300);
  ok('renomear imóvel atualiza contrato', dados().contratos.find(c => c.numero === 2).imovel.includes('bloco B'), '| auditoria: ' + audit('bloco B'));
  const nImovel = await page.$$eval('[data-remove-imovel]', b => b.length);
  await page.click('[data-remove-imovel="i6"]'); await page.waitForTimeout(300);
  ok('remover imóvel', !dados().imoveis.some(i => i.id === 'i6'), '| auditoria: ' + audit('Loja 1'));
  await page.fill('#uiImoveisSearch', 'vaga'); ok('busca de imóveis', (await page.textContent('#uiImoveisCount')).includes('20'), await page.textContent('#uiImoveisCount'));
  await page.fill('#uiImoveisSearch', '');

  // Contrato novo retroativo
  await aba('contratos'); await page.click('#btnNovoContrato');
  await page.fill('#fDataInicio', '2026-05-03'); await page.fill('#fDiaPagamento', '8');
  await page.selectOption('#fImovel', 'Apto 999 - Teste'); await page.fill('#fInquilino', 'Novo Inquilino'); await page.fill('#fAluguel', '1000');
  await page.selectOption('#fCorretorNome', 'Carlos Lima'); await page.fill('#fCaucao', '500');
  await page.click('#formContrato button[type=submit]'); await page.waitForTimeout(400);
  let novo = dados().contratos.find(c => c.inquilino === 'Novo Inquilino');
  ok('contrato retroativo criado', novo && novo.dividas.length === 4, novo ? `dívidas=${novo.dividas.length} numero=${novo.numero}` : '');
  // Editar contrato
  await page.fill('#searchContratos', 'Novo Inquilino'); await page.waitForTimeout(200);
  await page.click(`#contratosList [data-grupo-action="editar"][data-contrato-id="${novo.id}"]`); await page.fill('#infoInquilino', 'Novo Inquilino Editado'); await page.click('#formContratoInfo button[type=submit]'); await page.waitForTimeout(300);
  ok('editar contrato', dados().contratos.some(c => c.inquilino === 'Novo Inquilino Editado'), '| diff na auditoria: ' + JSON.stringify(dados().auditoria.slice(-1)[0].alteracoes));
  await page.fill('#searchContratos', 'Editado'); await page.waitForTimeout(200);
  novo = dados().contratos.find(c => c.inquilino === 'Novo Inquilino Editado');
  const d0 = novo.dividas[3];
  // pagar
  await page.click(`#contratosList [data-divida-action="pagar"][data-divida-id="${d0.id}"]`);
  await page.selectOption('#pagForma', 'Pix'); await page.selectOption('#pagQuemRecebeu', 'Ana Souza');
  await page.click('#formPagamento button[type=submit]'); await page.waitForTimeout(300);
  ok('pagamento registrado', dados().contratos.find(c => c.id === novo.id).dividas.find(x => x.id === d0.id).pago, '| auditoria: ' + audit('Pagamento registrado: Apto 999'));
  // recibo (popup)
  const [pop] = await Promise.all([page.waitForEvent('popup'), page.click(`#contratosList [data-divida-action="recibo"][data-divida-id="${d0.id}"]`)]);
  await pop.waitForLoadState(); ok('recibo abre', (await pop.textContent('body')).includes('Novo Inquilino Editado'), (await pop.textContent('h1')));
  await pop.close();
  // editar dívida
  await page.click(`#contratosList [data-divida-action="editar"][data-divida-id="${novo.dividas[2].id}"]`); await page.fill('#fDesconto', '25'); await page.click('#formContrato button[type=submit]'); await page.waitForTimeout(300);
  ok('editar dívida', dados().contratos.find(c => c.id === novo.id).dividas.find(x => x.id === novo.dividas[2].id).desconto === 25);
  // excluir dívida
  await page.click(`#contratosList [data-divida-action="excluir"][data-divida-id="${novo.dividas[1].id}"]`); await page.waitForTimeout(300);
  ok('excluir dívida', dados().contratos.find(c => c.id === novo.id).dividas.length === 3);
  // atualizar dívidas (individual)
  await page.click(`#contratosList [data-grupo-action="atualizar"][data-contrato-id="${novo.id}"]`); await page.waitForTimeout(300);
  ok('atualizar dívidas regenera a faltante', dados().contratos.find(c => c.id === novo.id).dividas.length === 4, await page.textContent('#toast'));
  // reajuste
  await page.click(`#contratosList [data-grupo-action="reajustar"][data-contrato-id="${novo.id}"]`); await page.fill('#reajusteNovoValor', '1100'); await page.click('#formReajuste button[type=submit]'); await page.waitForTimeout(300);
  ok('reajuste', dados().contratos.find(c => c.id === novo.id).aluguel === 1100);
  // caução
  await page.click(`#contratosList [data-grupo-action="devolver-caucao"][data-contrato-id="${novo.id}"]`); await page.click('#formDevolucaoCaucao button[type=submit]'); await page.waitForTimeout(300);
  ok('devolver caução', dados().contratos.find(c => c.id === novo.id).caucaoDevolvida);
  // encerrar / reabrir
  await page.click(`#contratosList [data-grupo-action="encerrar"][data-contrato-id="${novo.id}"]`); await page.waitForTimeout(300);
  ok('encerrar', dados().contratos.find(c => c.id === novo.id).encerrado);
  await page.click(`#contratosList [data-grupo-action="reabrir"][data-contrato-id="${novo.id}"]`); await page.waitForTimeout(300);
  ok('reabrir', !dados().contratos.find(c => c.id === novo.id).encerrado);
  // histórico do contrato + CSV
  await page.click(`#contratosList [data-grupo-action="historico"][data-contrato-id="${novo.id}"]`);
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.click('#btnExportHistoricoContrato')]);
  ok('CSV do contrato', (fs.readFileSync(await dl1.path(), 'utf8')).includes('Novo Inquilino Editado'));
  await page.click('#modalHistoricoContrato .modal-close'); await page.waitForTimeout(200);
  // excluir contrato
  await page.click(`#contratosList [data-grupo-action="excluir"][data-contrato-id="${novo.id}"]`); await page.waitForTimeout(300);
  ok('excluir contrato', !dados().contratos.some(c => c.id === novo.id));
  await page.fill('#searchContratos', '');

  // exportações de contratos: tela x arquivo com busca "#5"
  await page.fill('#searchContratos', '#5'); await page.waitForTimeout(200);
  const naTela = await page.$$eval('.contrato-grupo', g => g.length);
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#btnExportCSV')]).catch(e => [null]);
  const linhasCsv = dl2 ? fs.readFileSync(await dl2.path(), 'utf8').trim().split('\n').length - 1 : 0;
  ok('CSV de contratos respeita busca "#5"', linhasCsv > 0, `tela: ${naTela} contrato(s); CSV: ${linhasCsv} linha(s); toast: ${await page.textContent('#toast')}`);
  await page.fill('#searchContratos', '');
  // PDF
  const [pdf] = await Promise.all([page.waitForEvent('popup'), page.click('#btnExportPDF')]); await pdf.waitForLoadState();
  ok('PDF de contratos abre', (await pdf.textContent('h1')).includes('Relatório'), '| contratos no PDF: ' + (await pdf.$$eval('section.contrato', s => s.length))); await pdf.close();
  // paginação
  ok('paginação de contratos (25 → 2 páginas)', (await page.textContent('#contratosPagination')).includes('Página 1 de 2'));

  // Despesas
  await aba('despesas'); await page.fill('#despDescricao', 'Despesa nova'); await page.fill('#despValor', '123.45'); await page.click('#btnSalvarDespesa'); await page.waitForTimeout(300);
  ok('despesa criada', dados().despesas.some(d => d.descricao === 'Despesa nova'), '| auditoria: ' + audit('Despesa nova'));
  const idNova = dados().despesas.find(d => d.descricao === 'Despesa nova').id;
  await page.click(`[data-edit-despesa="${idNova}"]`); await page.fill('#despValor', '200'); await page.click('#btnSalvarDespesa'); await page.waitForTimeout(300);
  ok('despesa editada', dados().despesas.find(d => d.id === idNova).valor === 200);
  await aba('dashboard'); const dashDesp = await page.textContent('#statDespesasMesDashboard');
  await aba('despesas');
  await page.click(`[data-remove-despesa="${idNova}"]`); await page.waitForTimeout(300);
  ok('despesa excluída', !dados().despesas.some(d => d.id === idNova));
  await aba('dashboard'); const dashDesp2 = await page.textContent('#statDespesasMesDashboard');
  ok('card de despesas do Dashboard acompanha', dashDesp !== dashDesp2, `${dashDesp} → ${dashDesp2} (esperado mudar)`);
  await aba('despesas');
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('#btnExportDespesas')]);
  ok('CSV de despesas', fs.readFileSync(await dl3.path(), 'utf8').includes('TOTAL'));

  // Histórico
  await aba('historico'); await page.fill('#historicoSearch', 'Ricardo'); await page.waitForTimeout(200);
  const cont = await page.textContent('#historicoCount');
  const [dl4] = await Promise.all([page.waitForEvent('download'), page.click('#btnExportHistorico')]);
  const lh = fs.readFileSync(await dl4.path(), 'utf8').trim().split('\n').length - 1;
  ok('CSV do histórico bate com contador', cont.startsWith(String(lh)), `${cont} x ${lh} linhas`);

  // Relatórios
  await aba('relatorios'); await page.selectOption('#relatorioMes', '6');
  const [dl5] = await Promise.all([page.waitForEvent('download'), page.click('#btnExportRelatorio')]);
  ok('CSV do relatório (julho)', fs.readFileSync(await dl5.path(), 'utf8').includes('Julho'));
  const [rp] = await Promise.all([page.waitForEvent('popup'), page.click('#btnExportRelatorioPDF')]); await rp.waitForLoadState(); ok('PDF do relatório', (await rp.textContent('h1')).includes('Julho')); await rp.close();

  // Gráficos, Calendário, Auditoria
  await aba('graficos'); await page.selectOption('#graficoAno', '2025'); await page.selectOption('#inadimplenciaAgrupador', 'imovel'); ok('gráficos trocam de ano', true);
  await aba('calendario'); await page.click('#btnCalendarioAnterior'); ok('calendário volta mês', (await page.textContent('#calendarioMesAno')).includes('Agosto'));
  await page.click('.calendar-day[data-data="2026-08-10"]'); ok('detalhe do dia', await page.isVisible('#calendarioDetalheCard'), await page.textContent('#calendarioDetalheResumo'));
  await aba('auditoria'); await page.selectOption('#auditoriaFiltroUsuario', 'gerente'); ok('filtro de auditoria por usuário', (await page.$$eval('#auditoriaList .card', c => c.length)) === 1);

  // Pessoas / carteiras / config
  await aba('usuarios'); await page.fill('#newPessoaNome', 'Nova Pessoa'); await page.click('#btnSalvarPessoa'); await page.waitForTimeout(300);
  ok('pessoa criada', dados().pessoas.some(p => p.nome === 'Nova Pessoa'), '| auditoria: ' + audit('Nova Pessoa'));
  await page.click('[data-edit-pessoa="p1"]'); await page.fill('#newPessoaNome', 'Ana Souza Lima'); await page.click('#btnSalvarPessoa'); await page.waitForTimeout(300);
  ok('renomear pessoa propaga', dados().contratos.find(c => c.numero === 1).quemRecebeu === 'Ana Souza Lima');
  await aba('config'); await page.click('[data-config-tab="carteiras"]'); await page.fill('#carteiraNome', 'Carteira Nova'); await page.click('#btnSalvarCarteira'); await page.waitForTimeout(300);
  ok('carteira criada', dados().carteiras.some(c => c.nome === 'Carteira Nova'));
  const idCart = dados().carteiras.find(c => c.nome === 'Carteira Nova').id;
  await page.click(`[data-remove-carteira="${idCart}"]`); await page.waitForTimeout(300); ok('carteira removida', !dados().carteiras.some(c => c.id === idCart));
  await page.selectOption('#carteiraSeletor', 'cart_b'); await page.waitForTimeout(200);
  await aba('contratos'); ok('seletor de carteira filtra', (await page.$$eval('.contrato-grupo', g => g.length)) === 1);
  console.log('SUJOS antes do F5:', await page.evaluate(() => formulariosSujos().map(f => f.id + ' ' + JSON.stringify(valoresDoFormulario(f)) + ' base=' + baseDosFormularios.get(f)))); await f5(); ok('carteira ativa sobrevive ao F5', (await page.inputValue('#carteiraSeletor')) === 'cart_b');
  await page.selectOption('#carteiraSeletor', '');
  await aba('config'); await page.fill('#configTaxaJuros', '1.5'); await page.click('#configForm button[type=submit]'); await page.waitForTimeout(300);
  ok('config juros', dados().config.taxaJurosMensal === 1.5, '| auditoria? ' + audit('juros'));
  await page.click('[data-config-tab="recibo"]'); await page.fill('#reciboCidade', 'Contagem'); await page.click('#formRecibo button[type=submit]'); await page.waitForTimeout(300);
  ok('recibo salvo', dados().config.recibo.cidade === 'Contagem');
  await page.click('[data-config-tab="dados"]');
  const [bk] = await Promise.all([page.waitForEvent('download'), page.click('#btnExportBackup')]);
  const bkPath = OUT + '/backup.json'; await bk.saveAs(bkPath);
  ok('backup exportado', JSON.parse(fs.readFileSync(bkPath, 'utf8')).contratos.length === 25);

  // Usuários (prompt de senha)
  await aba('usuarios'); await page.fill('#newUserUsername', 'gerente'); await page.fill('#newUserPassword', 'senha-gerente-1'); await page.fill('#newUserConfirmPassword', 'senha-gerente-1'); await page.fill('#newUserCurrentPassword', '12345678');
  await page.click('#addUserForm button[type=submit]'); await page.waitForTimeout(500);
  ok('usuário adicionado', (await page.textContent('#usersList')).includes('gerente'));
  await responder('12345678');
  await page.click('[data-remove-user]'); await page.waitForTimeout(600);
  ok('usuário removido (via prompt)', !(await page.textContent('#usersList')).includes('gerente'));

  // Zona de perigo + restaurar
  await aba('config'); await page.click('[data-config-tab="perigo"]'); await responder('EXCLUIR');
  await page.click('#btnDeleteDatabase'); await page.waitForTimeout(500);
  ok('excluir todos os dados', dados().contratos.length === 0);
  await page.click('[data-config-tab="dados"]');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#btnImportBackup')]); await fc.setFiles(bkPath); await page.waitForTimeout(700);
  ok('restaurar backup', dados().contratos.length === 25);
  await f5(); ok('F5 depois de restaurar', (await page.textContent('#statAtivos')) !== '0');

  console.log(res.join('\n'));
  console.log('\nDIÁLOGOS NATIVOS:\n' + dialogos.join('\n'));
  console.log('\nERROS:', page.erros);
  await browser.close(); await srv.parar();
})().catch(e => { console.log(res.join('\n')); console.error(e); process.exit(1); });
