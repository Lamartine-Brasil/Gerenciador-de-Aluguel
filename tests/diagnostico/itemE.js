const { gerarDados } = require('./comum');
const { spawn } = require('child_process'); const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'alug-e-')); const dd = path.join(base, 'data'); fs.mkdirSync(dd);
  const dados = gerarDados(); // aumenta o arquivo para ~4MB
  for (let i = 0; i < 40; i++) dados.despesas.push(...gerarDados().despesas.map(d => ({ ...d, id: d.id + '_' + i, descricao: 'x'.repeat(2000) })));
  fs.writeFileSync(path.join(dd, 'dados.json'), JSON.stringify(dados));
  const porta = 18000 + Math.floor(Math.random() * 1000);
  const p = spawn('php', ['-S', '127.0.0.1:' + porta, '-t', require('path').resolve(__dirname, '..', '..')], { env: { ...process.env, PHP_CLI_SERVER_WORKERS: '6', ALUGUEL_DATA_DIR: dd, ALUGUEL_CONTRATOS_DIR: base }, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const payload = `admin|${Math.floor(Date.now()/1000) + 86400}`;
  const sig = crypto.createHmac('sha256', 'x7K9pQ2mZ4rL8vN1sT6wA3yB5cD0eF-troque-esta-chave').update(payload).digest('hex');
  const H = { Cookie: `aluguel_auth=${Buffer.from(payload).toString('base64')}.${sig}`, 'Content-Type': 'application/json' };
  const url = `http://127.0.0.1:${porta}/api/data.php`;
  const corpo = JSON.stringify(dados);
  console.log('tamanho', (corpo.length / 1e6).toFixed(1), 'MB');
  let ruins = 0, total = 0;
  const escritas = Array.from({ length: 30 }, () => fetch(url, { method: 'POST', headers: H, body: corpo }));
  const leituras = Array.from({ length: 120 }, async (_, i) => { await new Promise(r => setTimeout(r, i * 5)); const t = await (await fetch(url, { headers: H })).text(); total++; try { JSON.parse(t); } catch { ruins++; } });
  await Promise.all([...escritas, ...leituras]);
  console.log(`E leituras com JSON quebrado: ${ruins} de ${total}`);
  p.kill(); fs.rmSync(base, { recursive: true, force: true });
})();
