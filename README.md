# Sistema de Gerenciamento de Aluguéis

Aplicação web simples para controlar contratos de aluguel, pagamentos, atrasos e relatórios —
pensada para donos de imóveis ou pequenas imobiliárias que só precisam de um lugar central
para acompanhar tudo isso, sem depender de planilhas.

Não usa nenhuma biblioteca externa, nenhum banco de dados e nenhum framework: é só
**HTML + CSS + JavaScript** no navegador e **PHP puro** no servidor, salvando tudo em
arquivos `.json`. Isso significa que dá pra hospedar em qualquer hospedagem compartilhada
comum (Hostinger, cPanel, etc.) e acessar de qualquer lugar pela internet.

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
   `index.js`, `api/`, `data/`) para a hospedagem, mantendo a mesma organização de pastas
3. **Acesse pelo navegador** e faça login com `admin` / `123456`
4. **Troque a senha na hora**, como explicado na seção acima
5. **Confirme que os dados estão protegidos**: tente acessar
   `https://seusite.com/data/dados.json` diretamente no navegador — o servidor deve
   recusar o acesso (erro 403). Isso só funciona em Apache com `.htaccess` habilitado
   (`AllowOverride All`), que é o padrão na maioria das hospedagens compartilhadas

## O que o sistema faz

- **Dashboard** — visão geral: quantos contratos estão ativos, quanto está em atraso no
  total, próximo vencimento, e um alerta para contratos que vencem nos próximos 5 dias
- **Contratos** — cadastrar, editar e excluir contratos de aluguel, com busca e filtros
  por ano/mês/status. Registrar pagamento em um clique
- **Atrasos** — lista separada só dos contratos vencidos, com juros e multa calculados
  automaticamente conforme a taxa configurada
- **Histórico** — todos os pagamentos já registrados, com exportação em CSV
- **Gráficos** — contratos ativos vs. atrasados vs. pagos, e evolução do atraso nos
  últimos 6 meses
- **Relatórios** — totais mês a mês e no ano, por contratos pagos/atrasados
- **Exportar/Importar** — contratos em CSV, relatório em PDF (direto do navegador, sem
  bibliotecas), e backup completo em JSON para copiar todos os dados de um lugar pra outro
- **Tema claro/escuro** — alternável a qualquer momento, fica salvo no navegador
- **Login protegido** — sessão de 30 dias, não desloga ao fechar o navegador

## Perguntas frequentes

**Preciso de banco de dados (MySQL, etc.)?**
Não. Tudo é salvo em dois arquivos JSON dentro da pasta `data/`, criados automaticamente.

**Posso ter mais de um usuário administrador?**
Não por enquanto — o sistema foi pensado para um único administrador. É uma possível
melhoria futura.

**O sistema manda e-mail avisando de vencimento?**
Não, essa decisão foi consciente (exigiria configurar SMTP na hospedagem, com risco de
cair em spam). O aviso de vencimento aparece só dentro do Dashboard quando você acessa
o sistema.

**Perdi a senha, e agora?**
Veja a seção [Acesso padrão](#acesso-padrão-leia-antes-de-usar) acima — apague
`data/auth.json` no servidor para resetar para o padrão.

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
api/account.php      POST { currentPassword, newUsername, newPassword } -> troca
                      usuário/senha em data/auth.json (exige autenticação + senha atual)

data/dados.json      Contratos, pagamentos e configuração (criado automaticamente)
data/auth.json       Usuário + hash da senha (criado automaticamente, password_hash)
data/.htaccess       Bloqueia acesso direto via URL a tudo dentro de data/
```

### Como o login funciona

O login usa um cookie de sessão assinado com HMAC-SHA256 — **não** usa `session_start()`
do PHP. Isso significa que não há estado de sessão guardado no servidor: o próprio cookie
carrega usuário + validade + assinatura, e a assinatura é validada comparando com a chave
`COOKIE_SECRET` e com o usuário atual salvo em `data/auth.json`. O cookie dura 30 dias e é
`HttpOnly` + `SameSite=Lax`.

### Arquitetura geral

- **Front-end**: `index.html` + `index.css` + `index.js`. Aplicação de página única (SPA):
  as "abas" (Dashboard, Contratos, Atrasos, Histórico, Gráficos, Relatórios, Configurações)
  são seções que aparecem/somem no mesmo HTML, sem recarregar a página.
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
| `criadoEm`         | number (timestamp)| Usado para ordenar "contratos recentes" no Dashboard    |

**Status do contrato** (calculado, não é um campo salvo): `pago` se `pago=true`;
senão `atrasado` se hoje > vencimento; senão `ativo`.

#### Pagamento (cada item de `contrato.pagamentos`)

| Campo         | Tipo   | Descrição                                  |
|---------------|--------|----------------------------------------------|
| `data`        | string `AAAA-MM-DD` | Data em que o pagamento foi feito     |
| `valor`       | number | Valor pago                                    |
| `quemRecebeu` | string | Quem recebeu (banco, PIX, transferência...)   |
| `observacao`  | string | Observação do pagamento                       |

#### Configuração (`config` em `data/dados.json`)

| Campo               | Padrão | Descrição                                            |
|---------------------|--------|--------------------------------------------------------|
| `taxaJurosMensal`   | 1 (%)  | Taxa de juros mensal aplicada sobre o total em atraso  |
| `taxaMultaPercent`  | 2 (%)  | Multa fixa aplicada uma vez que o contrato atrasa      |

Cálculo do atraso atual (função `calcAtrasoAtual` em `index.js`): se o contrato já está
atrasado, soma `valorAtrasoBase` + (`total` × `taxaJurosMensal`/100 × meses de atraso)
+ (`total` × `taxaMultaPercent`/100).

### Requisitos técnicos

- PHP 7.4+ (testado com PHP 8.5) com suporte a `setcookie()` com array de opções e
  `password_hash`/`password_verify`
- Apache com `.htaccess` habilitado (`AllowOverride All`) para proteger a pasta `data/`
- Nenhuma dependência de Node/npm/Composer

### O que não foi implementado (por decisão consciente)

- **Notificações por e-mail** de vencimentos — exigiria SMTP configurado na hospedagem,
  sem garantia de entrega (cai em spam facilmente com `mail()` nativo do PHP). O alerta
  de vencimentos existe só dentro do site (Dashboard).

### Ideias para o futuro

- Dark/Light mode com detecção automática do tema do sistema operacional
- Paginação na lista de contratos (hoje carrega tudo de uma vez)
- Relatório anual comparando ano a ano
- Múltiplos usuários administradores
