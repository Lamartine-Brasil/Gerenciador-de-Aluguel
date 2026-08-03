# SISTEMA DE GERENCIAMENTO DE ALUGUÉIS

## VISÃO GERAL
Sistema web para gerenciar contratos de aluguel, pagamentos e atrasos, acessível apenas
para o administrador autenticado. Front-end em HTML + CSS + JavaScript puro (sem
bibliotecas externas). Backend em PHP, sem banco de dados — os dados ficam em arquivos
JSON no próprio servidor.

Feito para ser hospedado em qualquer hospedagem compartilhada comum com PHP + Apache
(cPanel, Hostinger, etc.), permitindo acessar de qualquer lugar.

## ARQUITETURA
- **Front-end**: `index.html` + `index.css` + `index.js`. Aplicação de página única (SPA):
  as "abas" (Dashboard, Contratos, Atrasos, Histórico, Gráficos, Relatórios, Configurações)
  são seções que aparecem/somem no mesmo HTML, sem recarregar a página.
- **Backend**: PHP puro em `api/`, sem framework. Cada endpoint é um arquivo `.php`
  independente. Toda a comunicação front-end ↔ backend é via `fetch()` com JSON.
- **Dados**: dois arquivos JSON em `data/`, protegidos contra acesso direto via `.htaccess`:
  - `data/dados.json` — contratos, pagamentos e configuração de juros/multa
  - `data/auth.json` — usuário e hash da senha do administrador (criado automaticamente
    no primeiro acesso, com os valores padrão `admin` / `123456`)
- **Login**: cookie de sessão assinado com HMAC-SHA256 (não usa `session_start()` do PHP),
  válido por 30 dias, `HttpOnly` + `SameSite=Lax`. Isso significa que não há estado de
  sessão guardado no servidor — o próprio cookie carrega usuário + validade + assinatura,
  e é validado comparando com o usuário atual salvo em `data/auth.json`.

## ESTRUTURA DE ARQUIVOS
```
index.html          Estrutura da página (login + app com abas + modais)
index.css           Estilos (dark mode padrão + tema claro via [data-theme="light"])
index.js            Toda a lógica do front-end

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

## MODELO DE DADOS

### Contrato (cada item do array `contratos` em data/dados.json)
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

### Pagamento (cada item de `contrato.pagamentos`)
| Campo         | Tipo   | Descrição                                  |
|---------------|--------|----------------------------------------------|
| `data`        | string `AAAA-MM-DD` | Data em que o pagamento foi feito     |
| `valor`       | number | Valor pago                                    |
| `quemRecebeu` | string | Quem recebeu (banco, PIX, transferência...)   |
| `observacao`  | string | Observação do pagamento                       |

### Configuração (`config` em data/dados.json)
| Campo               | Padrão | Descrição                                            |
|---------------------|--------|--------------------------------------------------------|
| `taxaJurosMensal`   | 1 (%)  | Taxa de juros mensal aplicada sobre o total em atraso  |
| `taxaMultaPercent`  | 2 (%)  | Multa fixa aplicada uma vez que o contrato atrasa      |

Cálculo do atraso atual (função `calcAtrasoAtual` em index.js): se o contrato já está
atrasado, soma `valorAtrasoBase` + (`total` × `taxaJurosMensal`/100 × meses de atraso)
+ (`total` × `taxaMultaPercent`/100).

## FUNCIONALIDADES

### Login e conta
- Tela de login (usuário + senha), cookie de sessão de 30 dias — não desloga ao trocar
  de aba/página nem ao fechar e reabrir o navegador
- Usuário/senha padrão: `admin` / `123456` (só valem até a primeira troca)
- Botão "Sair" no topo limpa o cookie e volta para o login
- Em Configurações: trocar nome de usuário e/ou senha (exige senha atual; nova senha
  mínimo 4 caracteres, com confirmação); a sessão é renovada automaticamente

### Dashboard
- Cards: total de contratos ativos, total em atraso (R$), próximo vencimento
- Alerta destacando contratos ativos que vencem nos próximos 5 dias
  (constante `DIAS_ALERTA_VENCIMENTO` em index.js)
- Lista dos 5 contratos mais recentes

### Contratos (CRUD)
- Lista completa com busca (inquilino/imóvel) e filtros por ano, mês e status
- Adicionar, editar e excluir contrato (formulário com todos os campos do modelo acima)
- Total calculado e exibido em tempo real no formulário
- Registrar pagamento em um clique (data, valor sugerido = total + atraso atual,
  quem recebeu, observação) — marca o contrato como pago e zera o atraso base

### Atrasos
- Aba dedicada listando só os contratos com status "atrasado"
- Cálculo automático de juros/multa conforme a taxa configurada

### Histórico de pagamentos
- Aba com todos os pagamentos de todos os contratos, filtrável por contrato
- Modal de histórico por contrato (acessível pelo botão "Histórico" de cada contrato),
  com exportação CSV apenas daquele contrato

### Gráficos
- Barras: contratos ativos vs. atrasados vs. pagos
- Evolução do total em atraso nos últimos 6 meses

### Relatórios
- Aba com seletor de ano
- Tabela mês a mês: total pago, total em atraso, quantidade de contratos no período
- Cards com os totais somados do ano selecionado

### Exportação e importação
- **Exportar CSV**: contratos filtrados (respeita busca/filtros ativos)
- **Exportar PDF**: gera um relatório via `<canvas>` e abre a janela de impressão do
  navegador (usuário escolhe "Salvar como PDF") — sem nenhuma biblioteca
- **Importar CSV**: adiciona contratos em lote a partir de um CSV no mesmo formato do
  exportado (ignora linhas sem vencimento/imóvel/inquilino válidos)
- **Backup completo (JSON)**: em Configurações, baixar um `.json` com tudo
  (contratos + configuração) e restaurar a partir de um arquivo (com confirmação,
  pois substitui todos os dados atuais)

### Configurações
- Taxa de juros mensal e taxa de multa fixa (usadas no cálculo de atraso)
- Conta do administrador (usuário/senha)
- Backup do banco de dados (exportar/importar)

### Tema
- Alternância entre tema escuro (padrão) e claro, botão no topo
- Preferência salva no navegador (`localStorage`, chave `aluguelApp_theme`) — é só uma
  preferência visual, não é dado de negócio, por isso não precisa ir para o servidor

## O QUE NÃO FOI IMPLEMENTADO (por decisão consciente)
- **Notificações por e-mail** de vencimentos — decidido não implementar; exigiria SMTP
  configurado na hospedagem, sem garantia de entrega (cai em spam facilmente com
  `mail()` nativo do PHP). O alerta de vencimentos existe só dentro do site (Dashboard).

## REQUISITOS PARA RODAR
- PHP 7.4+ (testado localmente com PHP 8.5) com suporte a `setcookie()` com array de
  opções e `password_hash`/`password_verify`
- Apache com `.htaccess` habilitado (`AllowOverride All`) — padrão em hospedagem
  compartilhada. Sem Apache, a proteção de `data/` por `.htaccess` não tem efeito
  (ex: o servidor embutido `php -S` usado para testes locais ignora `.htaccess`)
- Nenhuma dependência de Node/npm/Composer — é só copiar os arquivos para o servidor

## ANTES DE SUBIR PARA PRODUÇÃO
1. Trocar `COOKIE_SECRET` em `api/config.php` por um valor aleatório único
2. Enviar a estrutura de pastas completa (`index.html`, `index.css`, `index.js`, `api/`,
   `data/`), mantendo a mesma organização de diretórios
3. Fazer login com `admin` / `123456` e trocar a senha imediatamente pela tela de
   Configurações
4. Conferir que `data/dados.json` e `data/auth.json` não são acessíveis diretamente
   pela URL (o `.htaccess` deve bloquear — só funciona em Apache real)

## COMO TESTAR LOCALMENTE
```
cd Cloudteste
php -S localhost:8000
```
Depois acessar `http://localhost:8000/` no navegador. (O servidor embutido do PHP não
processa `.htaccess` — isso só é validado de verdade em Apache/hospedagem real.)
