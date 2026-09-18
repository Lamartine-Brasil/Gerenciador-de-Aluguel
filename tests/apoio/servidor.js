'use strict';

/* Sobe o sistema com `php -S` numa porta livre, apontando para uma pasta de
 * dados temporária — os testes nunca tocam em data/ nem em contratos/ reais.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');

function portaLivre() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function esperarNoAr(url, tentativas = 50) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const res = await fetch(url + 'api/session.php');
      if (res.ok) return;
    } catch (e) { /* ainda subindo */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('O servidor PHP não respondeu a tempo.');
}

/**
 * @param {{ dados?: object | null, subpasta?: string }} opcoes
 *   dados: conteúdo de dados.json (null = instalação vazia, primeiro acesso)
 *   subpasta: serve o sistema dentro de uma subpasta (ex: 'aluguel/')
 */
async function subirServidor({ dados = null, subpasta = '' } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aluguel-teste-'));
  const dataDir = path.join(base, 'data');
  const contratosDir = path.join(base, 'contratos');
  fs.mkdirSync(dataDir);
  fs.mkdirSync(contratosDir);
  if (dados) fs.writeFileSync(path.join(dataDir, 'dados.json'), JSON.stringify(dados, null, 2));

  // Em subpasta: um diretório-raiz temporário com um link para o projeto.
  let docRoot = RAIZ;
  if (subpasta) {
    docRoot = path.join(base, 'www');
    fs.mkdirSync(docRoot);
    fs.symlinkSync(RAIZ, path.join(docRoot, subpasta.replace(/\/$/, '')));
  }

  const porta = await portaLivre();
  const proc = spawn('php', ['-S', `127.0.0.1:${porta}`, '-t', docRoot], {
    env: { ...process.env, ALUGUEL_DATA_DIR: dataDir, ALUGUEL_CONTRATOS_DIR: contratosDir },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let log = '';
  proc.stderr.on('data', (b) => { log += b.toString(); });

  const url = `http://127.0.0.1:${porta}/${subpasta}`;
  await esperarNoAr(url);

  return {
    url,
    dataDir,
    contratosDir,
    log: () => log,
    lerDados: () => JSON.parse(fs.readFileSync(path.join(dataDir, 'dados.json'), 'utf8')),
    escreverDados: (obj) => fs.writeFileSync(path.join(dataDir, 'dados.json'), JSON.stringify(obj, null, 2)),
    async parar() {
      proc.kill();
      await new Promise(r => setTimeout(r, 50));
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

module.exports = { subirServidor, RAIZ };
