# Sistema de Gerenciamento de Aluguéis

Aplicação web simples para controlar contratos de aluguel, pagamentos, atrasos e relatórios —
pensada para donos de imóveis ou pequenas imobiliárias que só precisam de um lugar central
para acompanhar tudo isso, sem depender de planilhas.

Não usa nenhuma biblioteca externa, nenhum banco de dados e nenhum framework: é só
**HTML + CSS + JavaScript** no navegador e **PHP puro** no servidor, salvando tudo em
arquivos `.json`. Isso significa que dá pra hospedar em qualquer hospedagem compartilhada
comum (Hostinger, cPanel, etc.) e acessar de qualquer lugar pela internet.

![Tela de login](imagens/imagemdologin.png)

## Índice

- [Acesso padrão (leia antes de usar)](#acesso-padrão-leia-antes-de-usar)
- [Como rodar no seu computador](#como-rodar-no-seu-computador)
- [Como colocar no ar (hospedagem)](#como-colocar-no-ar-hospedagem)
- [O que o sistema faz](#o-que-o-sistema-faz)
- [Perguntas frequentes](#perguntas-frequentes)
- [Para quem quer entender o código](#para-quem-quer-entender-o-código)

## Acesso padrão (leia antes de usar)

Na primeira vez que o sistema roda, ele cria automaticamente um usuário administrador com:

```
Usuário: admin
Senha:   123456
```

> ⚠️ **Troque essa senha imediatamente após o primeiro login.** Vá em **Configurações →
> Conta do administrador**, informe a senha atual (`123456`) e cadastre um usuário e senha
> só seus. Enquanto isso não for feito, qualquer pessoa que souber a URL do sistema e essas
> credenciais padrão consegue entrar.

Não existe recuperação de senha por e-mail (o sistema não envia e-mails). Se esquecer a
senha depois de trocada, é preciso apagar o arquivo `data/auth.json` no servidor para que
ele volte a ser recriado com o padrão `admin` / `123456` no próximo acesso.

## Como rodar no seu computador

Pré-requisito: ter o **PHP instalado** (versão 7.4 ou mais nova). Para verificar, abra o
terminal e digite `php -v`.

1. Baixe/clone este repositório
2. Abra o terminal na pasta do projeto
3. Rode:
   ```bash
   php -S localhost:8000
   ```
4. Acesse `http://localhost:8000` no navegador
5. Faça login com `admin` / `123456` (veja o aviso acima)

Não precisa instalar nada com `npm`, `composer` ou qualquer outro gerenciador de pacotes —
o projeto não tem dependências.

> Nota: o servidor embutido do PHP (`php -S`) ignora o arquivo `.htaccess`, então localmente
> a pasta `data/` não fica bloqueada por URL. Isso só funciona de verdade com Apache (veja a
> seção de hospedagem abaixo).

## Como colocar no ar (hospedagem)

Este sistema foi feito para hospedagem compartilhada comum com **PHP + Apache** (cPanel,
Hostinger, etc.) — não precisa de VPS nem de conhecimento avançado de servidor.

1. **Troque a chave secreta**: abra `api/config.php` e mude o valor de `COOKIE_SECRET`
   para algo aleatório e único (isso protege o cookie de login contra falsificação)
2. **Envie os arquivos**: copie a pasta inteira do projeto (`index.html`, `index.css`,
   `index.js`, `api/`, `data/`, `contratos/`) para a hospedagem, mantendo a mesma
   organização de pastas
3. **Acesse pelo navegador** e faça login com `admin` / `123456`
4. **Troque a senha na hora**, como explicado na seção acima
5. **Confirme que os dados estão protegidos**: tente acessar
   `https://seusite.com/data/dados.json` diretamente no navegador — o servidor deve
   recusar o acesso (erro 403). Isso só funciona em Apache com `.htaccess` habilitado
   (`AllowOverride All`), que é o padrão na maioria das hospedagens compartilhadas

## O que o sistema faz

- **Dashboard** — visão geral: quantos contratos estão ativos, quanto está em atraso no
  total, próximo vencimento, e um alerta para contratos que vencem nos próximos 5 dias
- **Contratos** — cadastrar, editar e excluir contratos de aluguel, com busca, filtros
  por ano/mês/status e paginação. Registrar pagamento em um clique, anexar o contrato
  assinado (PDF/JPG/PNG) e reajustar o valor do aluguel a qualquer momento
- **Atrasos** — lista separada só dos contratos vencidos, com juros e multa calculados
  automaticamente conforme a taxa configurada
- **Calendário** — grade mensal mostrando vencimentos e pagamentos dia a dia
- **Histórico** — todos os pagamentos já registrados, com exportação em CSV
- **Gráficos** — contratos por status, pagamentos por forma (Dinheiro/Pix), evolução do
  atraso e da receita nos últimos 6 meses. Cores adaptadas ao tema claro/escuro
- **Relatórios** — totais mês a mês e no ano, comparativo com todos os anos lado a lado,
  total de descontos concedidos e quebra de pagamentos por forma no ano
- **Auditoria** — histórico dos eventos principais (contrato criado/editado/excluído,
  pagamento registrado, usuário adicionado/removido), com quem fez e quando
- **Exportar/Importar** — contratos em CSV, relatório em PDF (direto do navegador, sem
  bibliotecas), e backup completo em JSON para copiar todos os dados de um lugar pra outro
- **Tema claro/escuro** — segue automaticamente o tema do seu sistema operacional até você
  escolher manualmente; a partir daí fica salvo no navegador
- **Login protegido** — sessão de 30 dias, não desloga ao fechar o navegador. Suporta
  múltiplos usuários administradores, todos com o mesmo nível de acesso
- **Atalhos de teclado** — `N` abre um novo contrato, `/` foca a busca, `Esc` fecha
  modais

## Perguntas frequentes

**Preciso de banco de dados (MySQL, etc.)?**
Não. Tudo é salvo em dois arquivos JSON dentro da pasta `data/`, criados automaticamente.

**Posso ter mais de um usuário administrador?**
Sim. Em **Configurações → Usuários administradores** você adiciona outros usuários (ex:
um sócio ou gerente). Todos têm o mesmo nível de acesso — não existe usuário "só leitura".
Não é possível remover a si mesmo nem remover o último usuário restante.

**O sistema manda e-mail avisando de vencimento?**
Não, essa decisão foi consciente (exigiria configurar SMTP na hospedagem, com risco de
cair em spam). O aviso de vencimento aparece só dentro do Dashboard quando você acessa
o sistema.

**Perdi a senha, e agora?**
Se existir outro usuário administrador com acesso, ele pode entrar em **Configurações →
Usuários administradores**, remover o seu usuário e cadastrar um novo. Se você for o único
usuário, veja a seção [Acesso padrão](#acesso-padrão-leia-antes-de-usar) acima — apague
`data/auth.json` no servidor para resetar para o padrão (isso remove **todos** os usuários
cadastrados, não só o seu).

## Para quem quer entender o código

### Estrutura de arquivos

```
index.html          Estrutura da página (login + app com abas + modais)
index.css            Estilos (dark mode padrão + tema claro)
index.js              Toda a lógica do front-end

api/config.php       Constantes (usuário/senha padrão, chave do cookie) e funções de
                      leitura/gravação dos arquivos data/dados.json e data/auth.json
api/auth.php         Emissão e validação do cookie de sessão
api/login.php        POST { username, password } -> autentica e emite cookie
api/logout.php       POST -> limpa o cookie
api/session.php      GET -> { authenticated, username }
api/data.php         GET lê / POST grava data/dados.json (exige autenticação)
api/account.php      POST { currentPassword, newUsername, newPassword } -> troca o
                      próprio usuário/senha em data/auth.json (exige senha atual)
api/users.php         GET lista os usuários administradores; POST { action: 'add' | 'remove', ... }
                      adiciona ou remove outros usuários (exige autenticação)
api/anexo.php         GET ?file=... baixa/visualiza o anexo; POST (multipart) envia um
                      novo anexo; POST { action: 'remove', file } remove um anexo
                      (exige autenticação)

data/dados.json      Contratos, pagamentos, configuração e auditoria (criado automaticamente)
data/auth.json       Lista de usuários administradores + hash de senha de cada um
                      (criado automaticamente, password_hash)
data/.htaccess       Bloqueia acesso direto via URL a tudo dentro de data/

contratos/           Arquivos de contrato assinado anexados (PDF/JPG/PNG), renomeados
                      para nomedoinquilino-imovel-idcurto.ext (criado automaticamente)
contratos/.htaccess  Bloqueia acesso direto via URL a tudo dentro de contratos/
```

### Como o login funciona

O login usa um cookie de sessão assinado com HMAC-SHA256 — **não** usa `session_start()`
do PHP. Isso significa que não há estado de sessão guardado no servidor: o próprio cookie
carrega usuário + validade + assinatura, e a assinatura é validada comparando com a chave
`COOKIE_SECRET` e com a lista de usuários salva em `data/auth.json` (o usuário do cookie
precisa continuar existindo nessa lista — se for removido, a sessão é invalidada
imediatamente). O cookie dura 30 dias e é `HttpOnly` + `SameSite=Lax`.

`data/auth.json` guarda uma lista de usuários (`{ users: [{ id, username, passwordHash }] }`),
todos com o mesmo nível de acesso. Instalações antigas que tinham só `{ username,
passwordHash }` são migradas automaticamente para o novo formato no primeiro acesso,
sem exigir nenhuma ação manual.

### Arquitetura geral

- **Front-end**: `index.html` + `index.css` + `index.js`. Aplicação de página única (SPA):
  as "abas" (Dashboard, Contratos, Atrasos, Histórico, Gráficos, Relatórios, Calendário,
  Auditoria, Configurações) são seções que aparecem/somem no mesmo HTML, sem recarregar
  a página.
- **Backend**: PHP puro em `api/`, sem framework. Cada endpoint é um arquivo `.php`
  independente. Toda a comunicação front-end ↔ backend é via `fetch()` com JSON.
- **Dados**: dois arquivos JSON em `data/`, protegidos contra acesso direto via `.htaccess`.

### Modelo de dados

#### Contrato (cada item do array `contratos` em `data/dados.json`)

| Campo             | Tipo              | Descrição                                             |
|--------------------|------------------|--------------------------------------------------------|
| `id`               | string            | Gerado no front-end (`uuid()`)                          |
| `vencimento`       | string `AAAA-MM-DD` | Data de vencimento                                    |
| `imovel`           | string            | Descrição do imóvel                                    |
| `inquilino`        | string            | Nome do inquilino                                       |
| `aluguel`          | number            | Valor do aluguel mensal                                 |
| `desconto`         | number            | Desconto aplicado                                       |
| `juros`            | number            | Juros já lançados manualmente no contrato               |
| `multa`            | number            | Multa já lançada manualmente no contrato                |
| `condominio`       | number            | Valor do condomínio                                     |
| `total`             | number            | `aluguel - desconto + juros + multa + condominio`      |
| `valorAtrasoBase`  | number            | Atraso herdado/manual, somado ao atraso calculado       |
| `quemRecebeu`      | string            | Recebedor padrão sugerido ao registrar pagamento        |
| `observacao`       | string            | Observações livres                                      |
| `pago`             | boolean           | Se já foi pago (contrato "quitado")                    |
| `dataPagamento`    | string ou null    | Data do último pagamento registrado                     |
| `pagamentos`       | array             | Histórico de pagamentos deste contrato (ver abaixo)     |
| `anexoContrato`    | string ou null    | Nome do arquivo do contrato assinado anexado (em `contratos/`), ou `null` se não houver |
| `criadoEm`         | number (timestamp)| Usado para ordenar "contratos recentes" no Dashboard    |

**Status do contrato** (calculado, não é um campo salvo): `pago` se `pago=true`;
senão `atrasado` se hoje > vencimento; senão `ativo`.

#### Pagamento (cada item de `contrato.pagamentos`)

| Campo         | Tipo   | Descrição                                  |
|---------------|--------|----------------------------------------------|
| `data`        | string `AAAA-MM-DD` | Data em que o pagamento foi feito     |
| `desconto`    | number | Desconto aplicado a este pagamento (opcional) |
| `valor`       | number | Valor pago (já descontado, se houver desconto)|
| `forma`       | string | Forma de pagamento: `Dinheiro` ou `Pix`       |
| `quemRecebeu` | string | Quem recebeu (banco, PIX, transferência...)   |
| `observacao`  | string | Observação do pagamento                       |

#### Configuração (`config` em `data/dados.json`)

| Campo               | Padrão | Descrição                                            |
|---------------------|--------|--------------------------------------------------------|
| `taxaJurosMensal`   | 1 (%)  | Taxa de juros mensal aplicada sobre o total em atraso  |
| `taxaMultaPercent`  | 2 (%)  | Multa fixa aplicada uma vez que o contrato atrasa      |
| `jurosPadrao`       | 0 (R$) | Valor de juros pré-preenchido ao criar um novo contrato|
| `multaPadrao`       | 0 (R$) | Valor de multa pré-preenchido ao criar um novo contrato|

Cálculo do atraso atual (função `calcAtrasoAtual` em `index.js`): se o contrato já está
atrasado, soma `valorAtrasoBase` + (`total` × `taxaJurosMensal`/100 × meses de atraso)
+ (`total` × `taxaMultaPercent`/100).

#### Auditoria (array `auditoria` em `data/dados.json`)

| Campo       | Tipo               | Descrição                                             |
|-------------|--------------------|--------------------------------------------------------|
| `id`        | string             | Identificador único do evento                          |
| `timestamp` | number (ms)        | Quando o evento aconteceu                               |
| `usuario`   | string             | Nome do usuário logado que realizou a ação              |
| `acao`      | string             | Tipo do evento (`contrato_criado`, `contrato_editado`, `contrato_excluido`, `pagamento_registrado`, `usuario_adicionado`, `usuario_removido`) |
| `descricao` | string             | Texto legível do evento, mostrado na aba Auditoria      |

Mantém só os últimos 300 eventos — os mais antigos são descartados automaticamente.

### Requisitos técnicos

- PHP 7.4+ (testado com PHP 8.5) com suporte a `setcookie()` com array de opções,
  `password_hash`/`password_verify` e a extensão `fileinfo` (para validar o tipo real
  dos arquivos anexados aos contratos) — vem habilitada por padrão na grande maioria
  das hospedagens e instalações de PHP
- Apache com `.htaccess` habilitado (`AllowOverride All`) para proteger as pastas
  `data/` e `contratos/`
- Nenhuma dependência de Node/npm/Composer
- Para anexar contratos maiores, confira os limites `upload_max_filesize` e
  `post_max_size` do PHP da sua hospedagem — hospedagens compartilhadas às vezes vêm
  com limites baixos (ex: 2MB) por padrão

### O que não foi implementado (por decisão consciente)

- **Notificações por e-mail** de vencimentos — exigiria SMTP configurado na hospedagem,
  sem garantia de entrega (cai em spam facilmente com `mail()` nativo do PHP). O alerta
  de vencimentos existe só dentro do site (Dashboard).

### Ideias para o futuro

- Papéis de permissão distintos entre usuários administradores (hoje todos têm o mesmo
  nível de acesso)
- Auditoria em nível de campo (valor antigo vs. novo em cada edição)
- Anexar comprovantes de pagamento, recibo em PDF por pagamento, pagamento parcial, e
  outras ideias detalhadas em `etapas.txt`
