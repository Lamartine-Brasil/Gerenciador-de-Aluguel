# Revisão funcional, de usabilidade e de acesso por teclado e mouse

Revisão feita em 17/09/2026, na branch `revisao-navegacao-acessibilidade`.
Este documento é o registro de cada problema encontrado: o que acontece, como
reproduzir, a gravidade e a correção. O status de cada item é atualizado até
a entrega.

Gravidade:

- **crítico**: perda de dados ou acesso indevido
- **alto**: fluxo principal quebrado, ou impossível só com teclado ou só com mouse
- **médio**: funciona, mas confunde ou atrapalha de verdade
- **baixo**: acabamento

## Como a revisão foi feita

- **Dados isolados.** O PHP passou a aceitar `ALUGUEL_DATA_DIR` e
  `ALUGUEL_CONTRATOS_DIR` (só quando definidas). Os testes sobem `php -S` numa
  porta livre com uma pasta temporária; `data/` e `contratos/` reais não foram
  tocados (backup em `~/Desktop/backups-gerenciador-aluguel/`).
- **Dados fictícios** em `tests/fixtures/dados.js`: 25 contratos (duas páginas),
  com e sem corretor, condomínio cobrado junto e pago direto, dívidas pagas, a
  vencer e em atraso, contrato encerrado com caução devolvida, contratos
  retroativos desde 2023, 29 despesas em dois anos, pessoas, auditoria, e as
  variantes sem carteira, com uma e com várias carteiras. Também a instalação
  vazia (sem `dados.json`). O relógio do navegador fica fixo em 17/09/2026 para
  o resultado não depender do dia.
- **Navegador de verdade** (Playwright/Chromium): percurso com mouse de 47 ações
  que gravam, cada uma conferida no `dados.json` e na Auditoria; percurso de
  foco e teclado; axe em todas as telas nos dois temas; larguras de 320 px e
  640×400 (equivalente a zoom de 200% numa tela de 1280×800).
- **Limitação:** o Firefox do Playwright não abre neste Mac (o sistema bloqueia a
  criação do perfil temporário, com ou sem sandbox). Os testes ficam
  configurados para Chromium e Firefox; o Firefox precisa ser rodado numa
  máquina em que ele abra. Os campos de dinheiro foram testados no Chromium em
  inglês e em português.

## Resumo

| Gravidade | Qtde | Itens |
|---|---|---|
| crítico | 4 | A, B, E, F |
| alto | 7 | C, D, I, J, K, N, U1 |
| médio | 20 | G, L, M, O, P, Q, T, U2–U12, U14, U15 |
| baixo | 8 | H, R, S, U13, U16–U19 |
| para decidir | 3 | U20, U21, U22 |

## Status na entrega

Todos os itens críticos, altos, médios e baixos foram corrigidos, com exceção
dos que dependem de decisão. Cada correção tem teste em `tests/specs/`
(84 testes passando no Chromium; ver "Limitação" acima sobre o Firefox).

| Item | Status | Commit |
|---|---|---|
| A · falha ao carregar | corrigido | 7510ff8 |
| B · o último a salvar apaga o outro | corrigido (inclusive dívidas novas em duas abas) | 7510ff8 |
| C · "salvo" antes de salvar | corrigido | 7510ff8 |
| D · sessão expirada | corrigido | 7510ff8 |
| E · gravação não atômica | corrigido (0 leituras quebradas em 120) | 3efb60c |
| F · chave do cookie pública; auth.json no Git | corrigido | 9549253 |
| G · senha em `prompt()` | corrigido | eae9a78 |
| H · `confirm()` genérico | corrigido | eae9a78 |
| I · modais sem controle de foco | corrigido | eae9a78 |
| J · gaveta fechada recebendo foco | corrigido | b93dbe9 |
| K · foco perdido ao redesenhar | corrigido | 8cca01b |
| L · menus do topo | corrigido (padrão simples, sem `role="menu"`) | b93dbe9 |
| M · abas de Configurações | corrigido (links com `aria-current`) | 8cca01b |
| N · gráficos só com mouse | corrigido | fa2c9e0 |
| O · "Pular para o conteúdo" | corrigido | 8cca01b |
| P · avisos não anunciados | corrigido | eae9a78 |
| Q · atalhos de uma tecla | corrigido (N/n, ?, desligáveis) | 8cca01b |
| R · botões de linha com nomes iguais | corrigido | a586532 |
| S · nomes com a sidebar recolhida | corrigido (`aria-label` nos links) | 8cca01b |
| T · foco atrás do cabeçalho fixo | corrigido | b93dbe9 |
| U1 · campos de dinheiro | corrigido (aprovado: texto com `inputmode="decimal"`) | cefcf0c |
| U2 · login piscando no F5 | corrigido | 7510ff8 |
| U3 · Dashboard desatualizado | corrigido | 8cca01b |
| U4 · "Próximo vencimento" | corrigido (aprovado) | a586532 |
| U5 · CSV ignora a busca | corrigido | a586532 |
| U6 · 320 px | corrigido | e4b322d |
| U7 · contraste | corrigido | e4b322d, ba40361 |
| U8 · estrutura | corrigido | e4b322d, ba40361 |
| U9 · sair não limpa a memória | corrigido | 7510ff8 |
| U10 · jargão | corrigido | 9549253 |
| U11 · estados vazios | corrigido | a586532 |
| U12 · Auditoria incompleta | corrigido | a586532 |
| U13 · aviso do pagamento | corrigido | a586532 |
| U14 · Voltar e F5 | corrigido (Parte 1) | 8cca01b |
| U15 · envio duplo | corrigido (botão desabilitado enquanto grava) | 7510ff8 |
| U16 · título "Últimos contratos" | corrigido | a586532 |
| U17 · anexo | corrigido | 7510ff8, 14de076 |
| U18 · `autocomplete="off"` no login | corrigido | eae9a78 |
| U19 · `migrarNumerosContrato()` | pendente (caso raro, só dados muito antigos) | — |
| U20 · comissão por pagamento | **depende de decisão** (combinado não mexer) | — |
| U21 · texto do card "Total em atraso" | corrigido no `etapas.txt` (aprovado) | a586532 |
| U22 · nomes inconsistentes | **depende de decisão** (só listados) | — |
| Firefox | **pendente**: configurado, mas não roda nesta máquina | — |
| Apache real | **pendente**: `.htaccess` de `data/` só se confirma numa hospedagem | — |

Achados durante a correção (já corrigidos): o card de despesas do Dashboard
não acompanhava lançamentos; preencher formulário por código contava como
"alteração não salva"; "Editar" e "Nova despesa" apagavam o que estava
digitado sem avisar; o botão da Zona de perigo tinha contraste 4:1; o campo
de anexo não tinha rótulo; o link de autoria tinha 18 px de altura.

## Inventário (o que existe em cada tela)

Tudo abaixo foi exercitado com mouse; "ok" quer dizer que funcionou e gravou
(conferido depois de recarregar a página).

| Tela | Ações | Resultado |
|---|---|---|
| Login | entrar, mensagem de erro, bloqueio após 5 tentativas | ok; erro não é anunciado (P) |
| Topo | busca global, seletor de carteira, Atualizar dívidas, notificações, tema, menu do usuário (Configurações, Usuários, Auditoria, Sair) | ok; menus sem teclado (L); Sair não limpa a memória (U9) |
| Dashboard | 5 cards, alerta de vencimento (leva ao contrato), alerta de reajuste (abre o reajuste), dívidas recentes com pagar/histórico/editar | ok; cards desatualizados (U3), "Próximo vencimento" errado (U4) |
| Imóveis | busca, paginação, criar, editar (renomeia contratos), remover | ok; criar/remover não entram na Auditoria (U12) |
| Contratos | novo (retroativo com confirmação), editar contrato, anexo, reajustar, atualizar dívidas, histórico (com CSV), devolver caução, encerrar/reabrir, excluir; por dívida: pagar, recibo, editar, excluir; busca, ano, mês, status, paginação, "mostrar mais", CSV, PDF, importar CSV | ok; CSV ignora busca por `#nº` e carteira (U5) |
| Pagamento (modal) | extrato, somar atraso, desconto + motivo, condomínio junto, prévia do líquido | ok; aviso aponta para o lugar errado (U13) |
| Atrasos | tabela com pagar/histórico/editar | ok |
| Histórico | busca, contrato, ano, paginação, recibo, CSV | ok; CSV bate com o contador (43 × 43) |
| Despesas | criar, editar, excluir, busca, ano, mês, paginação, gráfico, CSV, "Nova despesa" | ok |
| Gráficos | ano, agrupamento da inadimplência, 6 gráficos | ok; valores só com mouse (N) |
| Relatórios | ano, mês, CSV, PDF | ok |
| Calendário | anterior/próximo/hoje, dia → detalhe com ações | ok; foco perdido (K) |
| Auditoria | filtros de ano, mês e usuário | ok |
| Usuários | trocar usuário/senha, nova chave do cookie, adicionar/remover conta, pessoas (criar/editar/remover) | ok; senha em `prompt()` (G); jargão (U10) |
| Configurações | Financeiro (3 formulários), Carteiras, Recibo (salvar, prévia, restaurar, inserir código), Dados (exportar/restaurar), Zona de perigo | ok; abas sem teclado (M) |

## Problemas

### Proteção dos dados e segurança

**A · crítico · Todas as telas — falha ao carregar pode apagar tudo.**
Se `GET api/data.php` falha, `showApp()` mostra um aviso e segue com o estado
vazio; a próxima gravação sobrescreve `dados.json` inteiro.
*Reproduzir:* simular erro 500 no carregamento, entrar e cadastrar um imóvel.
*Visto:* o arquivo passou de 25 contratos para 0.
*Correção:* tela de erro com "Tentar de novo", nenhuma gravação sem um
carregamento bem-sucedido, e o servidor recusa gravação sem versão (B).

**B · crítico · Todas — o último a salvar apaga o que o outro salvou.**
Cada gravação envia o estado inteiro e o servidor grava sem conferir.
*Reproduzir:* duas abas; na 1 cadastrar um imóvel, na 2 lançar uma despesa.
*Visto:* o imóvel da aba 1 sumiu.
*Correção:* número de versão no arquivo; o POST informa a versão em que se
baseou; versão diferente → 409 sem gravar; o navegador explica e oferece
recarregar; gravações em fila; conferir a versão ao voltar para a aba.

**C · alto · Todas — "salvo com sucesso" antes de salvar.**
Cerca de 30 chamadas a `saveState()` não esperam a resposta; o erro some em 2,6 s.
*Reproduzir:* simular erro 500 na gravação e lançar uma despesa.
*Visto:* a mensagem de sucesso aparece e o erro some sozinho; nada foi gravado.
*Correção:* `saveState()` devolve se deu certo; sucesso só depois da resposta;
erro fica na tela com "Tentar de novo"; botão desabilitado enquanto grava;
indicador "Salvando… / Salvo / Não salvo" no topo.

**D · alto · Todas — sessão expirada vira erro genérico.**
*Reproduzir:* apagar o cookie e lançar uma despesa.
*Visto:* "Erro ao salvar dados no servidor."; ao recarregar, o trabalho some.
*Correção:* tratar 401: pedir login num modal sem recarregar, manter a tela e o
que está em memória, e gravar de novo (respeitando a versão).

**E · crítico · Servidor — gravação não atômica.**
`data.php` trunca e reescreve o próprio arquivo; o GET lê sem lock.
*Reproduzir:* PHP com vários processos (como no Apache), 30 gravações e 120
leituras simultâneas de um arquivo de 2,5 MB.
*Visto:* 50 de 120 leituras vieram com JSON pela metade (que, somado ao A, vira
perda de dados). O `etapas.txt` diz que a gravação é atômica; não é.
*Correção:* arquivo temporário + `rename()`, lock num arquivo separado, e
documentação corrigida. O mesmo vale para `auth.json` e `login_attempts.json`.

**F · crítico · Segurança — a chave do cookie é pública.**
`COOKIE_SECRET` padrão está em `api/config.php`, no GitHub.
*Reproduzir:* montar `admin|validade` assinado com a chave do repositório.
*Visto:* `GET api/data.php` respondeu 200 com os 25 contratos, sem senha.
*Correção:* chave gerada no primeiro acesso em `data/cookie_secret.php` (fora do
Git; um `.php` que só retorna o valor, para não vazar se o `.htaccess` falhar);
quem já trocou a chave em `config.php` continua valendo; "gerar nova chave"
passa a gravar nesse arquivo. `data/auth.json` sai do Git (`git rm --cached` +
`.gitignore`). README corrigido: o botão fica em Usuários, não em
"Configurações → Segurança".

**G · médio · Usuários, Zona de perigo — senha em `prompt()`.**
Remover usuário pede a senha num `prompt()` (texto visível, sem gerenciador de
senhas); "Excluir todos os dados" também usa `prompt()`.
*Correção:* modal próprio com campo `type="password"` e rótulo.

**H · baixo · Todas — `confirm()` genérico nas exclusões.** 12 diálogos nativos
com "OK/Cancelar". *Correção:* diálogo reutilizável com o botão dizendo a ação
("Excluir contrato") e o foco inicial em "Cancelar" nas ações destrutivas.

### Teclado e mouse

**I · alto · Modais — sem controle de foco.** O foco fica no botão que abriu;
40 de 40 Tabs caíram fora do modal; Esc não devolve o foco; cinco modais sem
nome (`modalContratoInfo`, `modalPagamento`, `modalReajuste`,
`modalDevolucaoCaucao`, `modalHistoricoContrato`); Esc, clique fora e × fecham
formulário preenchido sem aviso e o texto se perde.
*Correção:* foco no primeiro campo (ou no título), fundo `inert`, Esc fecha e
devolve o foco, confirmação quando há alteração, `aria-labelledby` em todos.

**J · alto · Gaveta do menu (até 960 px, inclui zoom de 200%).** Com a gaveta
fechada, 13 de 25 Shift+Tab pararam em itens invisíveis do menu.
*Correção:* fechada = `inert`; aberta recebe o foco; Esc fecha e devolve o foco.

**K · alto · Contratos, Histórico, Despesas, Calendário — foco perdido.**
"Próxima página" e escolher um dia no calendário recriam os botões e o foco vai
para o `body` (a página fica no meio da rolagem).
*Correção:* devolver o foco ao elemento equivalente depois de redesenhar; mesma
revisão nas ações de linha (pagar, editar, excluir) e nas listas de cadastro.

**L · médio · Notificações e menu do usuário.** `role="menu"` sem setas.
*Correção:* padrão simples: botão que abre e fecha uma lista comum; Esc fecha e
devolve o foco; Tab sai fechando.

**M · médio · Abas de Configurações.** `role="tab"` sem setas nem `aria-controls`.
*Correção:* viram links com endereço próprio e `aria-current`.

**N · alto · Gráficos — valores só com mouse.** Nenhum canvas tem nome, foco ou
alternativa; toque no celular não mostra valor.
*Correção:* nome e resumo acessíveis; botão "Ver dados" que mostra a tabela
gerada dos mesmos números; setas movem o mês destacado com o gráfico focado;
tocar mostra o valor.

**O · médio · Todas — sem "Pular para o conteúdo".** São 15 Tabs até a busca do
topo e mais até o conteúdo. *Correção:* link visível ao receber foco.

**P · médio · Avisos não anunciados.** `#toast` e `#loginError` sem papel.
*Correção:* sucesso em `role="status"`, erro em `role="alert"`; erro fica até
fechar.

**Q · médio · Atalhos.** `N` maiúsculo não funciona (o README diz `N`); atalho
de uma tecla não pode ser desligado. *Correção:* aceitar as duas formas, opção
para desligar em Configurações e ajuda com `?`.

**R · baixo · Botões de linha com nomes iguais.** Em Atrasos, 36 botões com só
3 nomes ("Registrar pagamento", "Editar dívida"...). *Correção:* nome com
contexto ("Registrar pagamento da dívida de 10-08-2026, contrato #1").

**S · baixo · Sidebar recolhida.** O nome dos itens vem do `::after` do CSS
(funciona no Chromium, mas depende disso). *Correção:* `aria-label` próprio.

**T · médio · Foco atrás do cabeçalho fixo.** `scroll-padding-top` não existe.
*Correção:* `scroll-padding-top` com a altura do cabeçalho.

### Encontrados no percurso

**U1 · alto · Campos de dinheiro (`type="number"`, ~20 campos).**
No Chrome em português, `1250,50` funciona, mas `1.250,50` é recusado com
"Os dois valores mais próximos são 1,25 e 1,26", e a prévia mostra R$ 1,25. No
Chrome em inglês (comum em computador de escritório), `1250,50` vira
**125.050,00** em silêncio. *Correção proposta:* campo de texto com
`inputmode="decimal"` e uma única função de leitura que aceita `1.250,50`,
`1250,50` e `1250.50`. **Depende de decisão** (é a troca de tipo que você pediu
para perguntar antes).

**U2 · médio · Início — a tela de login pisca a cada F5.** Quem já está logado vê
o login enquanto a sessão é conferida. Com endereço por tela o F5 vira rotina.
*Correção:* tela de "Carregando…" até saber se há sessão.

**U3 · médio · Dashboard — números desatualizados.** Depois de lançar, editar ou
excluir despesa (e criar ou remover imóvel), o Dashboard continua com o valor
antigo (R$ 597,50 antes e depois) até outra ação redesenhar tudo.
*Correção:* cada tela é redesenhada ao ser aberta (vem com o roteamento) e as
gravações redesenham o que depende delas.

**U4 · médio · Dashboard — "Próximo vencimento" mostra 05-11-2025.** É a dívida
em aberto mais antiga (vencida há 10 meses), não o próximo vencimento.
*Correção proposta:* mostrar o próximo vencimento a partir de hoje e, embaixo,
"N em atraso". Não mexe em nenhum valor.

**U5 · médio · Contratos — CSV ignora a busca por número e por carteira.**
*Reproduzir:* buscar `#5`. *Visto:* a tela mostra 1 contrato e o CSV diz
"Nenhuma dívida para exportar". *Correção:* o CSV usa o mesmo filtro da tela.

**U6 · médio · 320 px.** O cabeçalho passa 7 px da tela (menu do usuário
cortado) e o alerta do Dashboard vaza 12 px. *Correção:* ajustar o cabeçalho
estreito.

**U7 · médio · Contraste (axe: 854 ocorrências, sério).** `--text-faint` não
atinge 4,5:1 nos dois temas (3,2 a 4,2 no escuro; 2,9 a 3,3 no claro); zeros
"apagados" com 2,0–2,3; no tema claro, alerta/perigo/sucesso sobre fundo
colorido ficam entre 3,96 e 4,24. *Correção:* escurecer/clarear só esses
tokens, mantendo o tom.

**U8 · médio · Estrutura (axe).** Nenhuma tela tem `h1`; login sem `main`; a
busca de Contratos só tem `title` como rótulo; tabela de Relatórios rolável sem
foco; cabeçalho vazio na coluna de ações; `th` sem `scope`.

**U9 · médio · Sair não limpa a memória.** Dados e o que foi digitado (inclusive
senhas em Usuários) ficam no HTML escondido. *Correção:* sair recarrega a
página limpa, no login.

**U10 · médio · Jargão.** "Gerar novo COOKIE_SECRET", "A chave `COOKIE_SECRET`
(em `api/config.php`) assina o cookie de login", "Sessão protegida por cookie
assinado". *Proposta:* "Desconectar todos os outros acessos", com o texto "Gera
uma chave nova de acesso: todo mundo que estiver conectado em outro computador
ou navegador precisa entrar de novo. Você continua conectado."; no login,
"Após 5 tentativas erradas, o acesso fica bloqueado por 15 minutos."

**U11 · médio · Estados vazios não indicam o próximo passo.** Instalação vazia:
Contratos diz "Nenhum contrato encontrado." (igual a um filtro sem resultado);
o Dashboard manda clicar em "Novo contrato", que não existe ali, e sem imóvel
não dá para criar contrato. *Correção:* distinguir "nada cadastrado" de
"filtro sem resultado" e oferecer o caminho (cadastrar imóvel → novo contrato,
limpar filtros).

**U12 · médio · Auditoria incompleta.** Não registram evento: criar e remover
imóvel, pessoas (criar, renomear, remover), mudanças de configuração e do texto
do recibo, restauração de backup e importação de CSV. *Correção:* registrar
(só acrescenta eventos; nada muda no formato).

**U13 · baixo · Aviso do pagamento aponta para o lugar errado.** "Cadastre quem
recebe em Configurações › Financeiro › Pessoas" — fica em **Usuários**.

**U14 · médio · Voltar e F5.** Voltar sai do sistema; F5 sempre volta ao
Dashboard; não dá para favoritar nem abrir uma tela em outra aba. (Parte 1.)

**U15 · médio · Envio duplo.** Hoje não duplica porque o modal fecha na hora;
quando a gravação passar a esperar o servidor (C), o botão precisa ficar
desabilitado. Fica coberto por teste.

**U16 · baixo · Dashboard — título "Últimos contratos"** sobre uma lista de
dívidas recentes. *Proposta:* "Dívidas mais recentes".

**U17 · baixo · Anexo.** Remover apaga o arquivo antes de gravar o contrato (se a
gravação falhar, o contrato aponta para um arquivo que não existe);
`api/anexo.php` aceita remover o próprio `.htaccess` de `contratos/` (ele é
recriado na requisição seguinte). *Correção:* recusar nomes que começam com
ponto; remover o arquivo só depois de gravar.

**U18 · baixo · Login com `autocomplete="off"` no formulário.** Atrapalha
gerenciadores de senha. *Correção:* tirar.

**U19 · baixo · `migrarNumerosContrato()`** pode repetir número num caso raro
(contrato sem número antes de um que já tem o nº 1). Só afeta dados de
instalações muito antigas; fica anotado.

### Para decidir (não alterado)

**U20 · Relatórios — comissão contada por pagamento.** `calcularRelatorio()`
soma `comissaoCorretor()` uma vez por pagamento; se uma dívida tiver dois
pagamentos (hoje a tela não deixa, mas dados antigos ou importados podem ter),
a comissão sai em dobro no extrato e no líquido. É regra financeira: não mexi.

**U21 · Documentação × código — card "Total em atraso" do Dashboard.** O
`etapas.txt` (1.7) diz que ele soma só juros/multa; o código soma o valor cheio
(aluguel + juros/multa), igual a Atrasos. Proposta: corrigir o texto, não o
cálculo.

**U22 · Nomes inconsistentes entre telas** (não renomeei nada):
"parcela" (modal de pagamento) × "dívida" (resto do sistema); "Contratos em
atraso" (título de Atrasos, que lista dívidas) × "Contratos ativos" (card que
conta contratos); "Painel principal" (título) × "Dashboard" (menu); "Quem
recebe (padrão)" × "Recebedor padrão"; "Pessoas" × "recebedores / corretores".

## Plano

1. **Dados e segurança (A–F):** versão + 409, fila de gravações, gravação
   atômica com lock, tela de erro de carregamento, sessão expirada com login em
   modal, chave do cookie fora do Git, `auth.json` fora do Git. Cada item com
   teste.
2. **Roteamento (Parte 1):** `navegar()` e `mostrarRota()` únicos; menu com
   `<a href="#/...">`; filtros no endereço com `replaceState`; título da aba,
   `h1` e foco; login preserva a tela pedida; "página não encontrada"; Voltar
   fecha modal; confirmação de alteração não salva.
3. **Teclado, mouse e usabilidade:** G–T e U2–U18.
4. **Testes (Parte 4)** e documentação.
