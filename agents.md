# agents.md — estado da revisão (navegação, dados, acessibilidade)

Este arquivo é para retomar o trabalho depois, por você ou por outro agente.
Ele registra o pedido, as regras combinadas, o que já foi feito (com commits),
o que está pela metade e o que falta, na ordem. **Leia inteiro antes de mexer
em qualquer coisa.** Atualizado em 18/09/2026 (versão final da entrega).

---

## 1. O pedido, em resumo

Duas partes, no repositório "Gerenciador de Aluguel" (HTML + CSS + JS puro no
navegador, PHP puro em `api/`, dados em `data/dados.json`):

1. **Cada tela com endereço próprio**, por hash (`index.html#/contratos`),
   com filtros, busca e página no endereço. **Feito.**
2. **Revisão completa de funcionamento, usabilidade e acesso por teclado e
   mouse**: inventário, dados fictícios, percurso em navegador de verdade,
   relatório em `docs/revisao-funcional.md`, correções, testes automatizados
   (Playwright + axe) em `tests/`. **Feito.**

O pedido original completo (com a lista de problemas A a T e o checklist) foi
passado na conversa; os itens estão todos reproduzidos em
`docs/revisao-funcional.md`, que é a referência do que precisa ser corrigido.

## 2. Regras combinadas (não quebrar)

- Branch: `revisao-navegacao-acessibilidade`. Commits pequenos, um assunto por
  commit, mensagens em português, terminando com
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. **Não fazer push.**
- **Nunca** rodar teste nem ação destrutiva contra `data/` real. Os testes usam
  `ALUGUEL_DATA_DIR` / `ALUGUEL_CONTRATOS_DIR` (pasta temporária) — ver
  `tests/apoio/servidor.js`. Backup dos dados reais, feito antes de começar:
  `~/Desktop/backups-gerenciador-aluguel/dados-e-contratos_2026-09-17_22-49-51.zip`.
- Sistema continua **sem framework, sem build, sem dependência para rodar**.
  Tem que funcionar em hospedagem comum (PHP + Apache, inclusive em subpasta) e
  com `php -S localhost:8000`. npm só dentro de `tests/`.
- **Não mudar regras financeiras** (funções de "As contas do dinheiro" no
  README) nem a **ordem das colunas dos CSVs**. Achou erro? Anotar e perguntar.
- Não redesenhar: manter `css/tokens.css`; mexer no visual só por uso ou
  acessibilidade (foco, contraste, área clicável).
- Todo dado já salvo continua abrindo (campo novo é opcional ou migrado).
- Textos em português, no tom do sistema; botão diz a ação; erro diz o que
  fazer.
- Ao mudar algo, **atualizar a seção correspondente do `etapas.txt` e do
  README**, em vez de acrescentar histórico no fim.
- **Perguntar antes de:** mudar cálculo financeiro ou ordem de colunas de CSV;
  mudar o formato de `dados.json` sem migração automática; renomear conceitos
  do negócio; remover funcionalidade; adicionar dependência para rodar.

### Decisões já tomadas pelo dono do projeto

- **Campos de dinheiro (U1): aprovado** trocar `type="number"` por texto com
  `inputmode="decimal"` e um leitor único que aceita `1.250,50`, `1250,50` e
  `1250.50`.
- **"Próximo vencimento" do Dashboard (U4): ok** mostrar o próximo vencimento
  a partir de hoje, com "N em atraso" embaixo (nenhum valor muda).
- **Card "Total em atraso" (U21): ok** corrigir o texto do `etapas.txt` (1.7),
  não o cálculo.
- **Comissão contada por pagamento nos Relatórios (U20): NÃO mexer.** Fica
  listado como pendente no relatório.
- Nomes inconsistentes entre telas (U22): **não renomear**, só listar.

## 3. O que já foi feito (commits na branch)

```
44898d0 Permite apontar as pastas de dados para outro lugar por variável de ambiente
97754f2 Adiciona diagnóstico da revisão funcional e base dos testes
3efb60c Grava os arquivos de dados de forma atômica, com trava separada        (E)
9549253 Gera a chave do cookie de login no servidor e tira auth.json do Git    (F)
eae9a78 Modais com controle de foco e diálogo próprio no lugar de confirm()/prompt()  (I, G, H, P)
7510ff8 Gravação com controle de versão, confirmada pelo servidor              (A, B, C, D, U2, U9)
8cca01b Cada tela com endereço próprio (roteamento por hash)                   (Parte 1, K, M, O, Q, U3, U14)
b93dbe9 Gaveta do menu e menus do topo usáveis só com teclado                  (J, L, T, S parcial)
fa2c9e0 Valores dos gráficos legíveis sem mouse                                (N)
```

Resumo técnico do que existe agora:

- **Servidor (`api/`)**: `gravarArquivoAtomico()` (temporário + `rename()`),
  `comTrava()` reentrante em `data/dados.lock`, `atualizarAuth()`.
  `data.php`: GET devolve o arquivo cru (com `versao`), `?versao=1` só a versão;
  POST exige `{ baseVersao, dados }`, responde 409 se a versão não bate, 400 sem
  `baseVersao`. `requireAuth()` responde `{ sessaoExpirada: true }`.
  Chave do cookie: `cookieSecret()` lê `data/cookie_secret.php`; senão usa o
  `COOKIE_SECRET` de `config.php` **só se** diferente do valor público; senão
  gera. `regenerate_secret.php` grava nesse arquivo. `data/auth.json` saiu do
  Git (`.gitignore`); o arquivo local continua no disco.
- **Navegador (`index.js`)**, na ordem em que aparece no arquivo:
  - Avisos: `showToast()` (sucesso, `role="status"`, some sozinho) e
    `mostrarErro()` (erro, `role="alert"`, fica, com ação opcional).
  - Foco: `chaveDoElemento()`, `restaurarFoco()`, `preservandoFoco()`,
    `focarTituloDaTela()`.
  - Formulário "sujo": `marcarLimpo()`, `estaSujo()`, `formulariosSujos()`;
    `aoEnviar(form, fn)` (desabilita envio, marca limpo se `fn` não devolver
    `false`).
  - Validação genérica (captura de `submit`): erro abaixo do campo com
    `aria-describedby`, foco no primeiro inválido.
  - Números: `lerNumero()`, `valorCampo(id)`, `escreverValor(id, v)`.

  - Modais: pilha, fundo `inert`, `openModal()`, `closeModal()` (força),
    `pedirFechamento()` (pergunta se há alteração), `cancelamentoDosModais`.
  - Diálogo próprio: `confirmar({...})` e `pedirTexto({...})`.
  - API/gravação: `apiFetch()` (401 → `pedirLoginDeNovo()`), `fetchState()`,
    `saveState()` em fila com versão (devolve true/false), indicador
    `#statusGravacao`, `modalConflito`, `carregarDados()` (migra, gera dívidas,
    grava; em 409 automático recarrega e refaz), `visibilitychange`,
    `beforeunload`.
  - `showApp()`: tela de carregamento, tela de erro de carga (A). `sair()`
    recarrega a página limpa.
  - Rotas: `ROTAS` (aplicar/ler/desenhar por tela), `lerEndereco()`,
    `montarEndereco()`, `navegar()`, `mostrarRota()`, `atualizarEndereco()`,
    `aoMudarEndereco()` (popstate/hashchange; Voltar com modal fecha o modal),
    interceptação de `a[href^="#/"]`, busca do topo, link "Pular para o
    conteúdo".
  - Atalhos: N/n, `/`, `?`, Esc; podem ser desligados
    (`localStorage.aluguelApp_atalhos`, cartão em Configurações › Financeiro).
  - Paginação única `renderPaginacao()` + `anunciar()` (região `#anuncio`).
  - Gráficos: `definirDadosDoGrafico()` (role img + "Ver dados"),
    `ligarNavegacaoPorMes()` (setas), eventos de ponteiro.
- **`ui.js`**: sidebar recolhível, gaveta (inert quando fechada), menus do topo
  (padrão simples, sem `role="menu"`), notificações, "mostrar mais dívidas".
  A navegação saiu daqui (é do roteador).
- **`index.html`**: menu com `<a href="#/...">`, `h1` em cada tela, abas de
  Configurações como links, tela "Página não encontrada", modais novos
  (`modalConfirmacao`, `modalConflito`, `modalSessao`, `modalAtalhos`), telas
  `telaCarregando` e `telaErroCarga`, CSS/JS com `?v=3.1` (trocar o número a
  cada versão).

## 4. Commits depois da primeira versão deste arquivo

```
cefcf0c Campos de valor aceitam 1.250,50 e mostram o erro ao lado do campo   (U1 + validação)
a586532 Dashboard, estados vazios, Auditoria e nomes de botões com contexto   (U4, U5, U11, U12, U13, U16, U21, R)
14de076 Anexos: recusa nomes de arquivo ocultos                               (U17)
e4b322d Contraste, 320 px e estrutura sem violações no axe                    (U6, U7, U8)
ba40361 Corrige o que os testes de acessibilidade encontraram
bf825b4 Testes de navegador com Playwright e axe                              (Parte 4)
e1c00e8 Documenta os testes e o status final da revisão
```

## 5. Estado: trabalho concluído

Todas as partes do pedido estão feitas e commitadas. `tests/`: 89 testes,
todos passando no Chromium (rodados 2 vezes seguidas, 168/168). O status item
a item está em `docs/revisao-funcional.md` ("Status na entrega").

**O que ficou para o dono decidir ou fazer:**

- U20 — comissão contada por pagamento nos Relatórios (regra financeira;
  combinado não mexer). Registrado também em `etapas.txt` 4.3, item 9.
- U22 — nomes inconsistentes entre telas (só listados).
- Rodar `npm test` numa máquina em que o Firefox do Playwright abra (nesta não
  abre).
- Testar numa hospedagem com Apache: o `.htaccess` de `data/` recusando acesso
  direto (subpasta já é coberta pelos testes).
- Ao publicar: enviar só o código, **sem sobrescrever `data/` e `contratos/`**
  (ver README). Na primeira abertura, todos precisam entrar de novo uma vez
  (chave do cookie nova).
- `tests/diagnostico/` guarda os scripts da fase de diagnóstico (rodam com
  `node tests/diagnostico/<script>.js`); os testes de verdade são os de
  `tests/specs/`.

## 5a. Revisão de segurança e funcionamento (outubro/2026)

Branch `claude/rental-manager-code-review-epks1d`, um commit só. O que mudou está em
`etapas.txt` 3.5 e nas seções do README ("Como o login funciona", "As contas do
dinheiro", "Auditoria"). Resumo: escape de aspas + `normalizarDados()` (XSS), CSP,
CSRF (`protegerContraCsrf()`), cookie preso ao hash da senha, validação do nome de
usuário, faixa de senha padrão, auditoria decidida pelo servidor, fórmulas no CSV,
vencimentos 29-31, juros/multa fixos começam vazios e o atraso não incide sobre eles,
importação de CSV remonta os contratos, busca "#N" exata, reajuste com vigência, edição
dos valores das próximas dívidas, `ultimoVencimentoGerado`, anexos órfãos,
`roteador-dev.php`. Por pedido explícito do dono ("corrija tudo"), mexeu em regras
financeiras (juros/multa) — o U20 continua sem mexer. Testes novos em
`tests/specs/correcoes.spec.js`; 107 testes passando no Chromium.

Ambiente sem o Chromium da versão do Playwright: rode com
`launchOptions.executablePath` apontando para o Chromium instalado.

## 5b. Se for continuar

- Rodar os testes antes e depois de qualquer mudança:
  `cd tests && npm install && npx playwright install chromium && npm run test:chromium`.
- Ao lançar versão, trocar o `?v=3.1` dos CSS/JS no `index.html`.

## 6. Armadilhas já encontradas

- **Ordem de declaração no `index.js`**: código de nível superior que usa
  `cancelamentoDosModais`, `pilhaModais` etc. precisa vir **depois** da seção
  de modais (houve um erro "Cannot access before initialization").
- `mostrarRota()` fecha qualquer modal aberto; diálogos com resposta pendente
  são cancelados via `cancelamentoDosModais`.
- `closeModal()` devolve o foco num `setTimeout(0)`, para acontecer depois do
  `renderAll()` que costuma vir logo em seguida; `renderAll()` também preserva
  o foco (`preservandoFoco`).
- Botões dentro do aviso de erro não podem receber Tab quando ele está fechado
  (`.toast-error:not(.is-visivel) .toast-acoes { display: none }`).
- O `fetch` de login dentro do modal de sessão é direto (não `apiFetch`), para
  um 401 de senha errada não ser confundido com sessão expirada.
- `php -S` é de um processo só; para simular o Apache (concorrência), use
  `PHP_CLI_SERVER_WORKERS=6`.
- Ao lançar versão nova, trocar o `?v=` dos CSS/JS no `index.html`.
- `agents.md` e `tests/diagnostico/` estão commitados (a pedido do dono).
