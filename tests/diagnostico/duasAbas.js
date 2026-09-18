const { chromium, subirServidor, gerarDados } = require('./comum');
(async () => {
  const srv = await subirServidor({ dados: gerarDados() });
  const antes = srv.lerDados().contratos.reduce((s, c) => s + c.dividas.length, 0);
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  // entra uma vez para ter o cookie
  const p0 = await ctx.newPage(); await p0.goto(srv.url);
  await p0.request.post(srv.url + 'api/login.php', { data: { username: 'admin', password: '12345678' } });
  await p0.close();
  const abrir = async (atraso) => {
    const p = await ctx.newPage();
    await p.clock.setFixedTime(new Date('2026-10-21T09:00:00'));
    await p.route('**/api/data.php', async r => { if (r.request().method() === 'POST') await new Promise(x => setTimeout(x, atraso)); r.continue(); });
    await p.goto(srv.url);
    return p;
  };
  const [a, b] = await Promise.all([abrir(900), abrir(0)]);
  await a.waitForSelector('#app:not(.hidden)'); await b.waitForSelector('#app:not(.hidden)');
  await a.waitForTimeout(2500);
  const d = srv.lerDados();
  const depois = d.contratos.reduce((s, c) => s + c.dividas.length, 0);
  const dup = d.contratos.filter(c => new Set(c.dividas.map(x => x.vencimento)).size !== c.dividas.length).length;
  const lotes = d.auditoria.filter(x => x.descricao.startsWith('Atualização em lote')).length;
  console.log(`dívidas antes ${antes}, depois ${depois} (+${depois - antes}) | contratos com vencimento repetido: ${dup} | eventos de atualização em lote: ${lotes} | versão: ${d.versao}`);
  console.log('conflito visível em alguma aba?', await a.isVisible('#modalConflito'), await b.isVisible('#modalConflito'));
  const c4 = d.contratos.find(c => c.numero === 4); console.log('#4 vencimentos:', c4.dividas.map(x => x.vencimento).join(','));
  await browser.close(); await srv.parar();
})();
