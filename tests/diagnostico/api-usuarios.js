const { subirServidor, gerarDados } = require('./comum');
(async () => {
  const srv = await subirServidor({ dados: gerarDados() });
  let cookie = '';
  const req = async (p, body) => { const r = await fetch(srv.url + 'api/' + p, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return [r.status, await r.json()]; };
  console.log('login', await req('login.php', { username: 'admin', password: '12345678' }));
  console.log('add', await req('users.php', { action: 'add', username: 'gerente', password: 'abcdefgh', currentPassword: '12345678' }));
  console.log('add dup', await req('users.php', { action: 'add', username: 'GERENTE', password: 'abcdefgh', currentPassword: '12345678' }));
  const [, l] = await req('users.php'); console.log('lista', l.users.map(u => u.username));
  console.log('remove', await req('users.php', { action: 'remove', id: l.users[1].id, currentPassword: '12345678' }));
  console.log('conta senha errada', await req('account.php', { currentPassword: 'x', newUsername: 'admin2', newPassword: '' }));
  console.log('conta', await req('account.php', { currentPassword: '12345678', newUsername: 'admin2', newPassword: 'novasenha1' }));
  console.log('sessão', await req('session.php'));
  for (let i = 0; i < 6; i++) await req('login.php', { username: 'x', password: 'y' });
  console.log('bloqueio', await req('login.php', { username: 'admin2', password: 'novasenha1' }));
  await srv.parar();
})();
