const { subirServidor, gerarDados } = require('./comum');
const crypto = require('crypto'); const fs = require('fs');
(async () => {
  const srv = await subirServidor({ dados: gerarDados() });
  const payload = `admin|${Math.floor(Date.now()/1000) + 86400}`;
  const sig = crypto.createHmac('sha256', 'x7K9pQ2mZ4rL8vN1sT6wA3yB5cD0eF-troque-esta-chave').update(payload).digest('hex');
  const forjado = `aluguel_auth=${Buffer.from(payload).toString('base64')}.${sig}`;
  let r = await fetch(srv.url + 'api/data.php', { headers: { Cookie: forjado } });
  console.log('F cookie forjado:', r.status, JSON.stringify(await r.json()));
  console.log('arquivo da chave criado:', fs.existsSync(srv.dataDir + '/cookie_secret.php'));
  const login = async () => { const r = await fetch(srv.url + 'api/login.php', { method: 'POST', body: JSON.stringify({ username: 'admin', password: '12345678' }) }); return r.headers.get('set-cookie').split(';')[0]; };
  const a = await login(), b = await login();
  r = await fetch(srv.url + 'api/regenerate_secret.php', { method: 'POST', headers: { Cookie: a }, body: JSON.stringify({ currentPassword: '12345678' }) });
  const novo = r.headers.get('set-cookie').split(';')[0];
  console.log('regenerar:', r.status, await r.json());
  const s = async c => (await (await fetch(srv.url + 'api/session.php', { headers: { Cookie: c } })).json()).authenticated;
  console.log('quem gerou continua:', await s(novo), '| outro acesso desconectado:', !(await s(b)));
  await srv.parar();
})();
