'use strict';

const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect, gerarDados } = require('../apoio/fixtures');
const { RAIZ } = require('../apoio/servidor');

const CHAVE_PUBLICA_ANTIGA = 'x7K9pQ2mZ4rL8vN1sT6wA3yB5cD0eF-troque-esta-chave';

function cookieForjado(chave, usuario = 'admin') {
  const payload = `${usuario}|${Math.floor(Date.now() / 1000) + 86400}`;
  const assinatura = crypto.createHmac('sha256', chave).update(payload).digest('hex');
  return `aluguel_auth=${Buffer.from(payload).toString('base64')}.${assinatura}`;
}

test.describe('Proteção dos dados', () => {
  test('A · falha ao carregar não abre o sistema e não grava nada', async ({ page, app, servidor }) => {
    let falhar = true;
    let posts = 0;
    await page.route('**/api/data.php', (r) => {
      if (r.request().method() === 'POST') posts++;
      if (r.request().method() === 'GET' && falhar) return r.fulfill({ status: 500, body: '{"ok":false,"error":"Falha simulada."}' });
      return r.continue();
    });
    const antes = servidor.lerDados();
    await page.request.post(servidor.url + 'api/login.php', { data: { username: 'admin', password: '12345678' } });
    await page.goto(servidor.url + '#/imoveis');
    await expect(page.locator('#telaErroCarga')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    await expect(page.locator('#erroCargaDetalhe')).toContainText('Falha simulada');
    expect(posts).toBe(0);
    expect(servidor.lerDados()).toEqual(antes);

    falhar = false;
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.locator('#tab-imoveis')).toBeVisible();
  });

  test('A · o servidor recusa gravação sem a versão em que ela se baseou', async ({ page, app, servidor }) => {
    await app.entrar('#/');
    const res = await page.request.post(servidor.url + 'api/data.php', {
      data: { contratos: [], config: {} },
    });
    expect(res.status()).toBe(400);
    expect(servidor.lerDados().contratos.length).toBe(25);
  });

  test('B · conflito entre duas abas: a segunda não apaga o que a primeira salvou', async ({ page, context, app, servidor }) => {
    await app.entrar('#/imoveis');
    const aba2 = await context.newPage();
    await aba2.clock.setFixedTime(new Date('2026-09-17T12:00:00'));
    await aba2.goto(servidor.url + '#/despesas');
    await expect(aba2.locator('#tab-despesas')).toBeVisible();

    await page.locator('#newImovelNome').fill('Imóvel da aba 1');
    await page.locator('#btnSalvarImovel').click();
    await expect(page.locator('#toast')).toContainText('Imóvel adicionado');

    await aba2.locator('#despDescricao').fill('Despesa da aba 2');
    await aba2.locator('#despValor').fill('99');
    await aba2.locator('#btnSalvarDespesa').click();
    await expect(aba2.locator('#modalConflito')).toBeVisible();
    await expect(aba2.locator('#modalConflito')).toContainText('alterados em outra aba ou por outro usuário');
    await expect(aba2.locator('#statusGravacao')).toHaveText('Não salvo');

    const gravado = servidor.lerDados();
    expect(gravado.imoveis.some(i => i.nome === 'Imóvel da aba 1')).toBeTruthy();
    expect(gravado.despesas.some(d => d.descricao === 'Despesa da aba 2')).toBeFalsy();

    await aba2.getByRole('button', { name: 'Carregar os dados atuais' }).click();
    await expect(aba2.locator('#modalConflito')).toBeHidden();
    await aba2.evaluate(() => { location.hash = '#/imoveis?busca=aba%201'; });
    await expect(aba2.locator('#imoveisList')).toContainText('Imóvel da aba 1');
  });

  test('B · duas abas abertas no dia de dívidas novas não duplicam nem perdem dívidas', async ({ context, servidor }) => {
    const antes = servidor.lerDados().contratos.reduce((s, c) => s + c.dividas.length, 0);
    const login = await context.request.post(servidor.url + 'api/login.php', { data: { username: 'admin', password: '12345678' } });
    expect(login.ok()).toBeTruthy();
    const abrir = async (atraso) => {
      const p = await context.newPage();
      // um mês depois: todos os contratos em andamento ganham dívida nova
      await p.clock.setFixedTime(new Date('2026-10-21T09:00:00'));
      await p.route('**/api/data.php', async (r) => {
        if (r.request().method() === 'POST') await new Promise(x => setTimeout(x, atraso));
        return r.continue();
      });
      await p.goto(servidor.url);
      return p;
    };
    // a primeira aba demora para gravar: a segunda carrega e grava no meio
    const [a, b] = await Promise.all([abrir(900), abrir(0)]);
    await expect(a.locator('#app')).toBeVisible();
    await expect(b.locator('#app')).toBeVisible();
    await expect.poll(() => servidor.lerDados().versao, { timeout: 10000 }).toBeGreaterThanOrEqual(1);
    await a.waitForTimeout(1500);

    const d = servidor.lerDados();
    const depois = d.contratos.reduce((s, c) => s + c.dividas.length, 0);
    // 24 contratos em andamento (o #3 está encerrado), mas o #2 ganha duas (set e out)
    expect(depois - antes).toBe(25);
    for (const c of d.contratos) {
      expect(new Set(c.dividas.map(x => x.vencimento)).size, `contrato #${c.numero}`).toBe(c.dividas.length);
    }
    await expect(a.locator('#modalConflito')).toBeHidden();
    await expect(b.locator('#modalConflito')).toBeHidden();
  });

  test('C · "salvo" só depois de salvar; erro fica na tela e "Tentar de novo" grava', async ({ page, app, servidor }) => {
    await app.entrar('#/despesas');
    let falhar = true;
    await page.route('**/api/data.php', async (r) => {
      if (r.request().method() === 'POST') {
        await new Promise(x => setTimeout(x, 400));
        if (falhar) return r.fulfill({ status: 500, body: '{"ok":false,"error":"Disco cheio."}' });
      }
      return r.continue();
    });
    await page.locator('#despDescricao').fill('Despesa com erro');
    await page.locator('#despValor').fill('10');
    await page.locator('#btnSalvarDespesa').click();
    await expect(page.locator('#btnSalvarDespesa')).toBeDisabled();
    await expect(page.locator('#statusGravacao')).toHaveText('Salvando…');
    await expect(page.locator('#toastErro')).toContainText('Não foi possível salvar: Disco cheio.');
    await expect(page.locator('#toast')).toBeEmpty();
    await page.waitForTimeout(5000);
    await expect(page.locator('#toastErroTexto')).toContainText('Disco cheio');
    await expect(page.locator('#statusGravacao')).toHaveText('Não salvo');

    falhar = false;
    await page.locator('#toastErroAcao').click();
    await expect(page.locator('#toast')).toHaveText('Alterações salvas.');
    expect(servidor.lerDados().despesas.some(d => d.descricao === 'Despesa com erro')).toBeTruthy();
  });

  test('C · clique duplo em Salvar não cria dois registros', async ({ page, app, servidor }) => {
    await app.entrar('#/imoveis');
    await page.route('**/api/data.php', async (r) => {
      if (r.request().method() === 'POST') await new Promise(x => setTimeout(x, 500));
      return r.continue();
    });
    await page.locator('#newImovelNome').fill('Imóvel do clique duplo');
    await page.locator('#btnSalvarImovel').dblclick();
    await expect(page.locator('#toast')).toContainText('Imóvel adicionado');
    await page.waitForTimeout(800);
    expect(servidor.lerDados().imoveis.filter(i => i.nome === 'Imóvel do clique duplo').length).toBe(1);
  });

  test('D · sessão expirada pede login sem recarregar e grava em seguida', async ({ page, context, app, servidor }) => {
    await app.entrar('#/despesas');
    await context.clearCookies();
    await page.locator('#despDescricao').fill('Feita com sessão expirada');
    await page.locator('#despValor').fill('10');
    await page.locator('#btnSalvarDespesa').click();
    await expect(page.locator('#modalSessao')).toBeVisible();
    await expect(page.locator('#sessaoSenha')).toBeFocused();

    await page.locator('#sessaoSenha').fill('errada');
    await page.keyboard.press('Enter');
    await expect(page.locator('#sessaoErro')).toHaveText('Usuário ou senha incorretos.');

    await page.locator('#sessaoSenha').fill('12345678');
    await page.keyboard.press('Enter');
    await expect(page.locator('#toast')).toContainText('Despesa adicionada');
    await expect(page.locator('#tab-despesas')).toBeVisible();
    expect(servidor.lerDados().despesas.some(d => d.descricao === 'Feita com sessão expirada')).toBeTruthy();
  });

  test('restaurar backup e excluir todos os dados continuam funcionando', async ({ page, app, servidor }) => {
    await app.entrar('#/configuracoes/perigo');
    const backup = JSON.stringify(servidor.lerDados());
    await page.getByRole('button', { name: 'Excluir todos os dados' }).click();
    await page.locator('#confEntrada').fill('EXCLUIR');
    await page.locator('#confOk').click();
    await expect(page.locator('#toast')).toContainText('Todos os dados foram excluídos');
    expect(servidor.lerDados().contratos.length).toBe(0);

    await app.ir('#/configuracoes/dados');
    const arquivo = path.join(os.tmpdir(), `backup-teste-${Date.now()}.json`);
    fs.writeFileSync(arquivo, backup);
    const [seletor] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#btnImportBackup').click()]);
    await seletor.setFiles(arquivo);
    await page.locator('#confOk').click();
    await expect(page.locator('#toast')).toContainText('Backup restaurado');
    expect(servidor.lerDados().contratos.length).toBe(25);
    fs.rmSync(arquivo);
  });
});

test.describe('Migração de dados antigos', () => {
  test('contratos sem número recebem números que não se repetem', async ({ page, app }) => {
    await app.entrar('#/');
    const r = await page.evaluate(() => {
      const casos = {
        semNenhum: [{ criadoEm: 3 }, { criadoEm: 1 }, { criadoEm: 2 }],
        semNumeroAntesDoUm: [{ criadoEm: 1 }, { criadoEm: 2, numero: 1 }],
        misturado: [{ criadoEm: 1, numero: 2 }, { criadoEm: 2 }, { criadoEm: 3, numero: 3 }, { criadoEm: 4 }],
      };
      return Object.fromEntries(Object.entries(casos).map(([k, v]) => [k, migrarNumerosContrato(v).map(c => c.numero)]));
    });
    // sem números: 1, 2, 3 na ordem de criação (como sempre foi)
    expect(r.semNenhum).toEqual([3, 1, 2]);
    expect(new Set(r.semNumeroAntesDoUm).size).toBe(2);
    expect(new Set(r.misturado).size).toBe(4);
  });
});

test.describe('Servidor', () => {
  test('E · leituras simultâneas a gravações nunca pegam o arquivo pela metade', async () => {
    test.slow();
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aluguel-e-'));
    const dataDir = path.join(base, 'data');
    fs.mkdirSync(dataDir);
    const dados = gerarDados();
    for (let i = 0; i < 30; i++) {
      dados.despesas.push(...gerarDados().despesas.map(d => ({ ...d, id: `${d.id}_${i}`, descricao: 'x'.repeat(2000) })));
    }
    fs.writeFileSync(path.join(dataDir, 'dados.json'), JSON.stringify(dados));
    const porta = 20000 + Math.floor(Math.random() * 20000);
    // vários processos, como no Apache
    const php = spawn('php', ['-S', `127.0.0.1:${porta}`, '-t', RAIZ], {
      env: { ...process.env, PHP_CLI_SERVER_WORKERS: '6', ALUGUEL_DATA_DIR: dataDir, ALUGUEL_CONTRATOS_DIR: base },
      stdio: 'ignore',
    });
    try {
      const url = `http://127.0.0.1:${porta}/api/`;
      for (let i = 0; i < 50; i++) { try { await fetch(url + 'session.php'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
      const login = await fetch(url + 'login.php', { method: 'POST', body: JSON.stringify({ username: 'admin', password: '12345678' }) });
      const cookie = login.headers.get('set-cookie').split(';')[0];
      const h = { Cookie: cookie, 'Content-Type': 'application/json' };
      let versao = 0;
      let ruins = 0;
      const escritas = (async () => {
        for (let i = 0; i < 20; i++) {
          const r = await fetch(url + 'data.php', { method: 'POST', headers: h, body: JSON.stringify({ baseVersao: versao, dados }) });
          versao = (await r.json()).versao;
        }
      })();
      const leituras = Array.from({ length: 80 }, async (_, i) => {
        await new Promise(r => setTimeout(r, i * 8));
        const t = await (await fetch(url + 'data.php', { headers: h })).text();
        try { JSON.parse(t); } catch { ruins++; }
      });
      await Promise.all([escritas, ...leituras]);
      expect(ruins).toBe(0);
      expect(versao).toBe(20);
    } finally {
      php.kill();
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test('F · cookie montado com a chave antiga do repositório é recusado', async ({ servidor }) => {
    const r = await fetch(servidor.url + 'api/data.php', { headers: { Cookie: cookieForjado(CHAVE_PUBLICA_ANTIGA) } });
    expect(r.status).toBe(401);
    expect(fs.existsSync(path.join(servidor.dataDir, 'cookie_secret.php'))).toBeTruthy();
  });

  test('F · desconectar os outros acessos mantém quem pediu e derruba os demais', async ({ servidor }) => {
    const entrar = async () => {
      const r = await fetch(servidor.url + 'api/login.php', { method: 'POST', body: JSON.stringify({ username: 'admin', password: '12345678' }) });
      return r.headers.get('set-cookie').split(';')[0];
    };
    const eu = await entrar();
    const outro = await entrar();
    const r = await fetch(servidor.url + 'api/regenerate_secret.php', {
      method: 'POST', headers: { Cookie: eu }, body: JSON.stringify({ currentPassword: '12345678' }),
    });
    expect(r.status).toBe(200);
    const novo = r.headers.get('set-cookie').split(';')[0];
    const sessao = async (c) => (await (await fetch(servidor.url + 'api/session.php', { headers: { Cookie: c } })).json()).authenticated;
    expect(await sessao(novo)).toBe(true);
    expect(await sessao(outro)).toBe(false);
  });

  test('F · data/auth.json e a chave do cookie ficam fora do Git', () => {
    const versionados = execFileSync('git', ['ls-files', 'data'], { cwd: RAIZ, encoding: 'utf8' }).split('\n');
    expect(versionados).not.toContain('data/auth.json');
    expect(versionados).not.toContain('data/cookie_secret.php');
    const ignorado = (arq) => {
      try { execFileSync('git', ['check-ignore', '-q', arq], { cwd: RAIZ }); return true; } catch { return false; }
    };
    expect(ignorado('data/auth.json')).toBe(true);
    expect(ignorado('data/cookie_secret.php')).toBe(true);
  });

  test('anexo com nome oculto (.htaccess) é recusado', async ({ page, app, servidor }) => {
    await app.entrar('#/');
    const r = await page.request.post(servidor.url + 'api/anexo.php', { data: { action: 'remove', file: '.htaccess' } });
    expect(r.status()).toBe(400);
    expect(fs.existsSync(path.join(servidor.contratosDir, '.htaccess'))).toBeTruthy();
  });
});
