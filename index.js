'use strict';

/* ===================== CONSTANTS ===================== */
const API_BASE = 'api/';

const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_ALERTA_VENCIMENTO = 5;

// Texto de fábrica do recibo. O usuário edita isso em Configurações > Recibo;
// só o TEXTO é editável — os dados entram pelos códigos {{...}} (ver
// CODIGOS_RECIBO, mais abaixo), preenchidos na hora de gerar cada recibo.
const RECIBO_PADRAO = {
  titulo: 'RECIBO DE ALUGUEL',
  cidade: '',
  corpo:
`Recibo nº {{recibo_numero}}

Recebi de {{inquilino}} a importância de {{valor_pago}} ({{valor_extenso}}), referente ao aluguel do imóvel {{imovel}}, competência {{mes_referencia}}, com vencimento em {{vencimento}}.

Valor do aluguel: {{aluguel}}
Total da dívida do mês: {{total_divida}}
Forma de pagamento: {{forma_pagamento}}
Data do pagamento: {{data_pagamento}}

Para maior clareza, firmo o presente recibo, dando plena e geral quitação do valor acima, referente ao período mencionado.`,
  rodape:
`{{cidade_data}}


_______________________________________
{{quem_recebeu}}`,
};

const CONFIG_PADRAO = {
  taxaJurosMensal: 1,
  taxaMultaPercent: 2,
  corretorPercentualPadrao: 5,
  percentualReajusteSugerido: 5,
  recibo: RECIBO_PADRAO,
};

function estadoVazio() {
  return {
    contratos: [],
    config: Object.assign({}, CONFIG_PADRAO, { recibo: Object.assign({}, RECIBO_PADRAO) }),
    auditoria: [], pessoas: [], despesas: [], imoveis: [], carteiras: [],
  };
}

/* ===================== STATE =====================
 * Cada item de state.contratos representa UM contrato de aluguel (um imóvel +
 * um inquilino), e guarda dentro de si a lista `dividas`: uma por mês/ciclo de
 * cobrança (vencimento, valores, se foi paga, pagamentos). Isso permite um
 * contrato antigo já nascer com várias dívidas em aberto (uma por mês em
 * atraso), em vez de virar vários "contratos" separados.
 */
let state = estadoVazio();
let currentUsername = '';

function setCurrentUsername(username) {
  currentUsername = username || '';
  document.getElementById('currentUserName').textContent = currentUsername;
}

/* ===================== TEMA (claro/escuro) ===================== */
const THEME_KEY = 'aluguelApp_theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('btnThemeToggle').innerHTML = icon(theme === 'light' ? 'sun' : 'moon');
  // Os gráficos usam cores lidas do CSS no momento do desenho — se o tema mudar
  // enquanto a aba está aberta, precisam ser redesenhados para não ficar com
  // cores do tema anterior (ex: texto claro sobre fundo claro).
  const graficosTab = document.getElementById('tab-graficos');
  if (graficosTab && graficosTab.classList.contains('active') && typeof renderCharts === 'function') {
    renderCharts();
  }
}

function systemPrefersLight() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved || (systemPrefersLight() ? 'light' : 'dark'));

  // Enquanto o usuário nunca escolheu um tema manualmente, acompanha
  // mudanças no tema do sistema operacional em tempo real.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
      if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches ? 'light' : 'dark');
    });
  }
}

document.getElementById('btnThemeToggle').addEventListener('click', () => {
  const atual = document.documentElement.getAttribute('data-theme') || 'dark';
  const novo = atual === 'light' ? 'dark' : 'light';
  localStorage.setItem(THEME_KEY, novo);
  applyTheme(novo);
});

initTheme();

/* ===================== API ===================== */
async function apiFetch(path, options = {}) {
  return fetch(API_BASE + path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
}

async function fetchState() {
  const res = await apiFetch('data.php');
  if (!res.ok) throw new Error('Falha ao carregar dados do servidor.');
  const data = await res.json();
  data.contratos = data.contratos || [];
  data.config = Object.assign({}, CONFIG_PADRAO, data.config || {});
  // o recibo é um objeto dentro de config — precisa de merge próprio, senão uma
  // instalação antiga (sem `recibo`) ou com o objeto pela metade fica sem texto
  data.config.recibo = Object.assign({}, RECIBO_PADRAO, data.config.recibo || {});
  data.auditoria = data.auditoria || [];
  data.carteiras = data.carteiras || [];
  // pessoas substitui o antigo cadastro "corretores" (agora serve tanto para
  // quem recebe quanto para corretor) — migra dados antigos automaticamente.
  data.pessoas = data.pessoas || data.corretores || [];
  delete data.corretores;
  data.despesas = data.despesas || [];
  data.imoveis = data.imoveis || [];
  return data;
}

async function saveState() {
  try {
    const res = await apiFetch('data.php', { method: 'POST', body: JSON.stringify(state) });
    if (!res.ok) throw new Error('Falha ao salvar dados no servidor.');
  } catch (e) {
    showToast('Erro ao salvar dados no servidor.', 'error');
  }
}

/* ===================== HELPERS ===================== */
function uuid() {
  return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

const AUDITORIA_MAX = 300;

// `alteracoes` (opcional) é uma lista de { campo, de, para } — o diff campo a
// campo de uma edição, exibido em detalhe na aba Auditoria. Chamadas que não
// passam esse argumento continuam funcionando normalmente (viram []).
function registrarAuditoria(acao, descricao, alteracoes) {
  state.auditoria = state.auditoria || [];
  state.auditoria.push({
    id: uuid(),
    timestamp: Date.now(),
    usuario: currentUsername || '--',
    acao,
    descricao,
    alteracoes: alteracoes || [],
  });
  if (state.auditoria.length > AUDITORIA_MAX) {
    state.auditoria = state.auditoria.slice(-AUDITORIA_MAX);
  }
}

// Compara um objeto "antes" e "depois" campo a campo (só os campos listados
// em `labels`, um mapa campo -> rótulo legível) e devolve só os que
// realmente mudaram — usado para montar o diff da Auditoria.
function diffCampos(antes, depois, labels) {
  const alteracoes = [];
  Object.keys(labels).forEach(campo => {
    const de = antes[campo];
    const para = depois[campo];
    if (de !== para) {
      alteracoes.push({ campo: labels[campo], de, para });
    }
  });
  return alteracoes;
}

// Formata um valor de diff para exibição — cai para "vazio" strings em
// branco/undefined, e usa a mesma formatação de moeda/data quando o rótulo
// indicar isso (evita "1000" cru quando o campo é um valor em R$).
function formatDiffValor(valor) {
  if (valor === '' || valor === undefined || valor === null) return '(vazio)';
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  return String(valor);
}

function parseDate(dateStr) {
  return new Date(dateStr + 'T00:00:00');
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Calcula o primeiro vencimento a partir da data de início do contrato e do
// dia de pagamento escolhido. O mês de entrada nunca gera cobrança automática
// — o primeiro vencimento cai sempre no mês seguinte ao de início, no dia de
// pagamento escolhido (ex: início 03-06-2023 + dia 1 -> primeiro vencimento
// 01-07-2023). Se o dia de pagamento não existir naquele mês (ex: dia 31 em
// fevereiro), usa o último dia do mês.
function primeiroVencimento(dataInicioStr, diaPagamento) {
  const [y, m] = dataInicioStr.split('-').map(Number);
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = m % 12; // já é o mês seguinte (0-indexado)
  const diasNoMes = new Date(targetYear, targetMonth + 1, 0).getDate();
  const dia = Math.min(diaPagamento, diasNoMes);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// Soma N meses a uma data "AAAA-MM-DD", mantendo o mesmo dia do mês sempre que
// possível (ex: 31 de janeiro + 1 mês vira 28/29 de fevereiro, não 2/3 de março).
function addMonthsClamped(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const totalMonths = (m - 1) + n;
  const targetYear = y + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const diasNoMesAlvo = new Date(targetYear, targetMonth + 1, 0).getDate();
  const targetDay = Math.min(d, diasNoMesAlvo);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}

// Data do próximo "aniversário" de reajuste de um contrato: 1 ano após o
// último reajuste (ou após o início do contrato, se nunca foi reajustado).
function dataAniversarioReajuste(c) {
  return addMonthsClamped(c.dataUltimoReajuste || c.dataInicio, 12);
}

// Quantos anos/meses completos já se passaram desde o início do contrato
// até hoje (ex: início 10-01-2024, hoje 04-08-2026 -> {anos: 2, meses: 6}).
function tempoDeContrato(dataInicioStr) {
  const hoje = new Date();
  const [y, m, d] = dataInicioStr.split('-').map(Number);
  const inicio = new Date(y, m - 1, d);
  let anos = hoje.getFullYear() - inicio.getFullYear();
  let meses = hoje.getMonth() - inicio.getMonth();
  if (hoje.getDate() < inicio.getDate()) meses--;
  if (meses < 0) { anos--; meses += 12; }
  return { anos, meses };
}

// Texto pronto para exibição (ex: "2 anos e 6 meses", "1 ano", "8 meses",
// "recém-iniciado" para menos de 1 mês).
function formatTempoDeContrato(dataInicioStr) {
  const { anos, meses } = tempoDeContrato(dataInicioStr);
  const partes = [];
  if (anos > 0) partes.push(`${anos} ${anos === 1 ? 'ano' : 'anos'}`);
  if (meses > 0) partes.push(`${meses} ${meses === 1 ? 'mês' : 'meses'}`);
  return partes.length ? partes.join(' e ') : 'recém-iniciado (menos de 1 mês)';
}

// Um contrato "precisa" de reajuste quando já passou (ou é hoje) o
// aniversário e ele ainda está ativo (não encerrado). Não há índice externo
// (IGP-M/IPCA) real consultado — o sistema não tem acesso à internet — então
// a sugestão usa um percentual configurável em Configurações como estimativa.
function precisaReajuste(c) {
  if (c.encerrado || !c.dataInicio) return false;
  return dataAniversarioReajuste(c) <= todayStr();
}

function valorReajusteSugerido(c) {
  const percentual = state.config.percentualReajusteSugerido || 0;
  return c.aluguel * (1 + percentual / 100);
}

// A partir de um vencimento inicial, gera a lista de vencimentos mensais
// (mesmo dia do mês) até o mês mais recente que já venceu (sem passar de hoje).
function gerarVencimentosAtePresente(vencimentoInicial) {
  const hoje = todayStr();
  const lista = [vencimentoInicial];
  for (let i = 1; i <= 360; i++) {
    const proximo = addMonthsClamped(vencimentoInicial, i);
    if (proximo > hoje) break;
    lista.push(proximo);
  }
  return lista;
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  const d = parseDate(dateStr);
  return String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + d.getFullYear();
}

function formatCurrency(value) {
  return (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function icon(nome) {
  return `<svg class="icon"><use href="#icon-${nome}"></use></svg>`;
}

function formatDateTime(timestamp) {
  const d = new Date(timestamp);
  const data = String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + d.getFullYear();
  const hora = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return `${data} ${hora}`;
}

// As funções abaixo operam sempre em uma "dívida" (um ciclo de cobrança:
// vencimento, total, pago, valorAtrasoBase) — nunca no contrato inteiro.
// O condomínio pode ser pago de duas formas, e isso muda a conta inteira:
//   junto com o aluguel  → é cobrado do inquilino (entra no total a cobrar) e
//                          depois repassado (sai de novo no total líquido)
//   direto pelo inquilino → o dinheiro nunca passa pelo proprietário: não entra
//                          no total a cobrar nem sai do líquido, fica só como
//                          anotação de quanto é
function condominioCobrado(d) {
  return d.condominioDireto ? 0 : (Number(d.condominio) || 0);
}

function calcTotal(d) {
  return (Number(d.aluguel) || 0) - (Number(d.desconto) || 0) + (Number(d.juros) || 0) + (Number(d.multa) || 0) + condominioCobrado(d);
}

function diasAtraso(d) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const venc = parseDate(d.vencimento);
  const diff = Math.floor((hoje - venc) / 86400000);
  return diff > 0 ? diff : 0;
}

function calcAtrasoAtual(d) {
  if (d.pago) return 0;
  const dias = diasAtraso(d);
  if (dias <= 0) return Number(d.valorAtrasoBase) || 0;
  const meses = dias / 30;
  const jurosCalc = d.total * (state.config.taxaJurosMensal / 100) * meses;
  const multaCalc = d.total * (state.config.taxaMultaPercent / 100);
  return (Number(d.valorAtrasoBase) || 0) + jurosCalc + multaCalc;
}

function getStatus(d) {
  if (d.pago) return 'pago';
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const venc = parseDate(d.vencimento);
  return hoje > venc ? 'atrasado' : 'ativo';
}

function statusLabel(status) {
  return { ativo: 'Ativo', atrasado: 'Atrasado', pago: 'Pago' }[status] || status;
}

/* ---- As duas pontas de cada dívida: o que se cobra e o que sobra ----
 * O sistema trabalha com DOIS totais, e eles não são a mesma coisa:
 *
 *   Total a cobrar = aluguel − desconto + juros + multa + condomínio
 *                    (o que o inquilino deve; base de juros/multa e do recibo)
 *   Total líquido  = total a cobrar − comissão do corretor − condomínio
 *                    (o que de fato sobra para o proprietário)
 *
 * A comissão do corretor e o condomínio SUBTRAEM, porque são repassados: o
 * dinheiro passa pela mão do proprietário mas não fica com ele. A diferença é
 * que o condomínio é cobrado do inquilino (entra no total a cobrar e sai
 * de novo no líquido), enquanto a comissão nunca é cobrada dele — sai só do
 * lado do proprietário.
 */

// Comissão do corretor sobre uma dívida (0 quando o contrato não tem corretor).
function comissaoCorretor(c, d) {
  if (!c || !c.corretorNome) return 0;
  return (Number(d.aluguel) || 0) * (Number(c.corretorPercentual) || 0) / 100;
}

// Soma das deduções de uma dívida (o que é repassado a terceiros). O condomínio
// só deduz quando foi cobrado junto com o aluguel — pago direto pelo inquilino,
// não há o que repassar.
function deducoesDivida(c, d) {
  return comissaoCorretor(c, d) + condominioCobrado(d);
}

function totalLiquidoDivida(c, d) {
  return (Number(d.total) || 0) - deducoesDivida(c, d);
}

// O líquido de um PAGAMENTO concreto é o que foi pago menos o que vai ser
// repassado. A comissão do corretor sempre sai. O condomínio só sai quando ele
// de fato veio junto neste pagamento — informado na hora de registrar, e por
// padrão NÃO vem (o normal é o inquilino pagar o condomínio direto).
// Pagamentos antigos, gravados antes desse campo existir, herdam a regra da
// dívida: se o condomínio era cobrado junto, ele estava embutido no valor.
function condominioNoPagamento(d, p) {
  if (p.condominioRecebido === undefined) return condominioCobrado(d);
  return p.condominioRecebido ? (Number(d.condominio) || 0) : 0;
}

function valorLiquidoPagamento(c, d, p) {
  return (Number(p.valor) || 0) - comissaoCorretor(c, d) - condominioNoPagamento(d, p);
}

function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast' + (type ? ' toast-' + type : '');
  toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add('hidden'), 2600);
}

/* ===================== MODELO: CONTRATO / DÍVIDA =====================
 * migrarContratos(): converte o formato antigo (um "contrato" plano = um
 * vencimento só) para o novo formato (contrato com array de dívidas). Roda
 * uma vez, automaticamente, na primeira vez que os dados são carregados.
 * Contratos antigos que compartilham imóvel+inquilino+dataInicio+diaPagamento
 * são agrupados num único contrato com várias dívidas; os demais viram um
 * contrato com uma única dívida (sem perder nenhum dado).
 */
function precisaMigrarContratos(contratos) {
  return contratos.some(c => !Array.isArray(c.dividas));
}

function migrarContratos(contratosAntigos) {
  const grupos = new Map();
  const semGrupo = [];

  contratosAntigos.forEach(c => {
    if (Array.isArray(c.dividas)) {
      // já está no formato novo — mantém como está
      semGrupo.push(c);
      return;
    }

    const divida = {
      id: c.id || uuid(),
      vencimento: c.vencimento,
      aluguel: Number(c.aluguel) || 0,
      desconto: Number(c.desconto) || 0,
      juros: Number(c.juros) || 0,
      multa: Number(c.multa) || 0,
      condominio: Number(c.condominio) || 0,
      total: Number(c.total) || calcTotal(c),
      valorAtrasoBase: Number(c.valorAtrasoBase) || 0,
      observacao: c.observacao || '',
      pago: !!c.pago,
      dataPagamento: c.dataPagamento || null,
      pagamentos: c.pagamentos || [],
      criadoEm: c.criadoEm || Date.now(),
    };

    if (c.dataInicio && c.diaPagamento) {
      const chave = `${c.imovel}|||${c.inquilino}|||${c.dataInicio}|||${c.diaPagamento}`;
      if (!grupos.has(chave)) {
        grupos.set(chave, {
          id: uuid(),
          imovel: c.imovel,
          inquilino: c.inquilino,
          quemRecebeu: c.quemRecebeu || '',
          dataInicio: c.dataInicio,
          diaPagamento: c.diaPagamento,
          aluguel: divida.aluguel,
          desconto: divida.desconto,
          juros: divida.juros,
          multa: divida.multa,
          condominio: divida.condominio,
          anexoContrato: c.anexoContrato || null,
          criadoEm: divida.criadoEm,
          dividas: [],
        });
      }
      const grupo = grupos.get(chave);
      grupo.dividas.push(divida);
      if (c.anexoContrato && !grupo.anexoContrato) grupo.anexoContrato = c.anexoContrato;
      if (divida.criadoEm < grupo.criadoEm) grupo.criadoEm = divida.criadoEm;
    } else {
      semGrupo.push({
        id: uuid(),
        imovel: c.imovel,
        inquilino: c.inquilino,
        quemRecebeu: c.quemRecebeu || '',
        dataInicio: c.dataInicio || c.vencimento,
        diaPagamento: c.diaPagamento || parseDate(c.vencimento).getDate(),
        aluguel: divida.aluguel,
        desconto: divida.desconto,
        juros: divida.juros,
        multa: divida.multa,
        condominio: divida.condominio,
        anexoContrato: c.anexoContrato || null,
        criadoEm: divida.criadoEm,
        dividas: [divida],
      });
    }
  });

  const novos = [...grupos.values(), ...semGrupo];
  novos.forEach(g => g.dividas.sort((a, b) => a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0));
  return novos;
}

/* ===================== CARTEIRAS (multi-imóvel / multi-proprietário) =====================
 * Uma carteira agrupa os contratos de um mesmo proprietário — pensado para quem
 * administra imóveis de terceiros. É opcional: sem nenhuma carteira cadastrada,
 * o seletor do topo nem aparece e o sistema se comporta exatamente como antes.
 *
 * Com uma carteira escolhida no topo, TODAS as telas passam a enxergar só os
 * contratos (e as despesas/imóveis) dela. Isso é feito num ponto só: as funções
 * `contratosVisiveis()` / `despesasVisiveis()` / `imoveisVisiveis()` abaixo, que
 * substituem `state.contratos` / `state.despesas` / `state.imoveis` em tudo que
 * é leitura para exibir ou somar. Escrita (criar/editar/excluir) continua indo
 * direto no `state`, porque aí o alvo é sempre um item específico por id.
 */
const CARTEIRA_KEY = 'aluguelApp_carteira';
let carteiraAtiva = '';

try {
  carteiraAtiva = localStorage.getItem(CARTEIRA_KEY) || '';
} catch (e) {
  carteiraAtiva = '';
}

function carteiraPorId(id) {
  return state.carteiras.find(x => x.id === id) || null;
}

// Nome legível de uma carteira. Uma carteira que foi removida depois de já ter
// sido usada num contrato não deixa o contrato "órfão": ele volta a contar como
// sem carteira (imóvel próprio).
function carteiraNome(id) {
  const c = carteiraPorId(id);
  return c ? c.nome : '';
}

function contratoNaCarteira(c, carteiraId) {
  if (!carteiraId) return true;
  return (c.carteiraId || '') === carteiraId;
}

function contratosVisiveis() {
  if (!carteiraAtiva) return state.contratos;
  return state.contratos.filter(c => contratoNaCarteira(c, carteiraAtiva));
}

// Uma despesa ligada a um contrato pertence à carteira DESSE contrato (a fonte
// da verdade é sempre o contrato, mesmo que a despesa tenha sido criada antes de
// a carteira existir); uma despesa geral usa a carteira escolhida nela mesma.
function carteiraDaDespesa(d) {
  if (d.contratoId) {
    const c = state.contratos.find(x => x.id === d.contratoId);
    return c ? (c.carteiraId || '') : '';
  }
  return d.carteiraId || '';
}

function despesasVisiveis() {
  if (!carteiraAtiva) return state.despesas;
  return state.despesas.filter(d => carteiraDaDespesa(d) === carteiraAtiva);
}

function imoveisVisiveis() {
  if (!carteiraAtiva) return state.imoveis;
  return state.imoveis.filter(i => (i.carteiraId || '') === carteiraAtiva);
}

// Pessoas seguem uma regra própria: quem NÃO tem carteira aparece em todas (é o
// caso de quem atende o sistema inteiro, o próprio proprietário-administrador),
// e quem tem carteira só aparece na dela. Diferente de contratos e imóveis, em
// que "sem carteira" significa um grupo à parte.
function pessoasVisiveis() {
  if (!carteiraAtiva) return state.pessoas;
  return state.pessoas.filter(p => !p.carteiraId || p.carteiraId === carteiraAtiva);
}

// Preenche um <select> de carteira (formulários de contrato, imóvel e despesa).
function populateCarteiraSelect(selectEl, valorAtual) {
  const atual = valorAtual || '';
  selectEl.innerHTML = '<option value="">Nenhuma (imóvel próprio)</option>' +
    state.carteiras.map(c => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
  selectEl.value = state.carteiras.some(c => c.id === atual) ? atual : '';
}

// Mostra/esconde de uma vez os campos "Carteira" espalhados pelos formulários:
// quem não usa carteiras nunca vê o campo.
function atualizarVisibilidadeCamposCarteira() {
  const usa = state.carteiras.length > 0;
  ['fCampoCarteira', 'infoCampoCarteira', 'campoNewImovelCarteira'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !usa);
  });
  const campoDesp = document.getElementById('campoDespCarteira');
  if (campoDesp) {
    const contratoEscolhido = !!document.getElementById('despContrato').value;
    campoDesp.classList.toggle('hidden', !usa || contratoEscolhido);
  }
}

function renderCarteiraSeletor() {
  const wrap = document.getElementById('carteiraSeletorWrap');
  const select = document.getElementById('carteiraSeletor');
  wrap.classList.toggle('hidden', state.carteiras.length === 0);

  // uma carteira excluída deixa de ser a ativa (volta a "Todas")
  if (carteiraAtiva && !carteiraPorId(carteiraAtiva)) definirCarteiraAtiva('', true);

  select.innerHTML = '<option value="">Todas as carteiras</option>' +
    state.carteiras.map(c => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
  select.value = carteiraAtiva;
}

function definirCarteiraAtiva(id, silencioso) {
  carteiraAtiva = id || '';
  try {
    if (carteiraAtiva) localStorage.setItem(CARTEIRA_KEY, carteiraAtiva);
    else localStorage.removeItem(CARTEIRA_KEY);
  } catch (e) { /* navegador sem localStorage: filtro vale só nesta sessão */ }
  if (!silencioso) {
    contratosPaginaAtual = 1;
    renderAll();
    showToast(carteiraAtiva ? `Mostrando só a carteira "${carteiraNome(carteiraAtiva)}".` : 'Mostrando todas as carteiras.', 'success');
  }
}

// Retorna todas as dívidas de todos os contratos, "achatadas" numa lista só,
// cada uma já com os dados do contrato pai (imóvel, inquilino etc.) juntos —
// usada por todas as telas que listam/somam por mês (Dashboard, Atrasos,
// Histórico, Gráficos, Relatórios, Calendário, exportações).
function todasDividas() {
  const lista = [];
  contratosVisiveis().forEach(c => {
    (c.dividas || []).forEach(d => {
      lista.push({
        ...d,
        contratoId: c.id,
        numero: c.numero,
        imovel: c.imovel,
        inquilino: c.inquilino,
        quemRecebeu: c.quemRecebeu,
        anexoContrato: c.anexoContrato,
        dataInicio: c.dataInicio,
        diaPagamento: c.diaPagamento,
        corretorNome: c.corretorNome,
        corretorPercentual: c.corretorPercentual,
        carteiraId: c.carteiraId || '',
      });
    });
  });
  return lista;
}

// Localiza uma dívida específica e devolve ela junto com o contrato pai
// (para poder editar os dois quando necessário).
function encontrarDivida(dividaId) {
  for (const c of state.contratos) {
    const d = (c.dividas || []).find(x => x.id === dividaId);
    if (d) return { contrato: c, divida: d };
  }
  return null;
}

// Número sequencial usado só para identificar o contrato (ex: "Contrato #12"),
// sem relação com o `id` interno (uuid). O próximo número é sempre
// max(números existentes) + 1, então nunca se repete mesmo depois de excluir
// contratos antigos.
function proximoNumeroContrato() {
  const max = state.contratos.reduce((m, c) => Math.max(m, Number(c.numero) || 0), 0);
  return max + 1;
}

// Contratos de instalações antigas (antes deste campo existir) não têm
// `numero` — atribui um a cada um, na ordem de criação, sem repetir.
function precisaMigrarNumerosContrato(contratos) {
  return contratos.some(c => !c.numero);
}

function migrarNumerosContrato(contratos) {
  const ordenados = contratos.slice().sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
  let proximo = 1;
  ordenados.forEach(c => {
    if (!c.numero) c.numero = proximo;
    proximo = Math.max(proximo, c.numero) + 1;
  });
  return contratos;
}

/* ===================== AUTH ===================== */
const loginScreen = document.getElementById('loginScreen');
const appEl = document.getElementById('app');

async function checkSession() {
  try {
    const res = await apiFetch('session.php');
    if (!res.ok) return null;
    const data = await res.json();
    return data.authenticated ? data : null;
  } catch (e) {
    return null;
  }
}

async function showApp() {
  loginScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  try {
    state = await fetchState();
    if (precisaMigrarContratos(state.contratos)) {
      state.contratos = migrarContratos(state.contratos);
      await saveState();
    }
    if (precisaMigrarNumerosContrato(state.contratos)) {
      state.contratos = migrarNumerosContrato(state.contratos);
      await saveState();
    }
    // roda sozinho a cada vez que o sistema é aberto — não depende de o
    // usuário lembrar de clicar em "Atualizar dívidas"
    atualizarTodasDividas(true);
  } catch (e) {
    showToast('Não foi possível carregar os dados do servidor.', 'error');
  }
  renderAll();
  renderUsuarios();
}

function showLogin() {
  appEl.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  document.getElementById('loginForm').reset();
}

const formLogin = document.getElementById('loginForm');

formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  const errorEl = document.getElementById('loginError');
  const submitBtn = formLogin.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const res = await apiFetch('login.php', {
      method: 'POST',
      body: JSON.stringify({ username: user, password: pass }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      errorEl.classList.add('hidden');
      setCurrentUsername(data.username);
      await showApp();
    } else {
      errorEl.textContent = data.error || 'Usuário ou senha incorretos.';
      errorEl.classList.remove('hidden');
    }
  } catch (err) {
    errorEl.textContent = 'Não foi possível conectar ao servidor.';
    errorEl.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById('btnLogout').addEventListener('click', async () => {
  try { await apiFetch('logout.php', { method: 'POST' }); } catch (e) { /* segue para tela de login mesmo assim */ }
  showLogin();
});

document.getElementById('btnAtualizarTodasDividas').addEventListener('click', () => {
  atualizarTodasDividas(false);
});

/* ===================== TABS ===================== */
document.getElementById('tabsNav').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  if (btn.dataset.tab === 'graficos') renderCharts();
  if (btn.dataset.tab === 'relatorios') renderRelatorios();
  if (btn.dataset.tab === 'auditoria') renderAuditoria();
  if (btn.dataset.tab === 'calendario') renderCalendario();
  if (btn.dataset.tab === 'despesas') renderDespesas();
  if (btn.dataset.tab === 'imoveis') renderImoveis();
  if (btn.dataset.tab === 'usuarios') renderUsuarios();
});

/* ===================== MODALS ===================== */
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) {
      overlay.classList.add('hidden');
    }
  });
});

/* ===================== ATALHOS DE TECLADO ===================== */
function modalAberto() {
  return Array.from(document.querySelectorAll('.modal-overlay')).find(m => !m.classList.contains('hidden'));
}

document.addEventListener('keydown', (e) => {
  if (appEl.classList.contains('hidden')) return; // não logado ainda

  if (e.key === 'Escape') {
    const aberto = modalAberto();
    if (aberto) aberto.classList.add('hidden');
    return;
  }

  const alvo = document.activeElement;
  const editando = alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.tagName === 'SELECT' || alvo.isContentEditable);
  if (editando || modalAberto() || e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === 'n') {
    e.preventDefault();
    document.querySelector('.tab-btn[data-tab="contratos"]').click();
    document.getElementById('btnNovoContrato').click();
  } else if (e.key === '/') {
    e.preventDefault();
    document.querySelector('.tab-btn[data-tab="contratos"]').click();
    document.getElementById('searchContratos').focus();
  }
});

/* ===================== CONTRATO / DÍVIDA FORM ===================== */
const formContrato = document.getElementById('formContrato');

const LABELS_DIVIDA = {
  vencimento: 'Vencimento', aluguel: 'Aluguel (R$)', desconto: 'Desconto (R$)',
  juros: 'Juros (R$)', multa: 'Multa (R$)', condominio: 'Condomínio (R$)',
  condominioDireto: 'Condomínio pago direto pelo inquilino',
  valorAtrasoBase: 'Valor em atraso (R$)', observacao: 'Observação',
};

// Na criação, Juros/Multa são digitados em % (do aluguel) e convertidos para
// R$ aqui só para a prévia; na edição de uma dívida já existente, são digitados
// direto em R$ (valor fixo daquele mês).
function updateTotalPreview() {
  const criando = !document.getElementById('dividaId').value;
  const aluguel = Number(document.getElementById('fAluguel').value) || 0;
  const juros = criando
    ? aluguel * (Number(document.getElementById('fJurosPercentual').value) || 0) / 100
    : (Number(document.getElementById('fJuros').value) || 0);
  const multa = criando
    ? aluguel * (Number(document.getElementById('fMultaPercentual').value) || 0) / 100
    : (Number(document.getElementById('fMulta').value) || 0);
  const condominioDireto = document.getElementById('fCondominioDireto').value === '1';
  const condominioValor = Number(document.getElementById('fCondominio').value) || 0;
  const condominio = condominioDireto ? 0 : condominioValor;
  const total = calcTotal({
    aluguel,
    desconto: document.getElementById('fDesconto').value,
    juros,
    multa,
    condominio,
  });
  document.getElementById('fTotalPreview').textContent = formatCurrency(total);

  // Prévia do líquido: só aparece quando existe alguma dedução (corretor ou
  // condomínio). Na edição de uma dívida o corretor não está no formulário —
  // vem do contrato pai.
  let percentualCorretor = 0;
  if (criando) {
    percentualCorretor = document.getElementById('fCorretorNome').value
      ? (Number(document.getElementById('fCorretorPercentual').value) || 0)
      : 0;
  } else {
    const achado = encontrarDivida(document.getElementById('dividaId').value);
    const c = achado && achado.contrato;
    percentualCorretor = c && c.corretorNome ? (Number(c.corretorPercentual) || 0) : 0;
  }
  const comissao = aluguel * percentualCorretor / 100;
  const temDeducoes = comissao > 0 || condominio > 0;
  document.getElementById('fLiquidoPreviewWrap').classList.toggle('hidden', !temDeducoes);
  document.getElementById('fLiquidoPreview').textContent = formatCurrency(total - comissao - condominio);
}

['fAluguel', 'fDesconto', 'fJuros', 'fMulta', 'fJurosPercentual', 'fMultaPercentual', 'fCondominio'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateTotalPreview);
});
document.getElementById('fCondominioDireto').addEventListener('change', updateTotalPreview);

// Escolher um imóvel que já está vinculado a uma carteira preenche a carteira do
// contrato sozinho — quem cadastrou o imóvel sob um proprietário não precisa
// repetir isso a cada contrato (dá para trocar manualmente depois).
document.getElementById('fImovel').addEventListener('change', () => {
  const nome = document.getElementById('fImovel').value;
  const imovel = state.imoveis.find(i => i.nome === nome);
  if (imovel && imovel.carteiraId) {
    document.getElementById('fCarteira').value = imovel.carteiraId;
  }
});

document.getElementById('btnNovoContrato').addEventListener('click', () => {
  formContrato.reset();
  document.getElementById('contratoId').value = '';
  document.getElementById('dividaId').value = '';
  document.getElementById('modalContratoTitle').textContent = 'Novo contrato';
  document.getElementById('fDataInicio').value = todayStr();
  document.getElementById('fDiaPagamento').value = new Date().getDate();
  document.getElementById('fJurosPercentual').value = state.config.taxaJurosMensal || '';
  document.getElementById('fMultaPercentual').value = state.config.taxaMultaPercent || '';
  document.getElementById('fCampoDataInicio').classList.remove('hidden');
  document.getElementById('fCampoDiaPagamento').classList.remove('hidden');
  document.getElementById('fCampoImovel').classList.remove('hidden');
  populateImovelSelect(document.getElementById('fImovel'), '');
  document.getElementById('fSemImovelHint').classList.toggle('hidden', imoveisVisiveis().length > 0);
  populateCarteiraSelect(document.getElementById('fCarteira'), carteiraAtiva);
  atualizarVisibilidadeCamposCarteira();
  document.getElementById('fCampoInquilino').classList.remove('hidden');
  document.getElementById('fCampoQuemRecebeu').classList.remove('hidden');
  populatePessoaSelect(document.getElementById('fQuemRecebeu'), '', 'Nenhum / outro');
  document.getElementById('fCampoVencimento').classList.add('hidden');
  document.getElementById('fCampoCaucao').classList.remove('hidden');
  document.getElementById('fCaucaoHint').classList.remove('hidden');
  document.getElementById('fCaucao').value = '';
  document.getElementById('fCampoJurosPercentual').classList.remove('hidden');
  document.getElementById('fCampoMultaPercentual').classList.remove('hidden');
  document.getElementById('fCampoJuros').classList.add('hidden');
  document.getElementById('fCampoMulta').classList.add('hidden');
  document.getElementById('fCampoCorretorNome').classList.remove('hidden');
  document.getElementById('fCampoCorretorPercentual').classList.remove('hidden');
  populatePessoaSelect(document.getElementById('fCorretorNome'), '', 'Nenhum (sem corretor)');
  document.getElementById('fCampoCorretorPercentual').classList.add('hidden');
  document.getElementById('fCorretorPercentual').value = 0;
  document.getElementById('fCorretorHint').classList.remove('hidden');
  document.getElementById('fDataInicio').required = true;
  document.getElementById('fDiaPagamento').required = true;
  document.getElementById('fImovel').required = true;
  document.getElementById('fInquilino').required = true;
  document.getElementById('fVencimento').required = false;
  document.getElementById('fRetroativoHint').classList.remove('hidden');
  updateTotalPreview();
  openModal('modalContrato');
});

function openEditDivida(dividaId) {
  const achado = encontrarDivida(dividaId);
  if (!achado) return;
  const { contrato: c, divida: d } = achado;
  document.getElementById('contratoId').value = c.id;
  document.getElementById('dividaId').value = d.id;
  document.getElementById('fVencimento').value = d.vencimento;
  document.getElementById('fAluguel').value = d.aluguel;
  document.getElementById('fDesconto').value = d.desconto || '';
  document.getElementById('fJuros').value = d.juros || '';
  document.getElementById('fMulta').value = d.multa || '';
  document.getElementById('fCondominio').value = d.condominio || '';
  document.getElementById('fCondominioDireto').value = d.condominioDireto ? '1' : '0';
  document.getElementById('fValorAtraso').value = d.valorAtrasoBase || '';
  document.getElementById('fObservacao').value = d.observacao || '';
  document.getElementById('modalContratoTitle').textContent = `Editar dívida — ${c.imovel} (${c.inquilino})`;
  document.getElementById('fCampoDataInicio').classList.add('hidden');
  document.getElementById('fCampoDiaPagamento').classList.add('hidden');
  document.getElementById('fCampoImovel').classList.add('hidden');
  document.getElementById('fCampoCarteira').classList.add('hidden');
  document.getElementById('fCampoInquilino').classList.add('hidden');
  document.getElementById('fCampoQuemRecebeu').classList.add('hidden');
  document.getElementById('fCampoVencimento').classList.remove('hidden');
  document.getElementById('fCampoJurosPercentual').classList.add('hidden');
  document.getElementById('fCampoMultaPercentual').classList.add('hidden');
  document.getElementById('fCampoJuros').classList.remove('hidden');
  document.getElementById('fCampoMulta').classList.remove('hidden');
  document.getElementById('fCampoCorretorNome').classList.add('hidden');
  document.getElementById('fCampoCorretorPercentual').classList.add('hidden');
  document.getElementById('fCorretorHint').classList.add('hidden');
  document.getElementById('fCampoCaucao').classList.add('hidden');
  document.getElementById('fCaucaoHint').classList.add('hidden');
  document.getElementById('fSemImovelHint').classList.add('hidden');
  document.getElementById('fDataInicio').required = false;
  document.getElementById('fDiaPagamento').required = false;
  document.getElementById('fImovel').required = false;
  document.getElementById('fInquilino').required = false;
  document.getElementById('fVencimento').required = true;
  document.getElementById('fRetroativoHint').classList.add('hidden');
  updateTotalPreview();
  openModal('modalContrato');
}

formContrato.addEventListener('submit', (e) => {
  e.preventDefault();
  const dividaId = document.getElementById('dividaId').value;
  const aluguelValue = Number(document.getElementById('fAluguel').value) || 0;

  // Na edição de uma dívida já existente, juros/multa são digitados direto em
  // R$ (valor fixo daquele mês). Na criação de um contrato novo, são digitados
  // em % do aluguel (padrão vindo da taxa de juros/multa de Configurações) e
  // convertidos para R$ aqui — a partir daí a dívida guarda só o valor em R$.
  let jurosValue, multaValue;
  if (dividaId) {
    jurosValue = Number(document.getElementById('fJuros').value) || 0;
    multaValue = Number(document.getElementById('fMulta').value) || 0;
  } else {
    const jurosPct = Number(document.getElementById('fJurosPercentual').value) || 0;
    const multaPct = Number(document.getElementById('fMultaPercentual').value) || 0;
    jurosValue = aluguelValue * jurosPct / 100;
    multaValue = aluguelValue * multaPct / 100;
  }

  const camposDivida = {
    aluguel: aluguelValue,
    desconto: Number(document.getElementById('fDesconto').value) || 0,
    juros: jurosValue,
    multa: multaValue,
    condominio: Number(document.getElementById('fCondominio').value) || 0,
    condominioDireto: document.getElementById('fCondominioDireto').value === '1',
    valorAtrasoBase: Number(document.getElementById('fValorAtraso').value) || 0,
    observacao: document.getElementById('fObservacao').value.trim(),
  };
  camposDivida.total = calcTotal(camposDivida);

  if (dividaId) {
    const achado = encontrarDivida(dividaId);
    if (!achado) return;
    const { contrato: c, divida: d } = achado;
    const antes = Object.assign({}, d);
    d.vencimento = document.getElementById('fVencimento').value;
    Object.assign(d, camposDivida);
    const alteracoes = diffCampos(antes, d, LABELS_DIVIDA);
    registrarAuditoria('divida_editada', `Dívida editada: ${c.imovel} - ${c.inquilino} (${formatDate(d.vencimento)})`, alteracoes);
    showToast('Dívida atualizada com sucesso.', 'success');
  } else {
    const imovel = document.getElementById('fImovel').value.trim();
    const inquilino = document.getElementById('fInquilino').value.trim();
    const quemRecebeu = document.getElementById('fQuemRecebeu').value.trim();
    const dataInicio = document.getElementById('fDataInicio').value;
    const diaPagamento = Number(document.getElementById('fDiaPagamento').value) || 0;
    if (!dataInicio || diaPagamento < 1 || diaPagamento > 31) {
      showToast('Informe a data de início e um dia de pagamento válido (1 a 31).', 'error');
      return;
    }

    const corretorNome = document.getElementById('fCorretorNome').value;
    const corretorPercentual = Number(document.getElementById('fCorretorPercentual').value) || 0;
    const caucao = Number(document.getElementById('fCaucao').value) || 0;

    const primeiroVenc = primeiroVencimento(dataInicio, diaPagamento);
    const vencimentos = gerarVencimentosAtePresente(primeiroVenc);

    if (vencimentos.length > 1) {
      const ok = confirm(
        `A data de início já passou. Isso vai gerar ${vencimentos.length} dívidas neste contrato, ` +
        `uma para cada mês, de ${formatDate(vencimentos[0])} até ${formatDate(vencimentos[vencimentos.length - 1])}. ` +
        `Deseja continuar?`
      );
      if (!ok) return;
    }

    const dividas = vencimentos.map((venc, idx) => {
      const ultimo = idx === vencimentos.length - 1;
      return {
        id: uuid(),
        vencimento: venc,
        aluguel: camposDivida.aluguel,
        desconto: camposDivida.desconto,
        juros: camposDivida.juros,
        multa: camposDivida.multa,
        condominio: camposDivida.condominio,
        condominioDireto: camposDivida.condominioDireto,
        total: camposDivida.total,
        // o "valor em atraso já existente" é uma dívida extra pontual — só entra
        // na dívida mais recente gerada, não é repetido em cada mês
        valorAtrasoBase: ultimo ? camposDivida.valorAtrasoBase : 0,
        observacao: camposDivida.observacao,
        pago: false,
        dataPagamento: null,
        pagamentos: [],
        criadoEm: Date.now() + idx,
      };
    });

    state.contratos.push({
      id: uuid(),
      numero: proximoNumeroContrato(),
      imovel,
      carteiraId: document.getElementById('fCarteira').value || '',
      inquilino,
      quemRecebeu,
      dataInicio,
      diaPagamento,
      aluguel: camposDivida.aluguel,
      desconto: camposDivida.desconto,
      juros: camposDivida.juros,
      multa: camposDivida.multa,
      condominio: camposDivida.condominio,
      condominioDireto: camposDivida.condominioDireto,
      anexoContrato: null,
      corretorNome,
      corretorPercentual,
      caucao,
      dataUltimoReajuste: dataInicio,
      caucaoDevolvida: false,
      dataCaucaoDevolvida: null,
      valorCaucaoDevolvida: null,
      encerrado: false,
      dataEncerramento: null,
      criadoEm: Date.now(),
      dividas,
    });

    const sufixoCorretor = corretorNome ? ` (corretor: ${corretorNome}, ${corretorPercentual}%)` : '';
    if (vencimentos.length > 1) {
      registrarAuditoria('contrato_criado', `Contrato criado com ${vencimentos.length} dívidas (retroativo): ${imovel} - ${inquilino}, de ${formatDate(vencimentos[0])} até ${formatDate(vencimentos[vencimentos.length - 1])}${sufixoCorretor}`);
      showToast(`Contrato criado com ${vencimentos.length} dívidas.`, 'success');
    } else {
      registrarAuditoria('contrato_criado', `Contrato criado: ${imovel} - ${inquilino}${sufixoCorretor}`);
      showToast('Contrato criado com sucesso.', 'success');
    }
  }
  saveState();
  closeModal('modalContrato');
  renderAll();
});

function excluirContrato(contratoId) {
  const c = state.contratos.find(x => x.id === contratoId);
  if (!c) return;
  if (!confirm(`Tem certeza que deseja excluir o contrato de ${c.imovel} - ${c.inquilino}? Isso apaga TODAS as ${c.dividas.length} dívida(s) dele. Esta ação não pode ser desfeita.`)) return;
  state.contratos = state.contratos.filter(x => x.id !== contratoId);
  registrarAuditoria('contrato_excluido', `Contrato excluído: ${c.imovel} - ${c.inquilino} (${c.dividas.length} dívida(s))`);
  saveState();
  renderAll();
  showToast('Contrato excluído.', 'success');
}

// Encerrar é diferente de excluir: não apaga nenhum dado (as dívidas e o
// histórico de pagamentos continuam existindo e visíveis), só faz o sistema
// parar de gerar novas dívidas mensais para este contrato — usado quando o
// inquilino deixa o imóvel. Pode ser revertido a qualquer momento.
function encerrarContrato(contratoId) {
  const c = state.contratos.find(x => x.id === contratoId);
  if (!c) return;
  if (!confirm(`Encerrar o contrato de ${c.imovel} - ${c.inquilino}? O histórico continua disponível normalmente — o sistema só para de gerar novas dívidas mensais automaticamente. Você pode reabrir depois, se precisar.`)) return;
  c.encerrado = true;
  c.dataEncerramento = todayStr();
  registrarAuditoria('contrato_encerrado', `Contrato encerrado: ${c.imovel} - ${c.inquilino}`);
  saveState();
  renderAll();
  showToast('Contrato encerrado.', 'success');
}

function reabrirContrato(contratoId) {
  const c = state.contratos.find(x => x.id === contratoId);
  if (!c) return;
  c.encerrado = false;
  c.dataEncerramento = null;
  registrarAuditoria('contrato_reaberto', `Contrato reaberto: ${c.imovel} - ${c.inquilino}`);
  saveState();
  renderAll();
  showToast('Contrato reaberto.', 'success');
}

function excluirDivida(dividaId) {
  const achado = encontrarDivida(dividaId);
  if (!achado) return;
  const { contrato: c, divida: d } = achado;
  if (!confirm(`Excluir a dívida de ${formatDate(d.vencimento)} de ${c.imovel} - ${c.inquilino}? Esta ação não pode ser desfeita.`)) return;
  c.dividas = c.dividas.filter(x => x.id !== dividaId);
  registrarAuditoria('divida_excluida', `Dívida excluída: ${c.imovel} - ${c.inquilino} (${formatDate(d.vencimento)})`);
  saveState();
  renderAll();
  showToast('Dívida excluída.', 'success');
}

// Gera as dívidas que faltam entre a última já existente e o mês atual —
// para o contrato "crescer" mês a mês conforme o tempo passa.
// Gera (e empilha em c.dividas) as dívidas que faltam entre a última já
// existente e o mês atual. Função pura em relação a I/O — não salva, não
// mostra toast — para poder ser reaproveitada tanto pelo botão de um
// contrato só quanto pela atualização em lote de todos os contratos.
// Retorna quantas dívidas novas foram geradas.
function gerarDividasFaltantes(c) {
  if (c.encerrado) return 0;
  let vencimentos;
  if (!c.dividas.length) {
    vencimentos = gerarVencimentosAtePresente(primeiroVencimento(c.dataInicio, c.diaPagamento));
  } else {
    const ultima = c.dividas.slice().sort((a, b) => a.vencimento < b.vencimento ? -1 : 1).pop();
    const proximoVenc = addMonthsClamped(ultima.vencimento, 1);
    vencimentos = proximoVenc > todayStr() ? [] : gerarVencimentosAtePresente(proximoVenc);
  }

  if (!vencimentos.length) return 0;

  vencimentos.forEach((venc, idx) => {
    c.dividas.push({
      id: uuid(),
      vencimento: venc,
      aluguel: c.aluguel,
      desconto: c.desconto,
      juros: c.juros,
      multa: c.multa,
      condominio: c.condominio,
      condominioDireto: !!c.condominioDireto,
      total: calcTotal(c),
      valorAtrasoBase: 0,
      observacao: '',
      pago: false,
      dataPagamento: null,
      pagamentos: [],
      criadoEm: Date.now() + idx,
    });
  });

  return vencimentos.length;
}

function atualizarDividas(contratoId) {
  const c = state.contratos.find(x => x.id === contratoId);
  if (!c) return;

  const geradas = gerarDividasFaltantes(c);
  if (!geradas) {
    showToast('Este contrato já está em dia — nenhuma dívida nova para gerar.', 'error');
    return;
  }

  registrarAuditoria('divida_editada', `${geradas} nova(s) dívida(s) gerada(s): ${c.imovel} - ${c.inquilino}`);
  saveState();
  renderAll();
  showToast(`${geradas} dívida(s) gerada(s) com sucesso.`, 'success');
}

// Roda a mesma geração para TODOS os contratos de uma vez (botão global no
// topo, e também automaticamente ao abrir o sistema). Em modo silencioso
// (usado na checagem automática), só mostra aviso se algo foi de fato gerado.
function atualizarTodasDividas(silencioso) {
  let totalGeradas = 0;
  let contratosAfetados = 0;
  state.contratos.forEach(c => {
    const geradas = gerarDividasFaltantes(c);
    if (geradas > 0) {
      totalGeradas += geradas;
      contratosAfetados++;
    }
  });

  if (totalGeradas === 0) {
    if (!silencioso) showToast('Todos os contratos já estão em dia.', 'success');
    return;
  }

  registrarAuditoria('divida_editada', `Atualização em lote: ${totalGeradas} dívida(s) geradas em ${contratosAfetados} contrato(s)`);
  saveState();
  renderAll();
  showToast(`${totalGeradas} dívida(s) geradas em ${contratosAfetados} contrato(s).`, 'success');
}

/* ===================== EDITAR CONTRATO (dados compartilhados + anexo) ===================== */
const formContratoInfo = document.getElementById('formContratoInfo');

function openContratoInfo(contratoId) {
  const c = state.contratos.find(x => x.id === contratoId);
  if (!c) return;
  document.getElementById('infoContratoId').value = c.id;
  populateImovelSelect(document.getElementById('infoImovel'), c.imovel);
  populateCarteiraSelect(document.getElementById('infoCarteira'), c.carteiraId || '');
  atualizarVisibilidadeCamposCarteira();
  document.getElementById('infoInquilino').value = c.inquilino;
  document.getElementById('infoCaucao').value = c.caucao || '';
  populatePessoaSelect(document.getElementById('infoQuemRecebeu'), c.quemRecebeu || '', 'Nenhum / outro');
  document.getElementById('infoContratoSubtitle').textContent = (c.dataInicio
    ? `Contrato #${c.numero} — Início: ${formatDate(c.dataInicio)}, todo dia ${c.diaPagamento}`
    : `Contrato #${c.numero}`) + (c.encerrado ? ` — Encerrado em ${formatDate(c.dataEncerramento)}` : '');

  populatePessoaSelect(document.getElementById('infoCorretorNome'), c.corretorNome || '', 'Nenhum (sem corretor)');
  document.getElementById('infoCampoCorretorPercentual').classList.toggle('hidden', !c.corretorNome);
  document.getElementById('infoCampoCorretorValor').classList.toggle('hidden', !c.corretorNome);
  document.getElementById('infoCorretorPercentual').value = c.corretorNome ? c.corretorPercentual : 0;
  atualizarValorCorretorInfo();

  renderAnexoAtual(c);
  openModal('modalContratoInfo');
}

function atualizarValorCorretorInfo() {
  const id = document.getElementById('infoContratoId').value;
  const c = state.contratos.find(x => x.id === id);
  const percentual = Number(document.getElementById('infoCorretorPercentual').value) || 0;
  const aluguel = c ? c.aluguel : 0;
  document.getElementById('infoCorretorValor').textContent = formatCurrency(aluguel * percentual / 100);
}

document.getElementById('infoCorretorPercentual').addEventListener('input', atualizarValorCorretorInfo);

const LABELS_CONTRATO_INFO = {
  imovel: 'Imóvel', inquilino: 'Inquilino', quemRecebeu: 'Quem recebe',
  corretorNome: 'Corretor', corretorPercentual: 'Percentual do corretor (%)',
  caucao: 'Caução (R$)',
};

formContratoInfo.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('infoContratoId').value;
  const c = state.contratos.find(x => x.id === id);
  if (!c) return;
  const antes = Object.assign({}, c);

  c.imovel = document.getElementById('infoImovel').value.trim();
  c.inquilino = document.getElementById('infoInquilino').value.trim();
  c.quemRecebeu = document.getElementById('infoQuemRecebeu').value.trim();
  c.corretorNome = document.getElementById('infoCorretorNome').value;
  c.corretorPercentual = Number(document.getElementById('infoCorretorPercentual').value) || 0;
  c.caucao = Number(document.getElementById('infoCaucao').value) || 0;

  const carteiraAntiga = antes.carteiraId || '';
  c.carteiraId = document.getElementById('infoCarteira').value || '';

  const alteracoes = diffCampos(antes, c, LABELS_CONTRATO_INFO);
  // a carteira é guardada por id — no diff da Auditoria entra pelo nome
  if (carteiraAntiga !== c.carteiraId) {
    alteracoes.push({
      campo: 'Carteira',
      de: carteiraNome(carteiraAntiga) || 'Nenhuma',
      para: carteiraNome(c.carteiraId) || 'Nenhuma',
    });
  }
  registrarAuditoria('contrato_editado', `Contrato editado: ${c.imovel} - ${c.inquilino}`, alteracoes);
  saveState();
  closeModal('modalContratoInfo');
  renderAll();
  showToast('Contrato atualizado com sucesso.', 'success');
});

/* ===================== ANEXO DO CONTRATO ===================== */
function renderAnexoAtual(c) {
  const bloco = document.getElementById('fAnexoAtual');
  const input = document.getElementById('fAnexoInput');
  const status = document.getElementById('fAnexoStatus');
  input.value = '';
  status.textContent = 'PDF, JPG ou PNG, até 15MB. Enviado automaticamente ao escolher o arquivo.';
  if (c.anexoContrato) {
    document.getElementById('fAnexoNome').textContent = c.anexoContrato;
    document.getElementById('fAnexoLink').href = 'api/anexo.php?file=' + encodeURIComponent(c.anexoContrato);
    bloco.classList.remove('hidden');
  } else {
    bloco.classList.add('hidden');
  }
}

document.getElementById('fAnexoInput').addEventListener('change', async () => {
  const id = document.getElementById('infoContratoId').value;
  const c = state.contratos.find(x => x.id === id);
  const input = document.getElementById('fAnexoInput');
  const status = document.getElementById('fAnexoStatus');
  const file = input.files[0];
  if (!c || !file) return;

  status.textContent = 'Enviando...';
  try {
    const formData = new FormData();
    formData.append('arquivo', file);
    formData.append('contratoId', c.id);
    formData.append('inquilino', c.inquilino);
    formData.append('imovel', c.imovel);
    const res = await fetch(API_BASE + 'anexo.php', { method: 'POST', credentials: 'same-origin', body: formData });
    const data = await res.json();
    if (res.ok && data.ok) {
      c.anexoContrato = data.filename;
      registrarAuditoria('contrato_editado', `Contrato anexado: ${c.imovel} - ${c.inquilino}`);
      await saveState();
      renderAnexoAtual(c);
      renderAll();
      showToast('Contrato anexado com sucesso.', 'success');
    } else {
      status.textContent = data.error || 'Não foi possível enviar o arquivo.';
      showToast(data.error || 'Não foi possível enviar o arquivo.', 'error');
    }
  } catch (err) {
    status.textContent = 'Não foi possível conectar ao servidor.';
    showToast('Não foi possível conectar ao servidor.', 'error');
  }
});

document.getElementById('btnRemoverAnexo').addEventListener('click', async () => {
  const id = document.getElementById('infoContratoId').value;
  const c = state.contratos.find(x => x.id === id);
  if (!c || !c.anexoContrato) return;
  if (!confirm('Remover o arquivo anexado a este contrato?')) return;

  try {
    await apiFetch('anexo.php', { method: 'POST', body: JSON.stringify({ action: 'remove', file: c.anexoContrato }) });
    registrarAuditoria('contrato_editado', `Anexo removido: ${c.imovel} - ${c.inquilino}`);
    c.anexoContrato = null;
    await saveState();
    renderAnexoAtual(c);
    renderAll();
    showToast('Anexo removido.', 'success');
  } catch (err) {
    showToast('Não foi possível remover o anexo.', 'error');
  }
});

/* ===================== REAJUSTE DE VALOR ===================== */
const formReajuste = document.getElementById('formReajuste');

function openReajuste(contratoId) {
  const c = state.contratos.find(x => x.id === contratoId);
  if (!c) return;
  document.getElementById('reajusteContratoId').value = c.id;
  document.getElementById('reajusteContratoInfo').textContent = `${c.imovel} — ${c.inquilino}`;
  document.getElementById('reajusteValorAtual').textContent = formatCurrency(c.aluguel);
  const sugerido = precisaReajuste(c);
  document.getElementById('reajusteSugestaoHint').classList.toggle('hidden', !sugerido);
  if (sugerido) {
    const valorSugerido = valorReajusteSugerido(c);
    document.getElementById('reajusteSugestaoHint').textContent =
      `Este contrato está no aniversário de reajuste. Sugestão (${state.config.percentualReajusteSugerido || 0}%): ${formatCurrency(valorSugerido)}.`;
    document.getElementById('reajusteNovoValor').value = valorSugerido.toFixed(2);
  } else {
    document.getElementById('reajusteNovoValor').value = '';
  }
  openModal('modalReajuste');
}

formReajuste.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('reajusteContratoId').value;
  const c = state.contratos.find(x => x.id === id);
  if (!c) return;
  const valorAntigo = c.aluguel;
  const novoValor = Number(document.getElementById('reajusteNovoValor').value) || 0;
  if (novoValor <= 0) return;

  c.aluguel = novoValor;
  c.dataUltimoReajuste = todayStr();
  let dividasAtualizadas = 0;
  c.dividas.forEach(d => {
    if (!d.pago) {
      d.aluguel = novoValor;
      d.total = calcTotal(d);
      dividasAtualizadas++;
    }
  });

  const alteracoes = [{ campo: 'Aluguel (R$)', de: valorAntigo, para: novoValor }];
  registrarAuditoria('contrato_reajustado', `Aluguel reajustado: ${c.imovel} - ${c.inquilino} de ${formatCurrency(valorAntigo)} para ${formatCurrency(novoValor)} (${dividasAtualizadas} dívida(s) em aberto atualizada(s))`, alteracoes);
  saveState();
  closeModal('modalReajuste');
  renderAll();
  showToast('Reajuste aplicado com sucesso.', 'success');
});

/* ===================== DEVOLUÇÃO DE CAUÇÃO ===================== */
const formDevolucaoCaucao = document.getElementById('formDevolucaoCaucao');

// Reabrir o modal depois de já ter devolvido só permite corrigir data/valor
// registrados — não existe estado "parcialmente devolvido".
function abrirDevolucaoCaucao(contratoId) {
  const c = state.contratos.find(x => x.id === contratoId);
  if (!c) return;
  document.getElementById('devCaucaoContratoId').value = c.id;
  document.getElementById('devCaucaoInfo').textContent = `${c.imovel} — ${c.inquilino} — Caução: ${formatCurrency(c.caucao)}`;
  document.getElementById('devCaucaoData').value = c.dataCaucaoDevolvida || todayStr();
  document.getElementById('devCaucaoValor').value = c.valorCaucaoDevolvida != null ? c.valorCaucaoDevolvida : c.caucao;
  document.getElementById('devCaucaoObservacao').value = '';
  openModal('modalDevolucaoCaucao');
}

formDevolucaoCaucao.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('devCaucaoContratoId').value;
  const c = state.contratos.find(x => x.id === id);
  if (!c) return;

  c.caucaoDevolvida = true;
  c.dataCaucaoDevolvida = document.getElementById('devCaucaoData').value;
  c.valorCaucaoDevolvida = Number(document.getElementById('devCaucaoValor').value) || 0;
  const observacao = document.getElementById('devCaucaoObservacao').value.trim();

  registrarAuditoria('caucao_devolvida', `Caução devolvida: ${c.imovel} - ${c.inquilino} (${formatCurrency(c.valorCaucaoDevolvida)} em ${formatDate(c.dataCaucaoDevolvida)})${observacao ? ' — ' + observacao : ''}`);
  saveState();
  closeModal('modalDevolucaoCaucao');
  renderAll();
  showToast('Devolução de caução registrada.', 'success');
});

/* ===================== PAGAMENTO ===================== */
const formPagamento = document.getElementById('formPagamento');

// Valor sugerido = total a cobrar da parcela, MENOS o condomínio quando ele não
// veio junto (que é o padrão). Duas coisas de propósito ficam de fora:
//   - o acréscimo por atraso, que fica num aviso à parte com um botão "Somar";
//   - o condomínio, marcado no próprio modal quando o inquilino entrega junto.
// Cobrar ou não cada um deles é decisão de quem recebe. Quitar a parcela não
// depende do valor: receber menos continua dando quitação da parcela inteira.
function valorSugeridoPagamento(d, condominioRecebido) {
  const total = Number(d.total) || 0;
  const cond = condominioCobrado(d);
  return condominioRecebido ? total : total - cond;
}

// Lê no formulário se o condomínio foi marcado como recebido junto.
function condominioRecebidoNoForm() {
  return document.getElementById('pagCondominioRecebido').value === '1';
}

// Recalcula o valor sugerido a partir do que está marcado agora no modal.
function atualizarValorSugerido() {
  const achado = encontrarDivida(document.getElementById('pagDividaId').value);
  if (!achado) return;
  const { contrato: c, divida: d } = achado;
  const desconto = Number(document.getElementById('pagDesconto').value) || 0;
  const recebido = condominioRecebidoNoForm();
  document.getElementById('pagValor').value =
    Math.max(valorSugeridoPagamento(d, recebido) - desconto, 0).toFixed(2);
  document.getElementById('pagLiquidoPrevia').textContent = formatCurrency(
    valorLiquidoPagamento(c, d, {
      valor: Number(document.getElementById('pagValor').value) || 0,
      condominioRecebido: recebido,
    })
  );
}

function openPagamento(dividaId) {
  const achado = encontrarDivida(dividaId);
  if (!achado) return;
  const { contrato: c, divida: d } = achado;
  document.getElementById('pagDividaId').value = d.id;
  document.getElementById('pagContratoInfo').textContent = `#${c.numero} — ${c.imovel} — ${c.inquilino} — Vencimento: ${formatDate(d.vencimento)}`;
  document.getElementById('pagExtrato').innerHTML = extratoDividaHtml(c, d);
  document.getElementById('pagData').value = todayStr();
  document.getElementById('pagDesconto').value = '';
  document.getElementById('pagMotivoDesconto').value = '';
  document.getElementById('pagCampoMotivoDesconto').classList.add('hidden');
  document.getElementById('pagForma').value = '';
  populatePessoaSelect(document.getElementById('pagQuemRecebeu'), c.quemRecebeu || '', 'Selecione...');
  // "Quem recebeu" é obrigatório: sem ninguém cadastrado (e sem recebedor padrão
  // no contrato) o pagamento ficaria travado sem explicação nenhuma.
  document.getElementById('pagSemPessoasHint').classList
    .toggle('hidden', state.pessoas.length > 0 || !!c.quemRecebeu);
  document.getElementById('pagObservacao').value = '';

  // O condomínio só é perguntado quando existe e é cobrado junto com o aluguel;
  // com o inquilino pagando direto, não há o que receber. Padrão: NÃO recebido.
  const perguntaCondominio = condominioCobrado(d) > 0;
  document.getElementById('pagCampoCondominio').classList.toggle('hidden', !perguntaCondominio);
  document.getElementById('pagCondominioRecebido').value = '0';
  document.getElementById('pagCondominioValor').textContent = formatCurrency(condominioCobrado(d));
  atualizarValorSugerido();

  const atraso = calcAtrasoAtual(d);
  const aviso = document.getElementById('pagAtrasoAviso');
  aviso.classList.toggle('hidden', atraso <= 0);
  if (atraso > 0) {
    const dias = diasAtraso(d);
    document.getElementById('pagAtrasoTexto').textContent =
      ` Vencida há ${dias} dia${dias === 1 ? '' : 's'} — juros/multa por atraso somam ${formatCurrency(atraso)} até hoje. ` +
      `Não estão incluídos no valor sugerido; some só se for cobrar.`;
  }

  openModal('modalPagamento');
}

document.getElementById('btnSomarAtraso').addEventListener('click', () => {
  const achado = encontrarDivida(document.getElementById('pagDividaId').value);
  if (!achado) return;
  const { divida: d } = achado;
  const desconto = Number(document.getElementById('pagDesconto').value) || 0;
  const comAtraso = valorSugeridoPagamento(d, condominioRecebidoNoForm()) + calcAtrasoAtual(d) - desconto;
  document.getElementById('pagValor').value = Math.max(comAtraso, 0).toFixed(2);
  showToast('Juros/multa por atraso somados ao valor.', 'success');
});

document.getElementById('pagCondominioRecebido').addEventListener('change', atualizarValorSugerido);

document.getElementById('pagDesconto').addEventListener('input', () => {
  const desconto = Number(document.getElementById('pagDesconto').value) || 0;
  atualizarValorSugerido();
  document.getElementById('pagCampoMotivoDesconto').classList.toggle('hidden', desconto <= 0);
});

// O valor pode ser editado à mão depois — a prévia do líquido acompanha.
document.getElementById('pagValor').addEventListener('input', () => {
  const achado = encontrarDivida(document.getElementById('pagDividaId').value);
  if (!achado) return;
  const { contrato: c, divida: d } = achado;
  document.getElementById('pagLiquidoPrevia').textContent = formatCurrency(
    valorLiquidoPagamento(c, d, {
      valor: Number(document.getElementById('pagValor').value) || 0,
      condominioRecebido: condominioRecebidoNoForm(),
    })
  );
});

formPagamento.addEventListener('submit', (e) => {
  e.preventDefault();
  const dividaId = document.getElementById('pagDividaId').value;
  const achado = encontrarDivida(dividaId);
  if (!achado) return;
  const { contrato: c, divida: d } = achado;
  const pagamento = {
    data: document.getElementById('pagData').value,
    desconto: Number(document.getElementById('pagDesconto').value) || 0,
    motivoDesconto: document.getElementById('pagMotivoDesconto').value.trim(),
    valor: Number(document.getElementById('pagValor').value) || 0,
    forma: document.getElementById('pagForma').value,
    quemRecebeu: document.getElementById('pagQuemRecebeu').value.trim(),
    condominioRecebido: condominioCobrado(d) > 0 ? condominioRecebidoNoForm() : false,
    observacao: document.getElementById('pagObservacao').value.trim(),
  };
  d.pagamentos.push(pagamento);
  d.pago = true;
  d.dataPagamento = pagamento.data;
  d.valorAtrasoBase = 0;
  registrarAuditoria('pagamento_registrado', `Pagamento registrado: ${c.imovel} - ${c.inquilino} (${formatDate(d.vencimento)}) - ${formatCurrency(pagamento.valor)}`);
  saveState();
  closeModal('modalPagamento');
  renderAll();
  showToast('Pagamento registrado com sucesso.', 'success');
});

/* ===================== HISTÓRICO POR CONTRATO ===================== */
let historicoContratoAtualId = null;

function openHistoricoContrato(contratoId) {
  const c = state.contratos.find(x => x.id === contratoId);
  if (!c) return;
  historicoContratoAtualId = contratoId;
  document.getElementById('histContratoInfo').textContent = `#${c.numero} — ${c.imovel} — ${c.inquilino}`;
  const list = document.getElementById('histContratoList');
  const dividasOrdenadas = c.dividas.slice().sort((a, b) => a.vencimento < b.vencimento ? 1 : -1);

  if (!dividasOrdenadas.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma dívida gerada ainda para este contrato.</div>';
  } else {
    list.innerHTML = dividasOrdenadas.map(d => {
      const status = getStatus(d);
      const pagamentosHtml = d.pagamentos.map((p, indice) => {
        const valorLiquido = valorLiquidoPagamento(c, d, p);
        return `
          <div class="contrato-sub">
            ${icon('dollar')} Pago em ${formatDate(p.data)} · ${formatCurrency(p.valor)}
            ${Math.abs(valorLiquido - p.valor) > 0.001 ? ` (líquido: ${formatCurrency(valorLiquido)})` : ''}
            ${p.desconto ? ` · Desconto: ${formatCurrency(p.desconto)}${p.motivoDesconto ? ` (${escapeHtml(p.motivoDesconto)})` : ''}` : ''}
            ${condominioNoPagamento(d, p) > 0 ? ` · Condomínio junto: ${formatCurrency(condominioNoPagamento(d, p))}` : ''}
            ${p.forma ? ` · ${escapeHtml(p.forma)}` : ''}
            ${p.quemRecebeu ? ` · Recebido por ${escapeHtml(p.quemRecebeu)}` : ''}
            ${p.observacao ? ` · ${escapeHtml(p.observacao)}` : ''}
            <button type="button" class="btn btn-ghost btn-sm" data-recibo-divida="${d.id}" data-recibo-indice="${indice}">${icon('receipt')} Recibo</button>
          </div>
        `;
      }).join('');

      return `
        <div class="card">
          <div class="contrato-grid">
            <div><span>Vencimento</span><strong>${formatDate(d.vencimento)}</strong></div>
            <div><span>Valor total</span><strong>${formatCurrency(d.total)}</strong></div>
            <div><span>Status</span><strong><span class="status-badge status-${status}">${statusLabel(status)}</span></strong></div>
            ${d.observacao ? `<div><span>Observação</span><strong>${escapeHtml(d.observacao)}</strong></div>` : ''}
          </div>
          ${pagamentosHtml || '<div class="contrato-sub">Ainda sem pagamento registrado para esta dívida.</div>'}
        </div>
      `;
    }).join('');
    bindReciboButtons(list);
  }
  openModal('modalHistoricoContrato');
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ===================== FILTERS ===================== */
// Um contrato "passa" no filtro se pelo menos uma das suas dívidas bater com
// os critérios (ano/mês/status); a busca por texto olha o imóvel/inquilino.
function contratoPassaFiltro(c, { search, ano, mes, status }) {
  if (search) {
    const haystack = (c.inquilino + ' ' + c.imovel + ' #' + (c.numero || '') + ' ' + carteiraNome(c.carteiraId)).toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  if (!ano && mes === '' && !status) return true;
  return c.dividas.some(d => {
    const venc = parseDate(d.vencimento);
    if (ano && venc.getFullYear() !== Number(ano)) return false;
    if (mes !== '' && venc.getMonth() !== Number(mes)) return false;
    if (status && getStatus(d) !== status) return false;
    return true;
  });
}

function lerFiltrosContratos() {
  return {
    search: document.getElementById('searchContratos').value.trim().toLowerCase(),
    ano: document.getElementById('filterAno').value,
    mes: document.getElementById('filterMes').value,
    status: document.getElementById('filterStatus').value,
  };
}

function proximaDividaRelevante(c) {
  const abertas = c.dividas.filter(d => !d.pago).sort((a, b) => a.vencimento < b.vencimento ? -1 : 1);
  if (abertas.length) return abertas[0];
  const todas = c.dividas.slice().sort((a, b) => a.vencimento < b.vencimento ? 1 : -1);
  return todas[0] || null;
}

function populateAnoFilter() {
  const select = document.getElementById('filterAno');
  const anos = new Set(todasDividas().map(d => parseDate(d.vencimento).getFullYear()));
  anos.add(new Date().getFullYear());
  const sorted = Array.from(anos).sort((a, b) => b - a);
  const current = select.value;
  select.innerHTML = '<option value="">Todos os anos</option>' + sorted.map(a => `<option value="${a}">${a}</option>`).join('');
  select.value = current || '';
}

function getFilteredContratos() {
  const filtros = lerFiltrosContratos();
  return contratosVisiveis().filter(c => contratoPassaFiltro(c, filtros)).sort((a, b) => {
    const da = proximaDividaRelevante(a);
    const db = proximaDividaRelevante(b);
    if (!da) return 1;
    if (!db) return -1;
    return da.vencimento < db.vencimento ? -1 : da.vencimento > db.vencimento ? 1 : 0;
  });
}

// Versão "achatada" (uma linha por dívida) do mesmo filtro — usada nas
// exportações (CSV/PDF), que precisam listar cada mês separadamente.
function getFilteredDividasFlat() {
  const filtros = lerFiltrosContratos();
  return todasDividas().filter(d => {
    if (filtros.search) {
      const haystack = (d.inquilino + ' ' + d.imovel).toLowerCase();
      if (!haystack.includes(filtros.search)) return false;
    }
    const venc = parseDate(d.vencimento);
    if (filtros.ano && venc.getFullYear() !== Number(filtros.ano)) return false;
    if (filtros.mes !== '' && venc.getMonth() !== Number(filtros.mes)) return false;
    if (filtros.status && getStatus(d) !== filtros.status) return false;
    return true;
  }).sort((a, b) => parseDate(a.vencimento) - parseDate(b.vencimento));
}

['searchContratos', 'filterAno', 'filterMes', 'filterStatus'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    contratosPaginaAtual = 1;
    renderContratos();
  });
});

/* ===================== COMISSÃO DE CORRETOR =====================
 * A comissão é sempre um percentual do ALUGUEL da dívida — e só dele. Nada
 * mais entra nessa base: nem condomínio, nem juros, nem multa, nem o valor em
 * atraso. É a função `comissaoCorretor()` (lá em cima) que garante isso, e
 * todo lugar que mostra comissão passa por ela.
 */

// Comissões de um período, agrupadas por corretor — a lista do que precisa ser
// pago a cada um. `filtro(divida)` decide quais dívidas entram.
function comissoesPorCorretor(filtro) {
  const porNome = new Map();
  contratosVisiveis().forEach(c => {
    if (!c.corretorNome) return;
    (c.dividas || []).forEach(d => {
      if (filtro && !filtro(d)) return;
      const valor = comissaoCorretor(c, d);
      if (valor <= 0) return;
      const atual = porNome.get(c.corretorNome) || { nome: c.corretorNome, total: 0, dividas: 0, contratos: new Set() };
      atual.total += valor;
      atual.dividas += 1;
      atual.contratos.add(c.id);
      porNome.set(c.corretorNome, atual);
    });
  });
  return Array.from(porNome.values())
    .map(x => ({ nome: x.nome, total: x.total, dividas: x.dividas, contratos: x.contratos.size }))
    .sort((a, b) => b.total - a.total);
}

// Card do Dashboard: quanto sai para corretor nas dívidas que vencem no mês
// corrente. Fica escondido para quem não usa corretor em contrato nenhum.
function renderComissaoMes(hoje) {
  const lista = comissoesPorCorretor(d => {
    const venc = parseDate(d.vencimento);
    return venc.getFullYear() === hoje.getFullYear() && venc.getMonth() === hoje.getMonth();
  });
  const temCorretor = contratosVisiveis().some(c => c.corretorNome);
  const total = lista.reduce((s, x) => s + x.total, 0);

  document.getElementById('statCardCorretor').classList.toggle('hidden', !temCorretor);
  document.getElementById('statCorretorMes').textContent = formatCurrency(total);
  document.getElementById('statCorretorHint').textContent = lista.length
    ? lista.map(x => `${x.nome}: ${formatCurrency(x.total)}`).join(' · ')
    : 'Nenhuma comissão neste mês';
}

/* ===================== RENDER: EXTRATO DE UMA DÍVIDA =====================
 * A composição do valor, lida de cima para baixo como um extrato: começa no
 * aluguel, aplica os acréscimos e o desconto, fecha no "Total a cobrar", e só
 * então tira as deduções (corretor e condomínio) para chegar no "Total
 * líquido". Cada linha traz o sinal (+ / −) para não haver dúvida sobre o que
 * soma e o que subtrai.
 *
 * Sem corretor e sem condomínio não existe dedução nenhuma: aí aparece um
 * "Total" só, sem os dois rótulos, para não complicar quem não usa isso.
 */
function extratoDivida(c, d) {
  const total = Number(d.total) || 0;
  const comissao = comissaoCorretor(c, d);
  const condominio = condominioCobrado(d);
  const condominioDireto = d.condominioDireto ? (Number(d.condominio) || 0) : 0;
  const temDeducoes = comissao > 0 || condominio > 0;

  const linhas = [{ sinal: '', label: 'Aluguel', curto: 'Aluguel', valor: Number(d.aluguel) || 0 }];
  if (condominio) linhas.push({ sinal: '+', label: 'Condomínio', curto: 'Cond.', valor: condominio });
  if (d.juros) linhas.push({ sinal: '+', label: 'Juros', curto: 'Juros', valor: Number(d.juros) });
  if (d.multa) linhas.push({ sinal: '+', label: 'Multa', curto: 'Multa', valor: Number(d.multa) });
  if (d.desconto) linhas.push({ sinal: '−', label: 'Desconto', curto: 'Desc.', valor: Number(d.desconto) });
  linhas.push({
    sinal: '=', valor: total, destaque: true,
    label: temDeducoes ? 'Total a cobrar' : 'Total',
    curto: temDeducoes ? 'A cobrar' : 'Total',
  });

  if (temDeducoes) {
    if (comissao) linhas.push({ sinal: '−', label: `Corretor (${c.corretorPercentual}%)`, curto: `Corretor ${c.corretorPercentual}%`, valor: comissao, deducao: true });
    if (condominio) linhas.push({ sinal: '−', label: 'Condomínio (repasse)', curto: 'Cond. repasse', valor: condominio, deducao: true });
    linhas.push({ sinal: '=', label: 'Total líquido', curto: 'Líquido', valor: total - comissao - condominio, destaque: true, liquido: true });
  }

  // Condomínio pago direto entra fora da conta, só para constar o valor
  if (condominioDireto) {
    linhas.push({ sinal: '', label: 'Condomínio pago direto pelo inquilino', curto: 'Cond. direto', valor: condominioDireto, fora: true });
  }
  return linhas;
}

// Versão em coluna, para quando há espaço e uma dívida só na tela (modal de
// pagamento): lê como um extrato de verdade, de cima para baixo.
function extratoDividaHtml(c, d) {
  return `
    <div class="extrato">
      ${extratoDivida(c, d).map(l => `
        <div class="extrato-linha${l.destaque ? ' is-total' : ''}${l.liquido ? ' is-liquido' : ''}${l.fora ? ' is-fora' : ''}">
          <span class="extrato-sinal">${l.sinal}</span>
          <span class="extrato-label">${escapeHtml(l.label)}</span>
          <span class="extrato-valor${l.deducao ? ' is-deducao' : ''}">${formatCurrency(l.valor)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

// Versão em linha, para as LISTAS (uma dívida por linha, dezenas na tela): a
// mesma ordem e os mesmos sinais, mas em uma linha só e com rótulos curtos —
// uma lista de 26 dívidas não pode virar 26 blocos de oito linhas.
function extratoDividaInlineHtml(c, d) {
  return extratoDivida(c, d).map(l => `
    <div class="valor-item${l.destaque ? ' is-total' : ''}${l.liquido ? ' is-liquido' : ''}${l.fora ? ' is-fora' : ''}">
      <span>${l.sinal ? `<i class="valor-sinal">${l.sinal}</i> ` : ''}${escapeHtml(l.curto)}</span>
      <strong${l.deducao ? ' class="is-deducao"' : ''}>${formatCurrency(l.valor)}</strong>
    </div>
  `).join('');
}

/* ===================== RENDER: TABELA DE DÍVIDAS DE UM CONTRATO =====================
 * Dentro de um contrato, as dívidas viram uma TABELA: os rótulos aparecem uma
 * vez só, no cabeçalho, e as colunas ficam alinhadas entre todos os meses — dá
 * para comparar a coluna "Aluguel" de doze dívidas correndo o olho para baixo.
 * Repetir "ALUGUEL / + JUROS / + MULTA" em cada linha ocupava três vezes mais
 * espaço e não alinhava nada.
 *
 * As colunas são decididas por contrato: só entra a coluna que tem valor em
 * alguma dívida dele. Um contrato sem condomínio nem corretor fica com quatro
 * colunas; o mais completo, com todas.
 */
function colunasDividas(c, dividas) {
  const alguma = (fn) => dividas.some(fn);
  const temDeducoes = !!c.corretorNome || alguma(d => condominioCobrado(d) > 0);
  const cols = [
    { key: 'vencimento', rotulo: 'Venc.', txt: true },
    { key: 'status', rotulo: 'Status', txt: true },
    { key: 'aluguel', rotulo: 'Aluguel' },
  ];
  if (alguma(d => condominioCobrado(d) > 0)) cols.push({ key: 'condominio', rotulo: '+ Cond.' });
  if (alguma(d => Number(d.juros) > 0)) cols.push({ key: 'juros', rotulo: '+ Juros' });
  if (alguma(d => Number(d.multa) > 0)) cols.push({ key: 'multa', rotulo: '+ Multa' });
  if (alguma(d => Number(d.desconto) > 0)) cols.push({ key: 'desconto', rotulo: '− Desc.' });
  cols.push({ key: 'total', rotulo: temDeducoes ? '= A cobrar' : '= Total', forte: true });
  if (c.corretorNome) cols.push({ key: 'corretor', rotulo: `− Corr. ${c.corretorPercentual}%`, dica: `Comissão de ${escapeHtml(c.corretorNome)} — ${c.corretorPercentual}% do aluguel` });
  // não existe coluna "− Cond. repasse": seria a mesma número da coluna
  // "+ Cond.", e o líquido já desconta os dois (explicado no title do cabeçalho)
  if (temDeducoes) cols.push({ key: 'liquido', rotulo: '= Líquido', forte: true, dica: 'Total a cobrar menos a comissão do corretor e o condomínio, que são repassados' });
  if (alguma(d => d.condominioDireto && Number(d.condominio) > 0)) {
    cols.push({ key: 'condDireto', rotulo: 'Cond. direto', dica: 'Condomínio pago direto pelo inquilino — fora da conta' });
  }
  if (alguma(d => getStatus(d) === 'atrasado')) {
    cols.push({ key: 'atraso', rotulo: 'Atraso', dica: 'Juros e multa acumulados até hoje' });
    cols.push({ key: 'dias', rotulo: 'Dias' });
  }
  if (alguma(d => d.dataPagamento)) cols.push({ key: 'pagoEm', rotulo: 'Pago em', txt: true });
  cols.push({ key: 'acoes', rotulo: '', txt: true, acoes: true });
  return cols;
}

// Injeta o rótulo da coluna na própria célula. Em tela estreita a tabela vira
// uma lista (sem cabeçalho e sem rolagem horizontal) e o CSS usa esse atributo
// para escrever o nome do campo antes do valor, via `content: attr(data-rotulo)`.
function comRotulo(celulaHtml, rotulo) {
  if (!rotulo) return celulaHtml;
  return celulaHtml.replace('<td', `<td data-rotulo="${escapeHtml(rotulo)}"`);
}

// Sem "R$" nas células: o cabeçalho da tabela já diz que a coluna é dinheiro, e
// repetir o símbolo oito vezes por linha era o que fazia a tabela não caber na
// tela. Zero fica apagado, para a vista cair no que tem valor.
function celulaMoeda(valor, classe) {
  const n = Number(valor) || 0;
  return `<td class="${n === 0 ? 'is-zero' : (classe || '')}">${formatNumero(n)}</td>`;
}

function celulaDivida(c, d, col) {
  const status = getStatus(d);
  switch (col.key) {
    case 'vencimento':
      return `<td class="col-txt col-cabecalho">
        <span class="divida-venc">${formatDate(d.vencimento)}</span>
        ${d.observacao ? `<span class="divida-obs" title="${escapeHtml(d.observacao)}">${icon('file-text')} ${escapeHtml(d.observacao)}</span>` : ''}
      </td>`;
    case 'status':
      return `<td class="col-txt col-cabecalho"><span class="status-badge status-${status}">${statusLabel(status)}</span></td>`;
    case 'aluguel':    return celulaMoeda(d.aluguel);
    case 'condominio': return celulaMoeda(condominioCobrado(d));
    case 'juros':      return celulaMoeda(d.juros);
    case 'multa':      return celulaMoeda(d.multa);
    case 'desconto':   return celulaMoeda(d.desconto, 'is-deducao');
    case 'total':      return celulaMoeda(d.total, 'is-forte');
    case 'corretor':   return celulaMoeda(comissaoCorretor(c, d), 'is-deducao');
    case 'liquido':    return celulaMoeda(totalLiquidoDivida(c, d), 'is-forte is-liquido');
    case 'condDireto': return celulaMoeda(d.condominioDireto ? d.condominio : 0, 'is-fora');
    case 'atraso':     return celulaMoeda(status === 'atrasado' ? calcAtrasoAtual(d) : 0, 'is-deducao');
    case 'dias':
      return status === 'atrasado'
        ? `<td class="is-deducao">${diasAtraso(d)}</td>`
        : '<td class="is-zero col-vazio">—</td>';
    case 'pagoEm':
      return d.dataPagamento
        ? `<td class="col-txt">${formatDate(d.dataPagamento)}</td>`
        : '<td class="col-txt is-zero col-vazio">—</td>';
    case 'acoes':
      return `<td class="col-acoes">
        <div class="divida-acoes">
          ${status !== 'pago' ? `<button class="btn-acao is-pagar" data-divida-action="pagar" data-divida-id="${d.id}" title="Registrar pagamento" aria-label="Registrar pagamento">${icon('dollar')}</button>` : ''}
          ${(d.pagamentos || []).length ? `<button class="btn-acao" data-divida-action="recibo" data-divida-id="${d.id}" title="${d.pagamentos.length > 1 ? `Recibo do pagamento mais recente (esta dívida tem ${d.pagamentos.length}; para os outros, use o Histórico)` : 'Gerar recibo deste pagamento'}" aria-label="Gerar recibo">${icon('receipt')}</button>` : ''}
          <button class="btn-acao" data-divida-action="editar" data-divida-id="${d.id}" title="Editar esta dívida" aria-label="Editar dívida">${icon('pencil')}</button>
          <button class="btn-acao is-excluir" data-divida-action="excluir" data-divida-id="${d.id}" title="Excluir esta dívida" aria-label="Excluir dívida">${icon('trash')}</button>
        </div>
      </td>`;
    default: return '<td></td>';
  }
}

function dividasTabelaHtml(c, dividas) {
  const cols = colunasDividas(c, dividas);
  return `
    <div class="dividas-scroll">
      <table class="dividas-tabela">
        <thead>
          <tr>${cols.map(col => `<th class="${col.txt ? 'col-txt' : ''}${col.forte ? ' is-forte' : ''}${col.acoes ? ' col-acoes' : ''}"${col.dica ? ` title="${escapeHtml(col.dica)}"` : ''}>${escapeHtml(col.rotulo)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${dividas.map(d => `
            <tr class="divida-row status-${getStatus(d)}" data-divida-id="${d.id}">
              ${cols.map(col => comRotulo(celulaDivida(c, d, col), col.rotulo)).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <p class="dividas-legenda">Valores em R$.${c.corretorNome || dividas.some(d => condominioCobrado(d) > 0)
      ? ' <strong>A cobrar</strong> é o que o inquilino deve; <strong>Líquido</strong> é o que sobra para o proprietário, já sem a comissão do corretor e sem o condomínio (que são repassados).'
      : ''}</p>
  `;
}

function bindDividaRowActions(container) {
  container.querySelectorAll('[data-divida-action]').forEach(btn => {
    const dividaId = btn.dataset.dividaId;
    const action = btn.dataset.dividaAction;
    btn.addEventListener('click', () => {
      if (action === 'pagar') openPagamento(dividaId);
      else if (action === 'editar') openEditDivida(dividaId);
      else if (action === 'excluir') excluirDivida(dividaId);
      else if (action === 'recibo') abrirRecibo(dividaId, btn.dataset.pagamentoIndice);
    });
  });
}

/* ===================== RENDER: CARD DE CONTRATO (grupo com dívidas) ===================== */
function contratoGrupoHtml(c) {
  const dividasOrdenadas = c.dividas.slice().sort((a, b) => a.vencimento < b.vencimento ? 1 : -1);
  const pendentes = c.dividas.filter(d => !d.pago).length;

  return `
    <div class="contrato-grupo" data-contrato-id="${c.id}">
      <div class="contrato-grupo-header">
        <div>
          <div class="contrato-title">#${c.numero || '--'} — ${escapeHtml(c.imovel)}${c.encerrado ? ' <span class="status-badge status-atrasado">Encerrado</span>' : ''}</div>
          <div class="contrato-sub">${icon('user')} ${escapeHtml(c.inquilino)} · ${c.dividas.length} dívida(s)${pendentes ? `, ${pendentes} em aberto` : ' — tudo pago'}</div>
          ${c.dataInicio ? `<div class="contrato-sub">${icon('calendar')} Início: ${formatDate(c.dataInicio)} · Aniversário: ${formatDate(dataAniversarioReajuste(c))} · ${formatTempoDeContrato(c.dataInicio)} de contrato</div>` : ''}
          ${c.carteiraId && carteiraNome(c.carteiraId) ? `<div class="contrato-sub">${icon('tag')} Carteira: ${escapeHtml(carteiraNome(c.carteiraId))}${carteiraPorId(c.carteiraId).proprietario ? ` · Proprietário: ${escapeHtml(carteiraPorId(c.carteiraId).proprietario)}` : ''}</div>` : ''}
          ${c.quemRecebeu ? `<div class="contrato-sub">Recebedor padrão: ${escapeHtml(c.quemRecebeu)}</div>` : ''}
          ${c.corretorNome ? `<div class="contrato-sub">${icon('user')} Corretor: ${escapeHtml(c.corretorNome)} (${c.corretorPercentual}% do aluguel, deduzido do total líquido)</div>` : ''}
          ${c.caucao ? `<div class="contrato-sub">${icon('wallet')} Caução retida: ${formatCurrency(c.caucao)} (não somada a nenhum total)${c.caucaoDevolvida ? ` — devolvida em ${formatDate(c.dataCaucaoDevolvida)} (${formatCurrency(c.valorCaucaoDevolvida)})` : ''}</div>` : ''}
          ${!c.encerrado && precisaReajuste(c) ? `<div class="contrato-sub">${icon('trending-up')} Reajuste sugerido: ${formatCurrency(valorReajusteSugerido(c))}</div>` : ''}
          ${c.encerrado ? `<div class="contrato-sub">Encerrado em ${formatDate(c.dataEncerramento)}</div>` : ''}
        </div>
        <div class="contrato-actions">
          <button class="btn btn-ghost btn-sm" data-grupo-action="atualizar" data-contrato-id="${c.id}">${icon('calendar')} Atualizar dívidas</button>
          <button class="btn btn-ghost btn-sm" data-grupo-action="reajustar" data-contrato-id="${c.id}">${icon('trending-up')} Reajustar</button>
          ${c.anexoContrato ? `<a class="btn btn-ghost btn-sm" href="api/anexo.php?file=${encodeURIComponent(c.anexoContrato)}" target="_blank">${icon('paperclip')} Anexo</a>` : ''}
          <button class="btn btn-ghost btn-sm" data-grupo-action="historico" data-contrato-id="${c.id}">${icon('receipt')} Histórico</button>
          <button class="btn btn-ghost btn-sm" data-grupo-action="editar" data-contrato-id="${c.id}">${icon('pencil')} Editar contrato</button>
          ${c.caucao ? `<button class="btn btn-ghost btn-sm" data-grupo-action="devolver-caucao" data-contrato-id="${c.id}">${icon('wallet')} ${c.caucaoDevolvida ? 'Editar devolução da caução' : 'Devolver caução'}</button>` : ''}
          ${c.encerrado
            ? `<button class="btn btn-ghost btn-sm" data-grupo-action="reabrir" data-contrato-id="${c.id}">${icon('trending-up')} Reabrir contrato</button>`
            : `<button class="btn btn-ghost btn-sm" data-grupo-action="encerrar" data-contrato-id="${c.id}">${icon('clock')} Encerrar contrato</button>`}
          <button class="btn btn-danger btn-sm" data-grupo-action="excluir" data-contrato-id="${c.id}">${icon('trash')} Excluir contrato</button>
        </div>
      </div>
      <div class="contrato-grupo-dividas">
        ${dividasOrdenadas.length ? dividasTabelaHtml(c, dividasOrdenadas) : '<div class="empty-state">Nenhuma dívida cadastrada. Use "Atualizar dívidas" para gerar a próxima.</div>'}
      </div>
    </div>
  `;
}

function bindGrupoActions(container) {
  container.querySelectorAll('[data-grupo-action]').forEach(btn => {
    const contratoId = btn.dataset.contratoId;
    const action = btn.dataset.grupoAction;
    btn.addEventListener('click', () => {
      if (action === 'editar') openContratoInfo(contratoId);
      else if (action === 'reajustar') openReajuste(contratoId);
      else if (action === 'historico') openHistoricoContrato(contratoId);
      else if (action === 'excluir') excluirContrato(contratoId);
      else if (action === 'atualizar') atualizarDividas(contratoId);
      else if (action === 'encerrar') encerrarContrato(contratoId);
      else if (action === 'reabrir') reabrirContrato(contratoId);
      else if (action === 'devolver-caucao') abrirDevolucaoCaucao(contratoId);
    });
  });
  bindDividaRowActions(container);
}

/* ===================== RENDER: TABELA DE DÍVIDAS "ACHATADAS" =====================
 * Dashboard e Atrasos listam dívidas de contratos DIFERENTES, então ganham duas
 * colunas a mais (o contrato e o inquilino) — no resto é a mesma tabela de
 * dentro de um contrato, com as mesmas colunas, cores e botões de ícone. Os
 * itens já vêm "achatados" com os dados do contrato pai, então cada um serve ao
 * mesmo tempo como contrato e como dívida nas funções de cálculo.
 */
function colunasDividasFlat(itens) {
  const alguma = (fn) => itens.some(fn);
  const temCorretor = alguma(d => !!d.corretorNome);
  const temDeducoes = temCorretor || alguma(d => condominioCobrado(d) > 0);
  const cols = [
    { key: 'contrato', rotulo: 'Contrato', txt: true },
    { key: 'inquilino', rotulo: 'Inquilino', txt: true },
    { key: 'vencimento', rotulo: 'Venc.', txt: true },
    { key: 'status', rotulo: 'Status', txt: true },
    { key: 'aluguel', rotulo: 'Aluguel' },
  ];
  if (alguma(d => condominioCobrado(d) > 0)) cols.push({ key: 'condominio', rotulo: '+ Cond.' });
  if (alguma(d => Number(d.juros) > 0)) cols.push({ key: 'juros', rotulo: '+ Juros' });
  if (alguma(d => Number(d.multa) > 0)) cols.push({ key: 'multa', rotulo: '+ Multa' });
  if (alguma(d => Number(d.desconto) > 0)) cols.push({ key: 'desconto', rotulo: '− Desc.' });
  cols.push({ key: 'total', rotulo: temDeducoes ? '= A cobrar' : '= Total', forte: true });
  if (temCorretor) cols.push({ key: 'corretor', rotulo: '− Corretor', dica: 'Percentual do aluguel que vai para o corretor do contrato' });
  if (temDeducoes) cols.push({ key: 'liquido', rotulo: '= Líquido', forte: true, dica: 'Total a cobrar menos a comissão do corretor e o condomínio, que são repassados' });
  if (alguma(d => getStatus(d) === 'atrasado')) {
    cols.push({ key: 'atraso', rotulo: 'Atraso', dica: 'Juros e multa acumulados até hoje' });
    cols.push({ key: 'dias', rotulo: 'Dias' });
  }
  cols.push({ key: 'acoesFlat', rotulo: '', txt: true, acoes: true });
  return cols;
}

function celulaDividaFlat(item, col) {
  if (col.key === 'contrato') {
    return `<td class="col-txt col-cabecalho">
      <span class="divida-venc">#${item.numero || '--'}</span>
      <span class="divida-obs" title="${escapeHtml(item.imovel)}">${escapeHtml(item.imovel)}</span>
    </td>`;
  }
  if (col.key === 'inquilino') return `<td class="col-txt col-cabecalho">${escapeHtml(item.inquilino)}</td>`;
  if (col.key === 'acoesFlat') {
    const status = getStatus(item);
    return `<td class="col-acoes">
      <div class="divida-acoes">
        ${status !== 'pago' ? `<button class="btn-acao is-pagar" data-divida-action="pagar" data-divida-id="${item.id}" title="Registrar pagamento" aria-label="Registrar pagamento">${icon('dollar')}</button>` : ''}
        <button class="btn-acao" data-grupo-action="historico" data-contrato-id="${item.contratoId}" title="Histórico deste contrato" aria-label="Histórico do contrato">${icon('receipt')}</button>
        <button class="btn-acao" data-divida-action="editar" data-divida-id="${item.id}" title="Editar esta dívida" aria-label="Editar dívida">${icon('pencil')}</button>
      </div>
    </td>`;
  }
  // o item achatado serve como contrato e como dívida
  return celulaDivida(item, item, col);
}

function dividasTabelaFlatHtml(itens) {
  const cols = colunasDividasFlat(itens);
  return `
    <div class="dividas-scroll">
      <table class="dividas-tabela">
        <thead>
          <tr>${cols.map(col => `<th class="${col.txt ? 'col-txt' : ''}${col.forte ? ' is-forte' : ''}${col.acoes ? ' col-acoes' : ''}"${col.dica ? ` title="${escapeHtml(col.dica)}"` : ''}>${escapeHtml(col.rotulo)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${itens.map(item => `
            <tr class="divida-row status-${getStatus(item)}" data-divida-id="${item.id}">
              ${cols.map(col => comRotulo(celulaDividaFlat(item, col), col.rotulo)).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <p class="dividas-legenda">Valores em R$.</p>
  `;
}

function bindDividaCardActions(container) {
  bindDividaRowActions(container);
  container.querySelectorAll('[data-grupo-action="historico"]').forEach(btn => {
    btn.addEventListener('click', () => openHistoricoContrato(btn.dataset.contratoId));
  });
}

/* ===================== RENDER: CONTRATOS TAB ===================== */
const CONTRATOS_POR_PAGINA = 20;
let contratosPaginaAtual = 1;

function renderContratos() {
  populateAnoFilter();
  const list = document.getElementById('contratosList');
  const pagination = document.getElementById('contratosPagination');
  const filtered = getFilteredContratos();

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">Nenhum contrato encontrado.</div>';
    pagination.innerHTML = '';
    return;
  }

  const totalPaginas = Math.max(1, Math.ceil(filtered.length / CONTRATOS_POR_PAGINA));
  contratosPaginaAtual = Math.min(Math.max(contratosPaginaAtual, 1), totalPaginas);
  const inicio = (contratosPaginaAtual - 1) * CONTRATOS_POR_PAGINA;
  const pagina = filtered.slice(inicio, inicio + CONTRATOS_POR_PAGINA);

  list.innerHTML = pagina.map(contratoGrupoHtml).join('');
  bindGrupoActions(list);
  renderContratosPagination(totalPaginas, filtered.length);
}

function renderContratosPagination(totalPaginas, totalContratos) {
  const pagination = document.getElementById('contratosPagination');
  if (totalPaginas <= 1) {
    pagination.innerHTML = '';
    return;
  }
  pagination.innerHTML = `
    <button type="button" class="btn btn-ghost btn-sm" id="btnPaginaAnterior" ${contratosPaginaAtual <= 1 ? 'disabled' : ''}>‹ Anterior</button>
    <span class="pagination-info">Página ${contratosPaginaAtual} de ${totalPaginas} (${totalContratos} contratos)</span>
    <button type="button" class="btn btn-ghost btn-sm" id="btnPaginaProxima" ${contratosPaginaAtual >= totalPaginas ? 'disabled' : ''}>Próxima ›</button>
  `;
  document.getElementById('btnPaginaAnterior').addEventListener('click', () => {
    contratosPaginaAtual--;
    renderContratos();
  });
  document.getElementById('btnPaginaProxima').addEventListener('click', () => {
    contratosPaginaAtual++;
    renderContratos();
  });
}

/* ===================== RENDER: DASHBOARD ===================== */
function renderDashboard() {
  const dividas = todasDividas();
  const ativos = dividas.filter(d => getStatus(d) === 'ativo');
  const atrasados = dividas.filter(d => getStatus(d) === 'atrasado');
  const totalAtraso = atrasados.reduce((sum, d) => sum + d.total + calcAtrasoAtual(d), 0);

  // "Contratos ativos" conta CONTRATOS em andamento — os que ainda não foram
  // encerrados — e não dívidas com status "ativo". Um contrato com todas as
  // parcelas pagas, ou com parcelas atrasadas, continua em andamento: o que o
  // encerra é o botão "Encerrar contrato", que só para de gerar novas dívidas
  // (nada é apagado, o histórico continua acessível).
  const contratosEmAndamento = contratosVisiveis().filter(c => !c.encerrado).length;
  document.getElementById('statAtivos').textContent = contratosEmAndamento;
  document.getElementById('statAtraso').textContent = formatCurrency(totalAtraso);

  const pendentes = dividas.filter(d => getStatus(d) !== 'pago');
  const proximo = pendentes.slice().sort((a, b) => parseDate(a.vencimento) - parseDate(b.vencimento))[0];
  document.getElementById('statProximo').textContent = proximo ? formatDate(proximo.vencimento) : '--';

  const hoje = new Date();
  const despesasMes = despesasVisiveis()
    .filter(d => { const dt = parseDate(d.data); return dt.getFullYear() === hoje.getFullYear() && dt.getMonth() === hoje.getMonth(); })
    .reduce((sum, d) => sum + d.valor, 0);
  document.getElementById('statDespesasMesDashboard').textContent = formatCurrency(despesasMes);
  renderComissaoMes(hoje);

  renderAlertaVencimento(ativos);
  renderAlertaReajuste();

  const recentes = dividas.slice().sort((a, b) => b.criadoEm - a.criadoEm).slice(0, 5);
  const recentList = document.getElementById('dashboardRecentList');
  recentList.innerHTML = recentes.length
    ? dividasTabelaFlatHtml(recentes)
    : '<div class="empty-state">Nenhum contrato cadastrado ainda. Clique em "Novo contrato" para começar.</div>';
  bindDividaCardActions(recentList);
}

// Muda para a aba Contratos e filtra a busca pelo número do contrato — usado
// como "link" clicável nos alertas do Dashboard, para não deixar quem vê o
// aviso sem um jeito direto de chegar no contrato correspondente.
function irParaContrato(numero) {
  const btnContratos = document.querySelector('.tab-btn[data-tab="contratos"]');
  if (btnContratos) btnContratos.click();
  const searchInput = document.getElementById('searchContratos');
  searchInput.value = '#' + numero;
  contratosPaginaAtual = 1;
  renderContratos();
}

function renderAlertaVencimento(ativos) {
  const banner = document.getElementById('dashboardAlertaVencimento');
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const limite = new Date(hoje); limite.setDate(limite.getDate() + DIAS_ALERTA_VENCIMENTO);

  const vencendo = ativos
    .filter(d => parseDate(d.vencimento) <= limite)
    .sort((a, b) => parseDate(a.vencimento) - parseDate(b.vencimento));

  if (!vencendo.length) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }

  const itens = vencendo.map(d => `<button type="button" class="alert-banner-item" data-ir-contrato="${d.numero}">#${d.numero} ${escapeHtml(d.imovel)} (${escapeHtml(d.inquilino)}) — ${formatDate(d.vencimento)}</button>`).join('');
  banner.innerHTML = `<strong>${icon('alert-triangle')} ${vencendo.length} dívida(s) vencendo nos próximos ${DIAS_ALERTA_VENCIMENTO} dias</strong><div class="alert-banner-list">${itens}</div>`;
  banner.classList.remove('hidden');
  banner.querySelectorAll('[data-ir-contrato]').forEach(btn => {
    btn.addEventListener('click', () => irParaContrato(btn.dataset.irContrato));
  });
}

// Contratos ativos (não encerrados) que já passaram do "aniversário" de 1 ano
// desde o último reajuste (ou desde o início, se nunca reajustado) — sugestão
// baseada no percentual configurável em Configurações, sem consulta a nenhum
// índice externo real (o sistema não tem acesso à internet).
function renderAlertaReajuste() {
  const banner = document.getElementById('dashboardAlertaReajuste');
  const pendentes = contratosVisiveis().filter(precisaReajuste);

  if (!pendentes.length) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }

  const itens = pendentes.map(c => `<button type="button" class="alert-banner-item" data-abrir-reajuste="${c.id}">#${c.numero} ${escapeHtml(c.imovel)} (${escapeHtml(c.inquilino)}) — sugestão: ${formatCurrency(valorReajusteSugerido(c))}</button>`).join('');
  banner.innerHTML = `<strong>${icon('trending-up')} ${pendentes.length} contrato(s) com reajuste sugerido</strong><div class="alert-banner-list">${itens}</div>`;
  banner.classList.remove('hidden');
  banner.querySelectorAll('[data-abrir-reajuste]').forEach(btn => {
    btn.addEventListener('click', () => openReajuste(btn.dataset.abrirReajuste));
  });
}

/* ===================== RENDER: ATRASOS ===================== */
function renderAtrasos() {
  const list = document.getElementById('atrasosList');
  const atrasados = todasDividas().filter(d => getStatus(d) === 'atrasado')
    .sort((a, b) => parseDate(a.vencimento) - parseDate(b.vencimento));

  const totalAtrasados = atrasados.reduce((sum, d) => sum + d.total + calcAtrasoAtual(d), 0);
  document.getElementById('statTotalAtrasados').textContent = formatCurrency(totalAtrasados);

  if (!atrasados.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma dívida em atraso. 🎉</div>';
    return;
  }
  list.innerHTML = dividasTabelaFlatHtml(atrasados);
  bindDividaCardActions(list);
}

/* ===================== RENDER: HISTÓRICO ===================== */
function populateHistoricoFilter() {
  const select = document.getElementById('historicoFiltroContrato');
  const current = select.value;
  const visiveis = contratosVisiveis();
  select.innerHTML = '<option value="">Todos os contratos</option>' +
    visiveis.map(c => `<option value="${c.id}">${escapeHtml(c.imovel)} — ${escapeHtml(c.inquilino)}</option>`).join('');
  select.value = visiveis.some(c => c.id === current) ? current : '';

  const selectAno = document.getElementById('historicoFiltroAno');
  const anos = new Set();
  visiveis.forEach(c => c.dividas.forEach(d => d.pagamentos.forEach(p => anos.add(parseDate(p.data).getFullYear()))));
  const ordenados = Array.from(anos).sort((a, b) => b - a);
  const anoAtual = selectAno.value;
  selectAno.innerHTML = '<option value="">Todos os anos</option>' + ordenados.map(a => `<option value="${a}">${a}</option>`).join('');
  selectAno.value = ordenados.map(String).includes(anoAtual) ? anoAtual : '';
}

// Lista de pagamentos que atende aos filtros da aba (contrato, ano e busca por
// texto), já ordenada do mais recente para o mais antigo. É a MESMA fonte usada
// para desenhar a tela e para exportar o CSV, então os dois nunca divergem.
function historicoFiltrado() {
  const filtroId = document.getElementById('historicoFiltroContrato').value;
  const filtroAno = document.getElementById('historicoFiltroAno').value;
  const busca = document.getElementById('historicoSearch').value.trim().toLowerCase();

  const entries = [];
  contratosVisiveis().forEach(c => {
    if (filtroId && c.id !== filtroId) return;
    c.dividas.forEach(d => d.pagamentos.forEach((p, indice) => {
      if (filtroAno && parseDate(p.data).getFullYear() !== Number(filtroAno)) return;
      if (busca) {
        const alvo = [c.imovel, c.inquilino, p.forma, p.quemRecebeu, p.observacao, p.motivoDesconto, '#' + (c.numero || '')]
          .join(' ').toLowerCase();
        if (!alvo.includes(busca)) return;
      }
      entries.push({ ...p, contrato: c, divida: d, indicePagamento: indice });
    }));
  });
  entries.sort((a, b) => parseDate(b.data) - parseDate(a.data));
  return entries;
}

// A lista pagina, mas o CONTADOR e a EXPORTAÇÃO continuam olhando o filtro
// inteiro: o CSV precisa sair com tudo que está filtrado, não só com a página
// que está na tela.
const HISTORICO_POR_PAGINA = 20;
let historicoPaginaAtual = 1;

function renderHistorico() {
  populateHistoricoFilter();
  const list = document.getElementById('historicoList');
  const paginacao = document.getElementById('historicoPagination');
  const entries = historicoFiltrado();

  const contador = document.getElementById('historicoCount');
  const totalRecebido = entries.reduce((sum, e) => sum + (Number(e.valor) || 0), 0);
  contador.textContent = entries.length === 1
    ? `1 pagamento · ${formatCurrency(totalRecebido)}`
    : `${entries.length} pagamentos · ${formatCurrency(totalRecebido)}`;

  if (!entries.length) {
    list.innerHTML = '<div class="empty-state">Nenhum pagamento encontrado para esses filtros.</div>';
    paginacao.innerHTML = '';
    return;
  }

  const totalPaginas = Math.max(1, Math.ceil(entries.length / HISTORICO_POR_PAGINA));
  historicoPaginaAtual = Math.min(Math.max(historicoPaginaAtual, 1), totalPaginas);
  const inicio = (historicoPaginaAtual - 1) * HISTORICO_POR_PAGINA;
  const pagina = entries.slice(inicio, inicio + HISTORICO_POR_PAGINA);

  list.innerHTML = pagina.map(e => {
    const valorLiquido = valorLiquidoPagamento(e.contrato, e.divida, e);
    return `
    <div class="card">
      <div class="contrato-top">
        <div>
          <div class="contrato-title">${escapeHtml(e.contrato.imovel)}</div>
          <div class="contrato-sub">${icon('user')} ${escapeHtml(e.contrato.inquilino)} · Dívida de ${formatDate(e.divida.vencimento)}</div>
        </div>
        <span class="status-badge status-pago">Pago</span>
      </div>
      <div class="contrato-grid">
        <div><span>Data do pagamento</span><strong>${formatDate(e.data)}</strong></div>
        <div><span>Valor pago</span><strong>${formatCurrency(e.valor)}</strong></div>
        ${Math.abs(valorLiquido - e.valor) > 0.001 ? `<div><span>Valor líquido</span><strong>${formatCurrency(valorLiquido)}</strong></div>` : ''}
        ${e.desconto ? `<div><span>Desconto</span><strong>${formatCurrency(e.desconto)}</strong></div>` : ''}
        ${e.desconto && e.motivoDesconto ? `<div><span>Motivo do desconto</span><strong>${escapeHtml(e.motivoDesconto)}</strong></div>` : ''}
        ${condominioCobrado(e.divida) > 0 ? `<div><span>Condomínio junto</span><strong>${condominioNoPagamento(e.divida, e) > 0 ? 'Sim — ' + formatCurrency(condominioNoPagamento(e.divida, e)) : 'Não'}</strong></div>` : ''}
        <div><span>Forma de pagamento</span><strong>${escapeHtml(e.forma) || '--'}</strong></div>
        <div><span>Quem recebeu</span><strong>${escapeHtml(e.quemRecebeu) || '--'}</strong></div>
        <div><span>Observação</span><strong>${escapeHtml(e.observacao) || '--'}</strong></div>
      </div>
      <div class="contrato-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-recibo-divida="${e.divida.id}" data-recibo-indice="${e.indicePagamento}">${icon('receipt')} Recibo</button>
      </div>
    </div>
  `;
  }).join('');

  bindReciboButtons(list);
  renderHistoricoPagination(totalPaginas, entries.length);
}

function renderHistoricoPagination(totalPaginas, totalPagamentos) {
  const paginacao = document.getElementById('historicoPagination');
  if (totalPaginas <= 1) {
    paginacao.innerHTML = '';
    return;
  }
  paginacao.innerHTML = `
    <button type="button" class="btn btn-ghost btn-sm" id="btnHistoricoAnterior" ${historicoPaginaAtual <= 1 ? 'disabled' : ''}>‹ Anterior</button>
    <span class="pagination-info">Página ${historicoPaginaAtual} de ${totalPaginas} (${totalPagamentos} pagamentos)</span>
    <button type="button" class="btn btn-ghost btn-sm" id="btnHistoricoProxima" ${historicoPaginaAtual >= totalPaginas ? 'disabled' : ''}>Próxima ›</button>
  `;
  document.getElementById('btnHistoricoAnterior').addEventListener('click', () => {
    historicoPaginaAtual--;
    renderHistorico();
  });
  document.getElementById('btnHistoricoProxima').addEventListener('click', () => {
    historicoPaginaAtual++;
    renderHistorico();
  });
}

// Botões "Recibo" das listas de pagamento (aba Histórico e modal por contrato).
function bindReciboButtons(container) {
  container.querySelectorAll('[data-recibo-divida]').forEach(btn => {
    btn.addEventListener('click', () => abrirRecibo(btn.dataset.reciboDivida, Number(btn.dataset.reciboIndice)));
  });
}

['historicoFiltroContrato', 'historicoFiltroAno'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    historicoPaginaAtual = 1;
    renderHistorico();
  });
});
document.getElementById('historicoSearch').addEventListener('input', () => {
  historicoPaginaAtual = 1;
  renderHistorico();
});

document.getElementById('btnExportHistorico').addEventListener('click', () => {
  const entries = historicoFiltrado();
  if (!entries.length) { showToast('Nenhum pagamento para exportar.', 'error'); return; }

  // A ordem das colunas de dinheiro segue a conta: valor pago, as deduções, e o
  // líquido no fim — dá para conferir a subtração lendo a linha da esquerda
  // para a direita.
  const headers = ['Nº Contrato', 'Carteira', 'Proprietário', 'Imóvel', 'Inquilino',
    'Dívida (Vencimento)', 'Total da Dívida', 'Data do Pagamento', 'Valor Pago',
    'Comissão do Corretor', 'Condomínio (Repasse)', 'Valor Líquido',
    'Desconto', 'Motivo do Desconto', 'Forma de Pagamento', 'Quem Recebeu', 'Observação'];
  const rows = entries.map(e => {
    const carteira = carteiraPorId(e.contrato.carteiraId) || {};
    return [
      e.contrato.numero || '',
      carteiraNome(e.contrato.carteiraId),
      carteira.proprietario || '',
      e.contrato.imovel,
      e.contrato.inquilino,
      formatDate(e.divida.vencimento),
      (Number(e.divida.total) || 0).toFixed(2),
      formatDate(e.data),
      (Number(e.valor) || 0).toFixed(2),
      comissaoCorretor(e.contrato, e.divida).toFixed(2),
      condominioNoPagamento(e.divida, e).toFixed(2),
      valorLiquidoPagamento(e.contrato, e.divida, e).toFixed(2),
      (e.desconto || 0).toFixed(2),
      e.motivoDesconto || '',
      e.forma || '',
      e.quemRecebeu || '',
      e.observacao || '',
    ];
  });

  downloadCsv(`historico_pagamentos_${todayStr()}.csv`, headers, rows);
  showToast(`${entries.length} pagamento(s) exportado(s).`, 'success');
});

/* ===================== DESPESAS =====================
 * Lançamentos simples de despesa (data, descrição, valor), opcionalmente
 * ligados a um contrato. Consultáveis por mês (filtro de mês) e por ano
 * (filtro de ano, com total do ano sempre visível independente do mês).
 */
const formDespesa = document.getElementById('formDespesa');

function populateDespesaContratoSelect() {
  const select = document.getElementById('despContrato');
  const current = select.value;
  const visiveis = contratosVisiveis();
  select.innerHTML = '<option value="">Nenhum (despesa geral)</option>' +
    visiveis.map(c => `<option value="${c.id}">${escapeHtml(c.imovel)} — ${escapeHtml(c.inquilino)}</option>`).join('');
  select.value = visiveis.some(c => c.id === current) ? current : '';
}

function populateDespesaAnoFilter() {
  const select = document.getElementById('despesaFiltroAno');
  const anos = new Set(despesasVisiveis().map(d => parseDate(d.data).getFullYear()));
  anos.add(new Date().getFullYear());
  const sorted = Array.from(anos).sort((a, b) => b - a);
  const current = select.value;
  select.innerHTML = sorted.map(a => `<option value="${a}">${a}</option>`).join('');
  select.value = sorted.map(String).includes(current) ? current : String(new Date().getFullYear());
}

function despesaContratoLabel(contratoId) {
  const c = state.contratos.find(x => x.id === contratoId);
  return c ? `${c.imovel} — ${c.inquilino}` : 'Contrato removido';
}

// Gráfico de barras com o total de despesas de cada mês do ano selecionado no
// filtro desta aba (mesma fonte de dados da lista logo abaixo).
function renderDespesasAnoChart() {
  const select = document.getElementById('despesaFiltroAno');
  const ano = Number(select && select.value) || new Date().getFullYear();
  document.getElementById('despesasChartAno').textContent = String(ano);
  const months = mesesDoAno(ano);
  renderColumnChart(
    'chartDespesasAno',
    months.map(m => m.label),
    despesasPorMes(months),
    '--warn',
    'Nenhuma despesa registrada em ' + ano
  );
}

function renderDespesas() {
  if (!document.getElementById('despData').value) document.getElementById('despData').value = todayStr();
  populateDespesaContratoSelect();
  populateDespesaAnoFilter();

  const selectCarteira = document.getElementById('despCarteira');
  // com uma edição em andamento, não mexe no que já está escolhido no formulário
  populateCarteiraSelect(selectCarteira, document.getElementById('despesaId').value ? selectCarteira.value : carteiraAtiva);
  atualizarVisibilidadeCamposCarteira();

  const ano = Number(document.getElementById('despesaFiltroAno').value);
  const mes = document.getElementById('despesaFiltroMes').value;

  renderDespesasAnoChart();

  const doAno = despesasVisiveis().filter(d => parseDate(d.data).getFullYear() === ano);
  const totalAno = doAno.reduce((sum, d) => sum + d.valor, 0);
  document.getElementById('statDespesaAno').textContent = formatCurrency(totalAno);

  const filtradas = doAno.filter(d => mes === '' || parseDate(d.data).getMonth() === Number(mes));
  const totalFiltrado = filtradas.reduce((sum, d) => sum + d.valor, 0);
  document.getElementById('statDespesaFiltro').textContent = formatCurrency(totalFiltrado);

  const ordenadas = filtradas.slice().sort((a, b) => a.data < b.data ? 1 : -1);
  const list = document.getElementById('despesasList');
  if (!ordenadas.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma despesa registrada neste período.</div>';
    return;
  }
  list.innerHTML = ordenadas.map(d => `
    <div class="card">
      <div class="contrato-top">
        <div>
          <div class="contrato-title">${escapeHtml(d.descricao)}</div>
          <div class="contrato-sub">${icon('calendar')} ${formatDate(d.data)}${d.contratoId ? ` · ${icon('user')} ${escapeHtml(despesaContratoLabel(d.contratoId))}` : ' · Despesa geral'}${carteiraDaDespesa(d) ? ` · ${icon('tag')} ${escapeHtml(carteiraNome(carteiraDaDespesa(d)))}` : ''}</div>
        </div>
        <strong class="text-danger">${formatCurrency(d.valor)}</strong>
      </div>
      <div class="contrato-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-edit-despesa="${d.id}">${icon('pencil')} Editar</button>
        <button type="button" class="btn btn-danger btn-sm" data-remove-despesa="${d.id}">${icon('trash')} Excluir</button>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('[data-remove-despesa]').forEach(btn => {
    btn.addEventListener('click', () => excluirDespesa(btn.dataset.removeDespesa));
  });
  list.querySelectorAll('[data-edit-despesa]').forEach(btn => {
    btn.addEventListener('click', () => editarDespesa(btn.dataset.editDespesa));
  });
}

function excluirDespesa(id) {
  const d = state.despesas.find(x => x.id === id);
  if (!d) return;
  if (!confirm(`Excluir a despesa "${d.descricao}" de ${formatCurrency(d.valor)}?`)) return;
  state.despesas = state.despesas.filter(x => x.id !== id);
  registrarAuditoria('despesa_excluida', `Despesa excluída: ${d.descricao} (${formatCurrency(d.valor)})`);
  saveState();
  renderDespesas();
  showToast('Despesa excluída.', 'success');
}

const LABELS_DESPESA = { data: 'Data', descricao: 'Descrição', valor: 'Valor (R$)', contratoId: 'Contrato relacionado' };

function editarDespesa(id) {
  const d = state.despesas.find(x => x.id === id);
  if (!d) return;
  document.getElementById('despesaId').value = d.id;
  document.getElementById('despData').value = d.data;
  document.getElementById('despDescricao').value = d.descricao;
  document.getElementById('despValor').value = d.valor;
  populateDespesaContratoSelect();
  document.getElementById('despContrato').value = d.contratoId || '';
  populateCarteiraSelect(document.getElementById('despCarteira'), d.carteiraId || '');
  atualizarVisibilidadeCamposCarteira();
  document.getElementById('formDespesaTitle').textContent = 'Editar despesa';
  document.getElementById('btnSalvarDespesa').textContent = 'Salvar alterações';
  document.getElementById('btnCancelarEdicaoDespesa').classList.remove('hidden');
  document.getElementById('despDescricao').focus();
}

function cancelarEdicaoDespesa() {
  document.getElementById('despesaId').value = '';
  formDespesa.reset();
  document.getElementById('despData').value = todayStr();
  populateCarteiraSelect(document.getElementById('despCarteira'), carteiraAtiva);
  atualizarVisibilidadeCamposCarteira();
  document.getElementById('formDespesaTitle').textContent = 'Nova despesa';
  document.getElementById('btnSalvarDespesa').textContent = 'Adicionar despesa';
  document.getElementById('btnCancelarEdicaoDespesa').classList.add('hidden');
}

document.getElementById('btnCancelarEdicaoDespesa').addEventListener('click', cancelarEdicaoDespesa);

// Com um contrato escolhido, a carteira vem dele — o campo some para não dar a
// impressão de que dá para pôr a despesa numa carteira diferente do contrato.
document.getElementById('despContrato').addEventListener('change', atualizarVisibilidadeCamposCarteira);

formDespesa.addEventListener('submit', (e) => {
  e.preventDefault();
  const despesaId = document.getElementById('despesaId').value;
  const data = document.getElementById('despData').value;
  const descricao = document.getElementById('despDescricao').value.trim();
  const valor = Number(document.getElementById('despValor').value) || 0;
  const contratoId = document.getElementById('despContrato').value || null;
  // despesa ligada a contrato herda a carteira dele: não guarda carteira própria
  const carteiraId = contratoId ? '' : (document.getElementById('despCarteira').value || '');
  if (!data || !descricao || valor <= 0) return;

  if (despesaId) {
    const d = state.despesas.find(x => x.id === despesaId);
    if (!d) return;
    const antes = Object.assign({}, d);
    Object.assign(d, { data, descricao, valor, contratoId, carteiraId });
    const alteracoes = diffCampos(antes, d, LABELS_DESPESA);
    registrarAuditoria('despesa_editada', `Despesa editada: ${descricao} (${formatCurrency(valor)})`, alteracoes);
    saveState();
    cancelarEdicaoDespesa();
    renderDespesas();
    showToast('Despesa atualizada com sucesso.', 'success');
  } else {
    state.despesas.push({ id: uuid(), data, descricao, valor, contratoId, carteiraId, criadoEm: Date.now() });
    registrarAuditoria('despesa_criada', `Despesa registrada: ${descricao} (${formatCurrency(valor)})`);
    saveState();
    const dataAtual = data;
    formDespesa.reset();
    document.getElementById('despData').value = dataAtual;
    populateCarteiraSelect(document.getElementById('despCarteira'), carteiraId || carteiraAtiva);
    atualizarVisibilidadeCamposCarteira();
    renderDespesas();
    showToast('Despesa adicionada com sucesso.', 'success');
  }
});

document.getElementById('despesaFiltroAno').addEventListener('change', renderDespesas);
document.getElementById('despesaFiltroMes').addEventListener('change', renderDespesas);

/* ===================== CONFIG ===================== */
const configForm = document.getElementById('configForm');

function renderConfig() {
  document.getElementById('configTaxaJuros').value = state.config.taxaJurosMensal;
  document.getElementById('configTaxaMulta').value = state.config.taxaMultaPercent;
  document.getElementById('configCorretorPercentualPadrao').value = state.config.corretorPercentualPadrao || 0;
  document.getElementById('configPercentualReajusteSugerido').value = state.config.percentualReajusteSugerido || 0;
  renderPessoasConfig();
  renderCarteirasConfig();
  renderReciboConfig();
}

configForm.addEventListener('submit', (e) => {
  e.preventDefault();
  state.config.taxaJurosMensal = Number(document.getElementById('configTaxaJuros').value) || 0;
  state.config.taxaMultaPercent = Number(document.getElementById('configTaxaMulta').value) || 0;
  saveState();
  const msg = document.getElementById('configSaved');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2200);
  renderAll();
  showToast('Configuração salva com sucesso.', 'success');
});

const configPadraoForm = document.getElementById('configPadraoForm');
configPadraoForm.addEventListener('submit', (e) => {
  e.preventDefault();
  state.config.corretorPercentualPadrao = Number(document.getElementById('configCorretorPercentualPadrao').value) || 0;
  saveState();
  const msg = document.getElementById('configPadraoSaved');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2200);
  showToast('Valores padrão salvos com sucesso.', 'success');
});

const configReajusteForm = document.getElementById('configReajusteForm');
configReajusteForm.addEventListener('submit', (e) => {
  e.preventDefault();
  state.config.percentualReajusteSugerido = Number(document.getElementById('configPercentualReajusteSugerido').value) || 0;
  saveState();
  const msg = document.getElementById('configReajusteSaved');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2200);
  renderAll();
  showToast('Percentual de reajuste salvo com sucesso.', 'success');
});

/* ===================== PESSOAS (cadastro reutilizável: recebedores/corretores) ===================== */
const addPessoaForm = document.getElementById('addPessoaForm');

function populatePessoaSelect(selectEl, valorAtual, placeholder) {
  const atual = valorAtual || '';
  const lista = pessoasVisiveis();
  selectEl.innerHTML = `<option value="">${placeholder}</option>` +
    lista.map(p => `<option value="${escapeHtml(p.nome)}">${escapeHtml(p.nome)}</option>`).join('');
  // se o valor atual não estiver na lista (pessoa removida do cadastro, ou de
  // outra carteira, depois de já usada num contrato/pagamento), mantém o nome
  if (atual && !lista.some(p => p.nome === atual)) {
    selectEl.innerHTML += `<option value="${escapeHtml(atual)}">${escapeHtml(atual)}</option>`;
  }
  selectEl.value = atual;
}

// Sem corretor selecionado, a comissão simplesmente não existe (percentual
// escondido e zerado). Ao escolher um corretor, volta a valer o percentual
// padrão configurado (5% de fábrica).
document.getElementById('fCorretorNome').addEventListener('change', () => {
  const nome = document.getElementById('fCorretorNome').value;
  document.getElementById('fCampoCorretorPercentual').classList.toggle('hidden', !nome);
  document.getElementById('fCorretorPercentual').value = nome ? (state.config.corretorPercentualPadrao || 5) : 0;
});

document.getElementById('infoCorretorNome').addEventListener('change', () => {
  const nome = document.getElementById('infoCorretorNome').value;
  document.getElementById('infoCampoCorretorPercentual').classList.toggle('hidden', !nome);
  document.getElementById('infoCampoCorretorValor').classList.toggle('hidden', !nome);
  document.getElementById('infoCorretorPercentual').value = nome ? (state.config.corretorPercentualPadrao || 5) : 0;
  atualizarValorCorretorInfo();
});

function renderPessoasConfig() {
  const list = document.getElementById('pessoasList');
  const lista = pessoasVisiveis();
  const selectCarteira = document.getElementById('newPessoaCarteira');
  const usaCarteiras = state.carteiras.length > 0;
  // com uma edição em andamento, não mexe no que já está escolhido no formulário
  populateCarteiraSelectPessoa(selectCarteira, document.getElementById('pessoaId').value ? selectCarteira.value : carteiraAtiva);
  document.getElementById('campoNewPessoaCarteira').classList.toggle('hidden', !usaCarteiras);
  document.getElementById('pessoaCarteiraHint').classList.toggle('hidden', !usaCarteiras);

  if (!lista.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma pessoa cadastrada ainda.</div>';
    return;
  }
  list.innerHTML = lista.map(p => `
    <div class="card">
      <div class="contrato-top">
        <div>
          <div class="contrato-title">${escapeHtml(p.nome)}</div>
          ${usaCarteiras ? `<div class="contrato-sub">${icon('tag')} ${p.carteiraId && carteiraNome(p.carteiraId) ? escapeHtml(carteiraNome(p.carteiraId)) : 'Todas as carteiras'}</div>` : ''}
        </div>
        <div class="contrato-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-edit-pessoa="${p.id}">${icon('pencil')} Editar</button>
          <button type="button" class="btn btn-danger btn-sm" data-remove-pessoa="${p.id}">${icon('trash')} Remover</button>
        </div>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('[data-remove-pessoa]').forEach(btn => {
    btn.addEventListener('click', () => removePessoa(btn.dataset.removePessoa));
  });
  list.querySelectorAll('[data-edit-pessoa]').forEach(btn => {
    btn.addEventListener('click', () => editarPessoa(btn.dataset.editPessoa));
  });
}

// Igual ao seletor de carteira dos outros cadastros, só que "vazio" aqui
// significa "vale para todas", e não "sem carteira".
function populateCarteiraSelectPessoa(selectEl, valorAtual) {
  const atual = valorAtual || '';
  selectEl.innerHTML = '<option value="">Todas as carteiras</option>' +
    state.carteiras.map(c => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
  selectEl.value = state.carteiras.some(c => c.id === atual) ? atual : '';
}

function editarPessoa(id) {
  const p = state.pessoas.find(x => x.id === id);
  if (!p) return;
  document.getElementById('pessoaId').value = p.id;
  document.getElementById('newPessoaNome').value = p.nome;
  populateCarteiraSelectPessoa(document.getElementById('newPessoaCarteira'), p.carteiraId || '');
  document.getElementById('btnSalvarPessoa').textContent = 'Salvar alterações';
  document.getElementById('btnCancelarEdicaoPessoa').classList.remove('hidden');
  document.getElementById('newPessoaNome').focus();
}

function cancelarEdicaoPessoa() {
  document.getElementById('pessoaId').value = '';
  document.getElementById('newPessoaNome').value = '';
  populateCarteiraSelectPessoa(document.getElementById('newPessoaCarteira'), carteiraAtiva);
  document.getElementById('btnSalvarPessoa').textContent = 'Adicionar pessoa';
  document.getElementById('btnCancelarEdicaoPessoa').classList.add('hidden');
}

document.getElementById('btnCancelarEdicaoPessoa').addEventListener('click', cancelarEdicaoPessoa);

function removePessoa(id) {
  const p = state.pessoas.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Remover "${p.nome}" da lista de pessoas? Contratos/pagamentos que já usam esse nome não são afetados.`)) return;
  state.pessoas = state.pessoas.filter(x => x.id !== id);
  if (document.getElementById('pessoaId').value === id) cancelarEdicaoPessoa();
  saveState();
  renderPessoasConfig();
  showToast('Pessoa removida.', 'success');
}

addPessoaForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const pessoaId = document.getElementById('pessoaId').value;
  const nome = document.getElementById('newPessoaNome').value.trim();
  const carteiraId = document.getElementById('newPessoaCarteira').value || '';
  if (!nome) return;
  if (state.pessoas.some(p => p.id !== pessoaId && p.nome.toLowerCase() === nome.toLowerCase())) {
    showToast('Já existe uma pessoa cadastrada com esse nome.', 'error');
    return;
  }

  if (pessoaId) {
    const p = state.pessoas.find(x => x.id === pessoaId);
    if (!p) return;
    // renomear atualiza os contratos/pagamentos que já usam o nome antigo,
    // mesma lógica do cadastro de imóveis (a referência é pelo nome)
    const nomeAntigo = p.nome;
    p.nome = nome;
    p.carteiraId = carteiraId;
    if (nomeAntigo !== nome) {
      state.contratos.forEach(c => {
        if (c.quemRecebeu === nomeAntigo) c.quemRecebeu = nome;
        if (c.corretorNome === nomeAntigo) c.corretorNome = nome;
        (c.dividas || []).forEach(d => (d.pagamentos || []).forEach(pg => {
          if (pg.quemRecebeu === nomeAntigo) pg.quemRecebeu = nome;
        }));
      });
    }
    showToast('Pessoa atualizada com sucesso.', 'success');
  } else {
    state.pessoas.push({ id: uuid(), nome, carteiraId });
    showToast('Pessoa adicionada com sucesso.', 'success');
  }

  cancelarEdicaoPessoa();
  saveState();
  renderAll();
});

/* ===================== CARTEIRAS (cadastro + seletor global) ===================== */
const formCarteira = document.getElementById('formCarteira');

function renderCarteirasConfig() {
  renderCarteiraSeletor();
  atualizarVisibilidadeCamposCarteira();

  const list = document.getElementById('carteirasList');
  if (!state.carteiras.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma carteira cadastrada. Sem carteiras, o sistema funciona no modo de um proprietário só.</div>';
    return;
  }
  list.innerHTML = state.carteiras.map(c => {
    const contratos = state.contratos.filter(x => (x.carteiraId || '') === c.id).length;
    const imoveis = state.imoveis.filter(x => (x.carteiraId || '') === c.id).length;
    return `
    <div class="card">
      <div class="contrato-top">
        <div>
          <div class="contrato-title">${escapeHtml(c.nome)}</div>
          ${c.proprietario ? `<div class="contrato-sub">${icon('user')} ${escapeHtml(c.proprietario)}${c.documento ? ` · ${escapeHtml(c.documento)}` : ''}</div>` : ''}
          <div class="contrato-sub">${icon('file-text')} ${contratos} contrato(s) · ${imoveis} imóvel(is)</div>
          ${c.observacao ? `<div class="contrato-sub">${escapeHtml(c.observacao)}</div>` : ''}
        </div>
        <div class="contrato-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-edit-carteira="${c.id}">${icon('pencil')} Editar</button>
          <button type="button" class="btn btn-danger btn-sm" data-remove-carteira="${c.id}">${icon('trash')} Remover</button>
        </div>
      </div>
    </div>
  `;
  }).join('');
  list.querySelectorAll('[data-edit-carteira]').forEach(btn => {
    btn.addEventListener('click', () => editarCarteira(btn.dataset.editCarteira));
  });
  list.querySelectorAll('[data-remove-carteira]').forEach(btn => {
    btn.addEventListener('click', () => removerCarteira(btn.dataset.removeCarteira));
  });
}

function editarCarteira(id) {
  const c = carteiraPorId(id);
  if (!c) return;
  document.getElementById('carteiraId').value = c.id;
  document.getElementById('carteiraNome').value = c.nome;
  document.getElementById('carteiraProprietario').value = c.proprietario || '';
  document.getElementById('carteiraDocumento').value = c.documento || '';
  document.getElementById('carteiraObservacao').value = c.observacao || '';
  document.getElementById('btnSalvarCarteira').textContent = 'Salvar alterações';
  document.getElementById('btnCancelarEdicaoCarteira').classList.remove('hidden');
  document.getElementById('carteiraNome').focus();
}

function cancelarEdicaoCarteira() {
  document.getElementById('carteiraId').value = '';
  formCarteira.reset();
  document.getElementById('btnSalvarCarteira').textContent = 'Adicionar carteira';
  document.getElementById('btnCancelarEdicaoCarteira').classList.add('hidden');
}

document.getElementById('btnCancelarEdicaoCarteira').addEventListener('click', cancelarEdicaoCarteira);

// Remover uma carteira NÃO apaga nada: os contratos, imóveis e despesas dela
// continuam existindo, só voltam a contar como "sem carteira" (imóvel próprio).
function removerCarteira(id) {
  const c = carteiraPorId(id);
  if (!c) return;
  const contratos = state.contratos.filter(x => (x.carteiraId || '') === c.id).length;
  const imoveis = state.imoveis.filter(x => (x.carteiraId || '') === c.id).length;
  const aviso = (contratos || imoveis)
    ? `\n\n${contratos} contrato(s) e ${imoveis} imóvel(is) usam esta carteira. Nada é apagado: eles passam a ficar sem carteira.`
    : '';
  if (!confirm(`Remover a carteira "${c.nome}"?${aviso}`)) return;

  state.carteiras = state.carteiras.filter(x => x.id !== id);
  state.contratos.forEach(x => { if (x.carteiraId === id) x.carteiraId = ''; });
  state.imoveis.forEach(x => { if (x.carteiraId === id) x.carteiraId = ''; });
  state.despesas.forEach(x => { if (x.carteiraId === id) x.carteiraId = ''; });
  if (carteiraAtiva === id) definirCarteiraAtiva('', true);
  if (document.getElementById('carteiraId').value === id) cancelarEdicaoCarteira();

  registrarAuditoria('carteira_excluida', `Carteira excluída: ${c.nome}${contratos ? ` (${contratos} contrato(s) ficaram sem carteira)` : ''}`);
  saveState();
  renderAll();
  showToast('Carteira removida.', 'success');
}

const LABELS_CARTEIRA = {
  nome: 'Nome da carteira', proprietario: 'Proprietário',
  documento: 'CPF / CNPJ', observacao: 'Observação',
};

formCarteira.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('carteiraId').value;
  const nome = document.getElementById('carteiraNome').value.trim();
  const proprietario = document.getElementById('carteiraProprietario').value.trim();
  const documento = document.getElementById('carteiraDocumento').value.trim();
  const observacao = document.getElementById('carteiraObservacao').value.trim();
  if (!nome) return;
  if (state.carteiras.some(c => c.id !== id && c.nome.toLowerCase() === nome.toLowerCase())) {
    showToast('Já existe uma carteira com esse nome.', 'error');
    return;
  }

  if (id) {
    const c = carteiraPorId(id);
    if (!c) return;
    const antes = Object.assign({}, c);
    Object.assign(c, { nome, proprietario, documento, observacao });
    registrarAuditoria('carteira_editada', `Carteira editada: ${nome}`, diffCampos(antes, c, LABELS_CARTEIRA));
    showToast('Carteira atualizada com sucesso.', 'success');
  } else {
    state.carteiras.push({ id: uuid(), nome, proprietario, documento, observacao, criadoEm: Date.now() });
    registrarAuditoria('carteira_criada', `Carteira criada: ${nome}${proprietario ? ` (${proprietario})` : ''}`);
    showToast('Carteira adicionada com sucesso.', 'success');
  }

  cancelarEdicaoCarteira();
  saveState();
  renderAll();
});

document.getElementById('carteiraSeletor').addEventListener('change', (e) => {
  definirCarteiraAtiva(e.target.value);
});

/* ===================== IMÓVEIS (cadastro reutilizável) ===================== */
const formImovel = document.getElementById('formImovel');

// O seletor de imóvel dos contratos mostra só os imóveis da carteira ativa (com
// "Todas as carteiras" escolhido, mostra tudo).
function populateImovelSelect(selectEl, valorAtual) {
  const atual = valorAtual || '';
  const lista = imoveisVisiveis();
  selectEl.innerHTML = '<option value="" disabled' + (atual ? '' : ' selected') + '>Selecione um imóvel...</option>' +
    lista.map(i => `<option value="${escapeHtml(i.nome)}">${escapeHtml(i.nome)}</option>`).join('');
  // se o valor atual não estiver na lista (imóvel removido do cadastro depois
  // de já usado num contrato, ou de outra carteira), mantém mostrando o nome
  if (atual && !lista.some(i => i.nome === atual)) {
    selectEl.innerHTML += `<option value="${escapeHtml(atual)}">${escapeHtml(atual)}</option>`;
  }
  selectEl.value = atual;
}

function renderImoveis() {
  const list = document.getElementById('imoveisList');
  const lista = imoveisVisiveis();
  const selectCarteira = document.getElementById('newImovelCarteira');
  // com uma edição em andamento, não mexe no que já está escolhido no formulário
  populateCarteiraSelect(selectCarteira, document.getElementById('imovelId').value ? selectCarteira.value : carteiraAtiva);
  atualizarVisibilidadeCamposCarteira();

  if (!lista.length) {
    list.innerHTML = '<div class="empty-state">Nenhum imóvel cadastrado ainda.</div>';
    return;
  }
  list.innerHTML = lista.map(i => `
    <div class="card">
      <div class="contrato-top">
        <div>
          <div class="contrato-title">${escapeHtml(i.nome)}</div>
          ${i.carteiraId && carteiraNome(i.carteiraId) ? `<div class="contrato-sub">${icon('tag')} ${escapeHtml(carteiraNome(i.carteiraId))}</div>` : ''}
        </div>
        <div class="contrato-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-edit-imovel="${i.id}">${icon('pencil')} Editar</button>
          <button type="button" class="btn btn-danger btn-sm" data-remove-imovel="${i.id}">${icon('trash')} Remover</button>
        </div>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('[data-remove-imovel]').forEach(btn => {
    btn.addEventListener('click', () => removeImovel(btn.dataset.removeImovel));
  });
  list.querySelectorAll('[data-edit-imovel]').forEach(btn => {
    btn.addEventListener('click', () => editarImovel(btn.dataset.editImovel));
  });
}

function removeImovel(id) {
  const i = state.imoveis.find(x => x.id === id);
  if (!i) return;
  if (!confirm(`Remover "${i.nome}" da lista de imóveis? Contratos que já usam esse imóvel não são afetados.`)) return;
  state.imoveis = state.imoveis.filter(x => x.id !== id);
  if (document.getElementById('imovelId').value === id) cancelarEdicaoImovel();
  saveState();
  renderImoveis();
  showToast('Imóvel removido.', 'success');
}

// Editar carrega o imóvel no mesmo formulário do lado (que passa a ser "Editar
// imóvel"), igual ao formulário de Despesas — a carteira é um select, então não
// dá para editar por `prompt`.
function editarImovel(id) {
  const i = state.imoveis.find(x => x.id === id);
  if (!i) return;
  document.getElementById('imovelId').value = i.id;
  document.getElementById('newImovelNome').value = i.nome;
  populateCarteiraSelect(document.getElementById('newImovelCarteira'), i.carteiraId || '');
  atualizarVisibilidadeCamposCarteira();
  document.getElementById('formImovelTitle').innerHTML = `${icon('pencil')} Editar imóvel`;
  document.getElementById('btnSalvarImovel').textContent = 'Salvar alterações';
  document.getElementById('btnCancelarEdicaoImovel').classList.remove('hidden');
  document.getElementById('newImovelNome').focus();
}

function cancelarEdicaoImovel() {
  document.getElementById('imovelId').value = '';
  formImovel.reset();
  populateCarteiraSelect(document.getElementById('newImovelCarteira'), carteiraAtiva);
  atualizarVisibilidadeCamposCarteira();
  document.getElementById('formImovelTitle').innerHTML = `${icon('plus')} Novo imóvel`;
  document.getElementById('btnSalvarImovel').textContent = 'Adicionar imóvel';
  document.getElementById('btnCancelarEdicaoImovel').classList.add('hidden');
}

document.getElementById('btnCancelarEdicaoImovel').addEventListener('click', cancelarEdicaoImovel);

formImovel.addEventListener('submit', (e) => {
  e.preventDefault();
  const imovelId = document.getElementById('imovelId').value;
  const nomeInput = document.getElementById('newImovelNome');
  const nome = nomeInput.value.trim();
  const carteiraId = document.getElementById('newImovelCarteira').value || '';
  if (!nome) return;
  if (state.imoveis.some(i => i.id !== imovelId && i.nome.toLowerCase() === nome.toLowerCase())) {
    showToast('Já existe um imóvel cadastrado com essa descrição.', 'error');
    return;
  }

  if (imovelId) {
    const i = state.imoveis.find(x => x.id === imovelId);
    if (!i) return;
    const nomeAntigo = i.nome;
    const carteiraAntiga = i.carteiraId || '';
    i.nome = nome;
    i.carteiraId = carteiraId;

    // Diferente de remover, renomear ATUALIZA também os contratos que já usam
    // essa descrição (a intenção normal aqui é corrigir um erro de digitação,
    // não trocar de imóvel) — o contrato guarda o nome, não um id do imóvel.
    let contratosAtualizados = 0;
    state.contratos.forEach(c => {
      if (c.imovel === nomeAntigo) { c.imovel = nome; contratosAtualizados++; }
    });

    const alteracoes = [];
    if (nomeAntigo !== nome) alteracoes.push({ campo: 'Descrição do imóvel', de: nomeAntigo, para: nome });
    if (carteiraAntiga !== carteiraId) {
      alteracoes.push({ campo: 'Carteira', de: carteiraNome(carteiraAntiga) || 'Nenhuma', para: carteiraNome(carteiraId) || 'Nenhuma' });
    }
    if (alteracoes.length) {
      registrarAuditoria(
        'imovel_editado',
        `Imóvel editado: "${nomeAntigo}"${nomeAntigo !== nome ? ` → "${nome}"` : ''}${contratosAtualizados ? ` (${contratosAtualizados} contrato(s) atualizado(s))` : ''}`,
        alteracoes
      );
    }
    saveState();
    cancelarEdicaoImovel();
    renderAll();
    showToast('Imóvel atualizado com sucesso.', 'success');
  } else {
    state.imoveis.push({ id: uuid(), nome, carteiraId });
    saveState();
    cancelarEdicaoImovel();
    renderImoveis();
    showToast('Imóvel adicionado com sucesso.', 'success');
  }
});

/* ===================== TELA: USUÁRIOS =====================
 * Tudo que é conta de acesso vive aqui — a própria conta, os outros
 * administradores e a chave que assina o cookie de login. Ficava escondido
 * dentro de Configurações, e conta de usuário não é "configuração do sistema".
 */
function renderUsuarios() {
  document.getElementById('accUsername').value = currentUsername;
  loadUsers();
}

const accountForm = document.getElementById('accountForm');

accountForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const newUsername = document.getElementById('accUsername').value.trim();
  const currentPassword = document.getElementById('accCurrentPassword').value;
  const newPassword = document.getElementById('accNewPassword').value;
  const confirmPassword = document.getElementById('accConfirmPassword').value;
  const errorEl = document.getElementById('accountError');
  errorEl.classList.add('hidden');

  if (newPassword && newPassword !== confirmPassword) {
    errorEl.textContent = 'A confirmação da nova senha não confere.';
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await apiFetch('account.php', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newUsername, newPassword }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      setCurrentUsername(data.username);
      document.getElementById('accUsername').value = data.username;
      document.getElementById('accCurrentPassword').value = '';
      document.getElementById('accNewPassword').value = '';
      document.getElementById('accConfirmPassword').value = '';
      const msg = document.getElementById('accountSaved');
      msg.classList.remove('hidden');
      setTimeout(() => msg.classList.add('hidden'), 2200);
      showToast('Dados de acesso atualizados com sucesso.', 'success');
      loadUsers();
    } else {
      errorEl.textContent = data.error || 'Não foi possível atualizar os dados de acesso.';
      errorEl.classList.remove('hidden');
    }
  } catch (err) {
    errorEl.textContent = 'Não foi possível conectar ao servidor.';
    errorEl.classList.remove('hidden');
  }
});

/* ===================== SEGURANÇA (regenerar COOKIE_SECRET) ===================== */
const regenerateSecretForm = document.getElementById('regenerateSecretForm');

regenerateSecretForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPassword = document.getElementById('secretCurrentPassword').value;
  const errorEl = document.getElementById('regenerateSecretError');
  errorEl.classList.add('hidden');

  if (!confirm('Gerar uma nova chave vai desconectar automaticamente todos os OUTROS usuários administradores que estiverem logados agora (eles precisam entrar de novo). Deseja continuar?')) return;

  try {
    const res = await apiFetch('regenerate_secret.php', {
      method: 'POST',
      body: JSON.stringify({ currentPassword }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      document.getElementById('secretCurrentPassword').value = '';
      const msg = document.getElementById('regenerateSecretSaved');
      msg.classList.remove('hidden');
      setTimeout(() => msg.classList.add('hidden'), 2200);
      registrarAuditoria('cookie_secret_regenerado', 'COOKIE_SECRET regenerado pelo administrador');
      saveState();
      showToast('Nova chave gerada com sucesso.', 'success');
    } else {
      errorEl.textContent = data.error || 'Não foi possível gerar a nova chave.';
      errorEl.classList.remove('hidden');
    }
  } catch (err) {
    errorEl.textContent = 'Não foi possível conectar ao servidor.';
    errorEl.classList.remove('hidden');
  }
});

/* ===================== USUÁRIOS ADMINISTRADORES ===================== */
const addUserForm = document.getElementById('addUserForm');

async function loadUsers() {
  try {
    const res = await apiFetch('users.php');
    const data = await res.json();
    if (res.ok && data.ok) renderUsers(data.users);
  } catch (err) {
    // lista de usuários não é crítica para o resto da tela — falha silenciosa
  }
}

function renderUsers(users) {
  const list = document.getElementById('usersList');
  list.innerHTML = users.map(u => `
    <div class="card">
      <div class="contrato-top">
        <div class="contrato-title">${escapeHtml(u.username)}${u.username === currentUsername ? ' (você)' : ''}</div>
        ${u.username !== currentUsername && users.length > 1 ? `<button type="button" class="btn btn-danger btn-sm" data-remove-user="${u.id}" data-remove-username="${escapeHtml(u.username)}">${icon('trash')} Remover</button>` : ''}
      </div>
    </div>
  `).join('');
  list.querySelectorAll('[data-remove-user]').forEach(btn => {
    btn.addEventListener('click', () => removeUser(btn.dataset.removeUser, btn.dataset.removeUsername));
  });
}

async function removeUser(id, username) {
  if (!confirm('Remover este usuário? Ele não vai mais conseguir fazer login no sistema.')) return;
  const currentPassword = prompt('Confirme sua senha atual para remover este usuário:');
  if (currentPassword === null) return;
  try {
    const res = await apiFetch('users.php', { method: 'POST', body: JSON.stringify({ action: 'remove', id, currentPassword }) });
    const data = await res.json();
    if (res.ok && data.ok) {
      registrarAuditoria('usuario_removido', `Usuário removido: ${username}`);
      saveState();
      showToast('Usuário removido.', 'success');
      loadUsers();
    } else {
      showToast(data.error || 'Não foi possível remover o usuário.', 'error');
    }
  } catch (err) {
    showToast('Não foi possível conectar ao servidor.', 'error');
  }
}

addUserForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('newUserUsername').value.trim();
  const password = document.getElementById('newUserPassword').value;
  const confirmPassword = document.getElementById('newUserConfirmPassword').value;
  const currentPassword = document.getElementById('newUserCurrentPassword').value;
  const errorEl = document.getElementById('addUserError');
  errorEl.classList.add('hidden');

  if (password !== confirmPassword) {
    errorEl.textContent = 'A confirmação da senha não confere.';
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await apiFetch('users.php', {
      method: 'POST',
      body: JSON.stringify({ action: 'add', username, password, currentPassword }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      addUserForm.reset();
      registrarAuditoria('usuario_adicionado', `Usuário adicionado: ${username}`);
      saveState();
      showToast('Usuário adicionado com sucesso.', 'success');
      loadUsers();
    } else {
      errorEl.textContent = data.error || 'Não foi possível adicionar o usuário.';
      errorEl.classList.remove('hidden');
    }
  } catch (err) {
    errorEl.textContent = 'Não foi possível conectar ao servidor.';
    errorEl.classList.remove('hidden');
  }
});

/* ===================== BACKUP COMPLETO DO BANCO DE DADOS ===================== */
document.getElementById('btnExportBackup').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup_aluguel_${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup exportado com sucesso.', 'success');
});

document.getElementById('btnImportBackup').addEventListener('click', () => {
  document.getElementById('inputImportBackup').click();
});

document.getElementById('inputImportBackup').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result));
    } catch (err) {
      showToast('Arquivo de backup inválido (não é um JSON válido).', 'error');
      return;
    }
    if (!parsed || !Array.isArray(parsed.contratos) || typeof parsed.config !== 'object') {
      showToast('Arquivo de backup inválido (formato inesperado).', 'error');
      return;
    }
    if (!confirm('Restaurar este backup vai substituir TODOS os dados atuais (contratos e configurações). Deseja continuar?')) return;

    state = parsed;
    if (precisaMigrarContratos(state.contratos)) {
      state.contratos = migrarContratos(state.contratos);
    }
    if (precisaMigrarNumerosContrato(state.contratos)) {
      state.contratos = migrarNumerosContrato(state.contratos);
    }
    state.pessoas = state.pessoas || state.corretores || [];
    delete state.corretores;
    state.despesas = state.despesas || [];
    state.imoveis = state.imoveis || [];
    state.carteiras = state.carteiras || [];
    state.auditoria = state.auditoria || [];
    state.config = Object.assign({}, CONFIG_PADRAO, state.config || {});
    state.config.recibo = Object.assign({}, RECIBO_PADRAO, state.config.recibo || {});
    reciboFormSujo = false; // o backup restaurado manda no formulário
    await saveState();
    renderAll();
    renderPessoasConfig();
    showToast('Backup restaurado com sucesso.', 'success');
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
});

/* ===================== ZONA DE PERIGO: EXCLUIR TODOS OS DADOS ===================== */
document.getElementById('btnDeleteDatabase').addEventListener('click', async () => {
  if (!confirm('Isso vai APAGAR PERMANENTEMENTE todos os contratos, pagamentos e configurações salvos no servidor. Esta ação não pode ser desfeita. Deseja continuar?')) return;
  const digitado = prompt('Para confirmar, digite EXCLUIR (em maiúsculas):');
  if (digitado !== 'EXCLUIR') {
    showToast('Exclusão cancelada.', 'error');
    return;
  }
  state = estadoVazio();
  definirCarteiraAtiva('', true);
  reciboFormSujo = false;
  await saveState();
  renderAll();
  showToast('Todos os dados foram excluídos.', 'success');
});

/* ===================== RECIBO DE PAGAMENTO =====================
 * Um recibo é sempre de UM pagamento (não da dívida inteira nem do contrato):
 * é o pagamento que tem data, valor e forma, que é o que um recibo declara.
 *
 * O texto vem inteiro de Configurações > Recibo. O sistema não guarda nenhum
 * dado do recibo: os valores entram na hora pelos códigos {{...}}, sempre lidos
 * do contrato/dívida/pagamento reais. Assim o texto salvo continua valendo
 * mesmo depois de reajuste, troca de inquilino, etc.
 */

const EXTENSO_UNIDADES = ['zero','um','dois','três','quatro','cinco','seis','sete','oito','nove','dez',
  'onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove'];
const EXTENSO_DEZENAS = ['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'];
const EXTENSO_CENTENAS = ['','cento','duzentos','trezentos','quatrocentos','quinhentos','seiscentos','setecentos','oitocentos','novecentos'];
const EXTENSO_ESCALAS = [null, ['mil','mil'], ['milhão','milhões'], ['bilhão','bilhões']];

function extensoAte999(n) {
  if (n === 100) return 'cem';
  const partes = [];
  const centena = Math.floor(n / 100);
  const resto = n % 100;
  if (centena) partes.push(EXTENSO_CENTENAS[centena]);
  if (resto < 20) {
    if (resto) partes.push(EXTENSO_UNIDADES[resto]);
  } else {
    const dezena = Math.floor(resto / 10);
    const unidade = resto % 10;
    partes.push(unidade ? `${EXTENSO_DEZENAS[dezena]} e ${EXTENSO_UNIDADES[unidade]}` : EXTENSO_DEZENAS[dezena]);
  }
  return partes.join(' e ');
}

function extensoInteiro(n) {
  if (n === 0) return 'zero';
  if (n >= 1e12) return String(n); // fora da escala tratada aqui

  const grupos = [];
  let resto = n;
  let escala = 0;
  while (resto > 0) {
    grupos.push({ valor: resto % 1000, escala });
    resto = Math.floor(resto / 1000);
    escala++;
  }

  const partes = [];
  let ultimoValor = 0;
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (!g.valor) continue;
    // "mil" e não "um mil"
    let texto = (g.escala === 1 && g.valor === 1) ? '' : extensoAte999(g.valor);
    if (g.escala > 0) {
      const nome = EXTENSO_ESCALAS[g.escala];
      texto = (texto ? texto + ' ' : '') + (g.valor === 1 ? nome[0] : nome[1]);
    }
    partes.push(texto);
    ultimoValor = g.valor;
  }

  if (partes.length === 1) return partes[0];
  // "mil e duzentos" / "mil e cinquenta", mas "mil duzentos e cinquenta"
  const conector = (ultimoValor < 100 || ultimoValor % 100 === 0) ? ' e ' : ' ';
  return partes.slice(0, -1).join(', ') + conector + partes[partes.length - 1];
}

// "1.250,50" → "mil duzentos e cinquenta reais e cinquenta centavos"
function valorPorExtenso(valor) {
  const centavosTotais = Math.round((Number(valor) || 0) * 100);
  const reais = Math.floor(centavosTotais / 100);
  const centavos = centavosTotais % 100;
  const partes = [];
  if (reais) {
    const texto = extensoInteiro(reais);
    // "um milhão DE reais", mas "dois milhões e quinhentos mil reais" — o "de"
    // só entra quando o número termina exatamente na escala
    const de = /(milhão|milhões|bilhão|bilhões)$/.test(texto) ? 'de ' : '';
    partes.push(`${texto} ${de}${reais === 1 ? 'real' : 'reais'}`);
  }
  if (centavos) partes.push(`${extensoInteiro(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
  if (!partes.length) return 'zero real';
  return partes.join(' e ');
}

function dataPorExtenso(dateStr) {
  if (!dateStr) return '';
  const d = parseDate(dateStr);
  return `${d.getDate()} de ${MESES_PT[d.getMonth()].toLowerCase()} de ${d.getFullYear()}`;
}

function mesReferencia(dateStr) {
  if (!dateStr) return '';
  const d = parseDate(dateStr);
  return `${MESES_PT[d.getMonth()]}/${d.getFullYear()}`;
}

// Número do recibo: nº do contrato + competência da dívida (+ sequência, se a
// mesma dívida tiver mais de um pagamento). É sempre o mesmo para o mesmo
// pagamento — reimprimir não gera um número novo.
function numeroRecibo(c, d, indice) {
  const venc = parseDate(d.vencimento);
  const competencia = `${venc.getFullYear()}${String(venc.getMonth() + 1).padStart(2, '0')}`;
  return `${String(c.numero || 0).padStart(3, '0')}/${competencia}${indice > 0 ? `-${indice + 1}` : ''}`;
}

// Catálogo dos códigos, na ordem em que aparecem na tela de Configurações.
// Toda chave listada aqui é produzida por dadosRecibo() logo abaixo.
const CODIGOS_RECIBO = [
  { grupo: 'Dados do recibo', itens: [
    ['recibo_numero', 'Número do recibo, gerado pelo sistema'],
    ['data_hoje', 'Data de hoje (dia em que o recibo foi gerado)'],
    ['data_extenso', 'Data de hoje por extenso'],
    ['cidade', 'Cidade preenchida no campo acima'],
    ['cidade_data', 'Cidade + data de hoje por extenso'],
  ]},
  { grupo: 'Contrato', itens: [
    ['contrato_numero', 'Número do contrato (#12, por exemplo)'],
    ['imovel', 'Descrição do imóvel'],
    ['inquilino', 'Nome do inquilino'],
    ['proprietario', 'Proprietário da carteira do contrato'],
    ['proprietario_documento', 'CPF / CNPJ do proprietário'],
    ['carteira', 'Nome da carteira do contrato'],
    ['corretor', 'Nome do corretor do contrato'],
    ['corretor_percentual', 'Percentual do corretor'],
    ['corretor_valor', 'Valor da comissão do corretor no mês'],
    ['data_inicio', 'Data de início do contrato'],
    ['dia_pagamento', 'Dia de pagamento combinado no contrato'],
  ]},
  { grupo: 'Dívida do mês', itens: [
    ['vencimento', 'Data de vencimento da dívida'],
    ['mes_referencia', 'Competência (mês/ano do vencimento)'],
    ['aluguel', 'Valor do aluguel'],
    ['condominio', 'Condomínio recebido junto neste pagamento (0 se não veio)'],
    ['juros', 'Juros lançados na dívida'],
    ['multa', 'Multa lançada na dívida'],
    ['desconto_divida', 'Desconto lançado na dívida'],
    ['total_divida', 'Total da dívida do mês'],
    ['dias_atraso', 'Dias em atraso na data do pagamento'],
  ]},
  { grupo: 'Pagamento', itens: [
    ['valor_pago', 'Valor efetivamente pago'],
    ['valor_extenso', 'Valor pago escrito por extenso'],
    ['valor_liquido', 'Valor pago menos corretor e condomínio'],
    ['data_pagamento', 'Data em que o pagamento foi feito'],
    ['data_pagamento_extenso', 'Data do pagamento por extenso'],
    ['forma_pagamento', 'Dinheiro ou Pix'],
    ['quem_recebeu', 'Quem recebeu o pagamento'],
    ['desconto', 'Desconto concedido neste pagamento'],
    ['motivo_desconto', 'Motivo do desconto'],
    ['observacao', 'Observação registrada no pagamento'],
  ]},
];

function dadosRecibo(c, d, p, indice) {
  const carteira = carteiraPorId(c.carteiraId) || {};
  const cidade = (state.config.recibo && state.config.recibo.cidade) || '';
  const comissao = comissaoCorretor(c, d);
  // dias de atraso na DATA DO PAGAMENTO (não hoje): um recibo reimpresso meses
  // depois precisa continuar dizendo o que valia quando o pagamento foi feito
  const diasAtrasoNoPagamento = Math.max(0, Math.round(
    (parseDate(p.data) - parseDate(d.vencimento)) / (1000 * 60 * 60 * 24)
  ));

  return {
    recibo_numero: numeroRecibo(c, d, indice),
    data_hoje: formatDate(todayStr()),
    data_extenso: dataPorExtenso(todayStr()),
    cidade,
    cidade_data: (cidade ? `${cidade}, ` : '') + dataPorExtenso(todayStr()),

    contrato_numero: `#${c.numero || '--'}`,
    imovel: c.imovel || '',
    inquilino: c.inquilino || '',
    proprietario: carteira.proprietario || '',
    proprietario_documento: carteira.documento || '',
    carteira: carteira.nome || '',
    corretor: c.corretorNome || '',
    corretor_percentual: c.corretorNome ? `${c.corretorPercentual || 0}%` : '',
    corretor_valor: c.corretorNome ? formatCurrency(comissao) : '',
    data_inicio: c.dataInicio ? formatDate(c.dataInicio) : '',
    dia_pagamento: c.diaPagamento ? String(c.diaPagamento) : '',

    vencimento: formatDate(d.vencimento),
    mes_referencia: mesReferencia(d.vencimento),
    aluguel: formatCurrency(d.aluguel || 0),
    condominio: formatCurrency(condominioNoPagamento(d, p)),
    juros: formatCurrency(d.juros || 0),
    multa: formatCurrency(d.multa || 0),
    desconto_divida: formatCurrency(d.desconto || 0),
    total_divida: formatCurrency(d.total || 0),
    dias_atraso: String(diasAtrasoNoPagamento),

    valor_pago: formatCurrency(p.valor || 0),
    valor_extenso: valorPorExtenso(p.valor || 0),
    valor_liquido: formatCurrency(valorLiquidoPagamento(c, d, p)),
    data_pagamento: formatDate(p.data),
    data_pagamento_extenso: dataPorExtenso(p.data),
    forma_pagamento: p.forma || '',
    quem_recebeu: p.quemRecebeu || c.quemRecebeu || '',
    desconto: formatCurrency(p.desconto || 0),
    motivo_desconto: p.motivoDesconto || '',
    observacao: p.observacao || '',
  };
}

// Troca {{codigo}} pelo valor correspondente. Um código desconhecido vira texto
// vazio (em vez de sair escrito "{{xyz}}" no recibo impresso).
function aplicarTemplateRecibo(texto, dados) {
  return String(texto || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, chave) => {
    const valor = dados[chave.toLowerCase()];
    return valor === undefined || valor === null ? '' : String(valor);
  });
}

// Contrato/dívida/pagamento de mentira, usados só para a prévia e para a coluna
// de exemplos da tela de Configurações quando ainda não há pagamento nenhum.
function exemploRecibo() {
  const contrato = {
    numero: 1, imovel: 'Apartamento 302 - Rua das Flores, 123', inquilino: 'Maria Silva',
    quemRecebeu: 'João Souza', corretorNome: '', corretorPercentual: 0, carteiraId: '',
    dataInicio: todayStr(), diaPagamento: 5,
  };
  const divida = {
    vencimento: todayStr(), aluguel: 1250, desconto: 0, juros: 0, multa: 0,
    condominio: 0, total: 1250,
  };
  const pagamento = { data: todayStr(), valor: 1250, desconto: 0, forma: 'Pix', quemRecebeu: 'João Souza', observacao: '' };
  return { contrato, divida, pagamento, indice: 0 };
}

// Pagamento mais recente do sistema (o melhor exemplo possível: dados reais);
// cai para o exemplo fictício se ainda não houver nenhum pagamento.
function pagamentoParaPrevia() {
  const entradas = [];
  state.contratos.forEach(c => c.dividas.forEach(d => (d.pagamentos || []).forEach((p, indice) => {
    entradas.push({ contrato: c, divida: d, pagamento: p, indice });
  })));
  if (!entradas.length) return exemploRecibo();
  entradas.sort((a, b) => parseDate(b.pagamento.data) - parseDate(a.pagamento.data));
  return entradas[0];
}

/* ---------- Impressão (a única porta de saída para PDF) ----------
 * Tudo que vira PDF aqui é HTML impresso pelo navegador ("Salvar como PDF"),
 * nunca imagem: o texto sai nítido, selecionável, pesquisável e quebra em
 * páginas sozinho — foi o que motivou aposentar o antigo relatório em canvas,
 * que saía como uma imagem esticada e ilegível.
 *
 * `corpo` e `estilo` são montados aqui dentro do sistema; texto vindo do
 * usuário precisa entrar já escapado (escapeHtml) por quem chama.
 */
function abrirJanelaImpressao(titulo, estilo, corpo) {
  const janela = window.open('', '_blank');
  if (!janela) {
    showToast('O navegador bloqueou a janela de impressão. Libere os pop-ups deste site e tente de novo.', 'error');
    return false;
  }
  janela.document.write(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>${escapeHtml(titulo)}</title>
<style>${estilo}</style></head>
<body onload="window.print()">${corpo}</body></html>`);
  janela.document.close();
  return true;
}

const ESTILO_RECIBO = `
  @page { size: A4; margin: 20mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: #f1f1f4; color: #111;
         font-family: 'Times New Roman', Times, Georgia, serif; }
  .folha { max-width: 190mm; margin: 0 auto; background: #fff; padding: 20mm;
           box-shadow: 0 2px 16px rgba(0,0,0,.12); }
  h1 { font-size: 20pt; text-align: center; margin: 0 0 28px; letter-spacing: .04em; }
  .corpo, .rodape { font-size: 12pt; line-height: 1.7; white-space: pre-wrap; }
  .rodape { margin-top: 48px; text-align: center; }
  @media print {
    body { background: #fff; padding: 0; }
    .folha { box-shadow: none; padding: 0; max-width: none; }
  }
`;

function abrirJanelaRecibo(titulo, corpo, rodape) {
  return abrirJanelaImpressao(titulo || 'Recibo', ESTILO_RECIBO, `
  <div class="folha">
    <h1>${escapeHtml(titulo)}</h1>
    <div class="corpo">${escapeHtml(corpo)}</div>
    <div class="rodape">${escapeHtml(rodape)}</div>
  </div>`);
}

function gerarRecibo(contrato, divida, pagamento, indice) {
  const cfg = Object.assign({}, RECIBO_PADRAO, state.config.recibo || {});
  const dados = dadosRecibo(contrato, divida, pagamento, indice);
  const ok = abrirJanelaRecibo(
    aplicarTemplateRecibo(cfg.titulo, dados),
    aplicarTemplateRecibo(cfg.corpo, dados),
    aplicarTemplateRecibo(cfg.rodape, dados)
  );
  if (ok) showToast('Recibo gerado. Use "Salvar como PDF" na janela de impressão.', 'success');
}

// Recibo a partir de um par (dívida, índice do pagamento) — é assim que os
// botões espalhados pelo sistema chamam a geração.
function abrirRecibo(dividaId, indice) {
  const achado = encontrarDivida(dividaId);
  if (!achado) return;
  const { contrato: c, divida: d } = achado;
  const pagamentos = d.pagamentos || [];
  // sem índice informado (botão na linha da dívida), usa o pagamento mais recente
  const i = indice === undefined || indice === null || indice < 0
    ? pagamentos.length - 1
    : Number(indice);
  const p = pagamentos[i];
  if (!p) { showToast('Esta dívida ainda não tem pagamento registrado.', 'error'); return; }
  gerarRecibo(c, d, p, i);
}

/* ---------- Configurações > Recibo ---------- */

// Guarda em qual campo o cursor estava, para os botões de código inserirem o
// texto no lugar certo (senão não haveria como saber onde colar).
let campoReciboFocado = null;

// O texto do recibo é longo: se o usuário tiver mexido nele sem salvar, um
// renderAll() disparado por outra ação (adicionar uma carteira, por exemplo)
// não pode reescrever os campos por cima e apagar o que ele digitou.
let reciboFormSujo = false;

['reciboTitulo', 'reciboCorpo', 'reciboRodape'].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener('focus', () => { campoReciboFocado = el; });
});

['reciboTitulo', 'reciboCidade', 'reciboCorpo', 'reciboRodape'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => { reciboFormSujo = true; });
});

function inserirCodigoRecibo(codigo) {
  const campo = campoReciboFocado || document.getElementById('reciboCorpo');
  const texto = `{{${codigo}}}`;
  const inicio = campo.selectionStart === null ? campo.value.length : campo.selectionStart;
  const fim = campo.selectionEnd === null ? campo.value.length : campo.selectionEnd;
  campo.value = campo.value.slice(0, inicio) + texto + campo.value.slice(fim);
  campo.focus();
  campo.setSelectionRange(inicio + texto.length, inicio + texto.length);
  campoReciboFocado = campo;
  reciboFormSujo = true;
}

function renderCodigosRecibo() {
  const alvo = document.getElementById('reciboCodigos');
  const { contrato, divida, pagamento, indice } = pagamentoParaPrevia();
  const exemplos = dadosRecibo(contrato, divida, pagamento, indice);

  alvo.innerHTML = CODIGOS_RECIBO.map(g => `
    <div class="codigo-grupo">
      <h4>${escapeHtml(g.grupo)}</h4>
      <div class="codigo-lista">
        ${g.itens.map(([codigo, descricao]) => `
          <button type="button" class="codigo-item" data-codigo="${codigo}" title="Clique para inserir {{${codigo}}} no texto">
            <code>{{${codigo}}}</code>
            <span class="codigo-desc">${escapeHtml(descricao)}</span>
            <span class="codigo-exemplo">${escapeHtml(exemplos[codigo] || '—')}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `).join('');

  alvo.querySelectorAll('[data-codigo]').forEach(btn => {
    btn.addEventListener('click', () => inserirCodigoRecibo(btn.dataset.codigo));
  });
}

function renderReciboConfig() {
  // com edição não salva em andamento, só atualiza a coluna de exemplos
  if (reciboFormSujo) { renderCodigosRecibo(); return; }
  const cfg = Object.assign({}, RECIBO_PADRAO, state.config.recibo || {});
  document.getElementById('reciboTitulo').value = cfg.titulo;
  document.getElementById('reciboCidade').value = cfg.cidade;
  document.getElementById('reciboCorpo').value = cfg.corpo;
  document.getElementById('reciboRodape').value = cfg.rodape;
  renderCodigosRecibo();
}

function lerFormularioRecibo() {
  return {
    titulo: document.getElementById('reciboTitulo').value,
    cidade: document.getElementById('reciboCidade').value.trim(),
    corpo: document.getElementById('reciboCorpo').value,
    rodape: document.getElementById('reciboRodape').value,
  };
}

document.getElementById('formRecibo').addEventListener('submit', (e) => {
  e.preventDefault();
  state.config.recibo = lerFormularioRecibo();
  reciboFormSujo = false;
  saveState();
  const msg = document.getElementById('reciboSaved');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2200);
  renderCodigosRecibo();
  showToast('Texto do recibo salvo com sucesso.', 'success');
});

// A prévia usa o que está NO FORMULÁRIO (mesmo sem salvar), para dar para
// experimentar o texto antes de gravar.
document.getElementById('btnPreviaRecibo').addEventListener('click', () => {
  const cfg = lerFormularioRecibo();
  const { contrato, divida, pagamento, indice } = pagamentoParaPrevia();
  const dados = dadosRecibo(contrato, divida, pagamento, indice);
  // a cidade da prévia é a que está sendo digitada, não a que está salva
  dados.cidade = cfg.cidade;
  dados.cidade_data = (cfg.cidade ? `${cfg.cidade}, ` : '') + dataPorExtenso(todayStr());
  abrirJanelaRecibo(
    aplicarTemplateRecibo(cfg.titulo, dados),
    aplicarTemplateRecibo(cfg.corpo, dados),
    aplicarTemplateRecibo(cfg.rodape, dados)
  );
});

document.getElementById('btnRestaurarRecibo').addEventListener('click', () => {
  if (!confirm('Restaurar o texto padrão do recibo? O texto atual será substituído (a cidade é mantida).')) return;
  const cidade = document.getElementById('reciboCidade').value;
  document.getElementById('reciboTitulo').value = RECIBO_PADRAO.titulo;
  document.getElementById('reciboCorpo').value = RECIBO_PADRAO.corpo;
  document.getElementById('reciboRodape').value = RECIBO_PADRAO.rodape;
  document.getElementById('reciboCidade').value = cidade;
  reciboFormSujo = true; // ainda não foi salvo
  showToast('Texto padrão restaurado. Clique em "Salvar texto do recibo" para gravar.', 'success');
});

/* ===================== CHARTS (canvas nativo) =====================
 * Nenhuma biblioteca: tudo desenhado à mão no <canvas>. As cores vêm das
 * variáveis do CSS (cssVar), então os gráficos acompanham o tema claro/escuro
 * automaticamente; o canvas, porém, não lê font-size do CSS, então os tamanhos
 * e a família de fonte ficam centralizados aqui, espelhando o design system.
 */
const CHART_FONT_FAMILY = "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const CHART_FONT = '12px ' + CHART_FONT_FAMILY;
const CHART_FONT_SM = '11px ' + CHART_FONT_FAMILY;
const CHART_FONT_BOLD = '600 12px ' + CHART_FONT_FAMILY;
const CHART_FONT_LG_BOLD = '700 24px ' + CHART_FONT_FAMILY;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Os 12 meses do ano escolhido no filtro da aba Gráficos.
function mesesDoAno(ano) {
  return MESES_PT.map((nome, i) => ({ year: ano, month: i, label: nome.slice(0, 3) }));
}

// Ano selecionado na aba Gráficos (padrão: ano atual).
function anoGraficoSelecionado() {
  const select = document.getElementById('graficoAno');
  return Number(select && select.value) || new Date().getFullYear();
}

function populateGraficoAnoFilter() {
  const select = document.getElementById('graficoAno');
  if (!select) return;
  const dividas = todasDividas();
  const anos = new Set(dividas.map(d => parseDate(d.vencimento).getFullYear()));
  dividas.forEach(d => d.pagamentos.forEach(p => anos.add(parseDate(p.data).getFullYear())));
  despesasVisiveis().forEach(d => anos.add(parseDate(d.data).getFullYear()));
  anos.add(new Date().getFullYear());
  const sorted = Array.from(anos).sort((a, b) => b - a);
  const current = select.value;
  select.innerHTML = sorted.map(a => `<option value="${a}">${a}</option>`).join('');
  select.value = sorted.map(String).includes(current) ? current : String(new Date().getFullYear());
}

// Prepara o canvas para desenhar: ajusta a resolução real ao devicePixelRatio
// (sem isso os gráficos ficam borrados em telas retina) e devolve o contexto já
// escalado, junto das dimensões LÓGICAS usadas para posicionar tudo.
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  // A altura lógica vem do atributo `height` do HTML; como passamos a
  // sobrescrever esse atributo com a resolução física, ela é memorizada.
  if (!canvas.dataset.alturaLogica) canvas.dataset.alturaLogica = String(canvas.height || 220);
  const h = Number(canvas.dataset.alturaLogica);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

// Corta um texto com "…" para caber numa largura do canvas (o canvas não tem
// text-overflow: ellipsis). Usado nos rótulos do gráfico de inadimplência.
function truncateText(ctx, text, maxWidth) {
  text = text || '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 0 && ctx.measureText(text + '…').width > maxWidth) {
    text = text.slice(0, -1);
  }
  return text + '…';
}

function drawChartEmptyState(ctx, w, h, texto) {
  ctx.fillStyle = cssVar('--text-faint');
  ctx.font = CHART_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(texto, w / 2, h / 2);
}

// Retângulo com cantos arredondados, com queda para o retângulo comum em
// navegadores sem `roundRect`.
// `r` pode ser um número (todos os cantos) ou uma lista no formato do roundRect
// nativo ([sup-esq, sup-dir, inf-dir, inf-esq]) — usada nas colunas, que só
// arredondam em cima para assentarem na linha de base.
function pathRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    const limite = Math.min(Math.abs(w) / 2, Math.abs(h) / 2);
    const raio = Array.isArray(r)
      ? r.map(v => Math.max(0, Math.min(v, limite)))
      : Math.max(0, Math.min(r, limite));
    ctx.roundRect(x, y, w, h, raio);
  } else {
    ctx.rect(x, y, w, h);
  }
}

// Escolhe um "passo" redondo (1, 2, 5, 10, 20, 50...) para as linhas de grade,
// para o eixo não ficar com números quebrados tipo 3.271,40.
function passoRedondo(bruto) {
  if (!(bruto > 0)) return 1;
  const expoente = Math.pow(10, Math.floor(Math.log10(bruto)));
  const n = bruto / expoente;
  const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return mult * expoente;
}

// Valores curtos para caber no eixo: 12500 -> "12,5 mil".
function formatCompacto(v) {
  const abs = Math.abs(v);
  if (abs >= 1000000) return (v / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mi';
  if (abs >= 1000) return (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

// Caixinha que aparece ao passar o mouse sobre um ponto/barra. `linhas` é uma
// lista de { valor, cor } — mais de uma quando o gráfico tem várias séries.
function drawChartTooltip(ctx, w, x, y, titulo, linhas) {
  ctx.textBaseline = 'middle';
  ctx.font = CHART_FONT_SM;
  let larguraTexto = ctx.measureText(titulo).width;
  ctx.font = CHART_FONT_BOLD;
  linhas.forEach(l => {
    larguraTexto = Math.max(larguraTexto, ctx.measureText(l.valor).width + (l.cor ? 16 : 0));
  });

  const cx = larguraTexto + 24;
  const cy = 24 + linhas.length * 17;
  const bx = Math.max(4, Math.min(x - cx / 2, w - cx - 4));
  const by = Math.max(4, y - cy - 14);

  ctx.fillStyle = cssVar('--surface-3');
  ctx.strokeStyle = cssVar('--border-strong');
  ctx.lineWidth = 1;
  pathRoundedRect(ctx, bx, by, cx, cy, 8);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = cssVar('--text-faint');
  ctx.font = CHART_FONT_SM;
  ctx.fillText(titulo, bx + 12, by + 13);

  linhas.forEach((l, i) => {
    const ly = by + 30 + i * 17;
    let tx = bx + 12;
    if (l.cor) {
      ctx.fillStyle = l.cor;
      ctx.beginPath();
      ctx.arc(bx + 16, ly, 3.5, 0, Math.PI * 2);
      ctx.fill();
      tx = bx + 26;
    }
    ctx.fillStyle = cssVar('--text');
    ctx.font = CHART_FONT_BOLD;
    ctx.fillText(l.valor, tx, ly);
  });
}

function renderCharts() {
  populateGraficoAnoFilter();
  const ano = anoGraficoSelecionado();
  renderStatusChart(ano);
  renderFormaPagamentoChart(ano);
  renderReceitaMensalChart(ano);
  renderAtrasoEvolucaoChart(ano);
  renderDespesasMensalChart(ano);
  renderInadimplenciaChart(ano);
}

/* ---- Donut chart genérico (legenda renderizada em HTML ao lado) ----
 * Desenhado como um arco grosso (stroke) em vez de fatias de pizza recortadas:
 * permite um respiro entre as fatias e pontas arredondadas, sem depender do
 * truque de `destination-out` para furar o meio.
 */
function renderDonutChart(canvasId, legendId, data, centerValue, centerLabel) {
  const canvas = document.getElementById(canvasId);
  const legendEl = document.getElementById(legendId);
  const { ctx, w, h } = setupCanvas(canvas);

  const positivos = data.filter(d => d.value > 0);
  const total = positivos.reduce((sum, d) => sum + d.value, 0);
  if (total <= 0) {
    drawChartEmptyState(ctx, w, h, 'Sem dados neste ano');
    legendEl.innerHTML = '';
    return;
  }

  const cx = w / 2;
  const cy = h / 2;
  const espessura = Math.max(14, Math.min(30, Math.min(w, h) * 0.13));
  const raio = Math.min(w, h) / 2 - espessura / 2 - 6;
  const vao = positivos.length > 1 ? 0.03 : 0; // respiro entre as fatias, em radianos

  // trilho de fundo
  ctx.beginPath();
  ctx.arc(cx, cy, raio, 0, Math.PI * 2);
  ctx.strokeStyle = cssVar('--surface-3');
  ctx.lineWidth = espessura;
  ctx.stroke();

  let angulo = -Math.PI / 2;
  positivos.forEach(d => {
    const fatia = (d.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, raio, angulo + vao / 2, angulo + fatia - vao / 2);
    ctx.strokeStyle = d.color;
    ctx.lineWidth = espessura;
    ctx.lineCap = 'butt';
    ctx.stroke();
    angulo += fatia;
  });

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = cssVar('--text');
  ctx.font = CHART_FONT_LG_BOLD;
  ctx.fillText(centerValue, cx, cy - 6);
  ctx.fillStyle = cssVar('--text-faint');
  ctx.font = CHART_FONT_SM;
  ctx.fillText(centerLabel, cx, cy + 16);

  legendEl.innerHTML = data.map(d => `
    <div class="chart-legend-item">
      <span class="chart-legend-dot" style="background:${d.color}"></span>
      <span>${escapeHtml(d.label)}: <strong>${d.displayValue}</strong></span>
    </div>
  `).join('');
}

function renderStatusChart(ano) {
  const dividas = todasDividas().filter(d => parseDate(d.vencimento).getFullYear() === ano);
  const counts = { ativo: 0, atrasado: 0, pago: 0 };
  dividas.forEach(d => counts[getStatus(d)]++);
  const total = counts.ativo + counts.atrasado + counts.pago;

  const data = [
    { label: 'Ativas', value: counts.ativo, color: cssVar('--accent'), displayValue: String(counts.ativo) },
    { label: 'Atrasadas', value: counts.atrasado, color: cssVar('--danger'), displayValue: String(counts.atrasado) },
    { label: 'Pagas', value: counts.pago, color: cssVar('--success'), displayValue: String(counts.pago) },
  ];
  renderDonutChart('chartStatus', 'legendStatus', data, String(total), total === 1 ? 'dívida' : 'dívidas');
}

function renderFormaPagamentoChart(ano) {
  const totais = {};
  todasDividas().forEach(d => d.pagamentos.forEach(p => {
    if (parseDate(p.data).getFullYear() !== ano) return;
    const forma = p.forma || 'Não informado';
    totais[forma] = (totais[forma] || 0) + valorLiquidoPagamento(d, d, p);
  }));

  const palette = [cssVar('--success'), cssVar('--accent'), cssVar('--warn'), cssVar('--danger')];
  const data = Object.keys(totais).map((forma, i) => ({
    label: forma,
    value: totais[forma],
    color: palette[i % palette.length],
    displayValue: formatCurrency(totais[forma]),
  }));
  const totalGeral = data.reduce((sum, d) => sum + d.value, 0);
  renderDonutChart('chartFormaPagamento', 'legendFormaPagamento', data, formatCompacto(totalGeral), 'recebido no ano');
}

/* ---- Gráfico de linhas genérico (uma ou mais séries) ----
 * `series` é uma lista de { label, values, colorVar }. Desenha grade e eixo Y
 * com valores redondos, área com degradê sob cada linha e, ao passar o mouse,
 * uma guia vertical com os valores daquele mês. Os rótulos dos meses das pontas
 * são alinhados para dentro, para nunca ficarem cortados na borda do canvas.
 */
function renderLineChart(canvasId, months, series, legendId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  function desenhar(hoverIdx) {
    const { ctx, w, h } = setupCanvas(canvas);
    const cores = series.map(s => cssVar(s.colorVar));
    const eixoColor = cssVar('--text-faint');
    const gridColor = cssVar('--border-subtle');

    const maxValor = series.reduce((m, s) => Math.max(m, ...s.values), 0);
    const linhas = 4;
    const passo = passoRedondo(maxValor / linhas);
    const topo = passo * linhas;

    ctx.font = CHART_FONT_SM;
    ctx.textBaseline = 'middle';
    let padLeft = 0;
    for (let i = 0; i <= linhas; i++) {
      padLeft = Math.max(padLeft, ctx.measureText(formatCompacto(topo - passo * i)).width);
    }
    padLeft += 16;
    const padRight = 12;
    const padTop = 16;
    const padBottom = 26;
    const chartW = Math.max(10, w - padLeft - padRight);
    const chartH = Math.max(10, h - padTop - padBottom);

    for (let i = 0; i <= linhas; i++) {
      const y = Math.round(padTop + (chartH / linhas) * i) + 0.5;
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(w - padRight, y);
      ctx.stroke();
      ctx.fillStyle = eixoColor;
      ctx.textAlign = 'right';
      ctx.fillText(formatCompacto(topo - passo * i), padLeft - 8, y);
    }

    const stepX = months.length > 1 ? chartW / (months.length - 1) : 0;
    const pontos = series.map(s => s.values.map((v, i) => ({
      x: padLeft + stepX * i,
      y: padTop + chartH - (topo > 0 ? (v / topo) * chartH : 0),
      v,
    })));

    if (hoverIdx != null && pontos[0] && pontos[0][hoverIdx]) {
      const x = pontos[0][hoverIdx].x;
      ctx.strokeStyle = cssVar('--border-strong');
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + chartH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    series.forEach((s, si) => {
      const pts = pontos[si];
      const cor = cores[si];
      if (!pts.length) return;

      const degrade = ctx.createLinearGradient(0, padTop, 0, padTop + chartH);
      degrade.addColorStop(0, cor + '3d');
      degrade.addColorStop(1, cor + '00');
      ctx.beginPath();
      ctx.moveTo(pts[0].x, padTop + chartH);
      pts.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(pts[pts.length - 1].x, padTop + chartH);
      ctx.closePath();
      ctx.fillStyle = degrade;
      ctx.fill();

      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.strokeStyle = cor;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      pts.forEach((p, i) => {
        const destaque = i === hoverIdx;
        ctx.beginPath();
        ctx.arc(p.x, p.y, destaque ? 4.5 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = destaque ? cor : cssVar('--bg-card');
        ctx.strokeStyle = cor;
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
      });
    });

    ctx.font = CHART_FONT_SM;
    ctx.fillStyle = eixoColor;
    const cabemTodos = stepX >= 24;
    months.forEach((m, i) => {
      if (!cabemTodos && i % 2 !== 0 && i !== months.length - 1) return;
      const x = padLeft + stepX * i;
      ctx.textAlign = i === 0 ? 'left' : i === months.length - 1 ? 'right' : 'center';
      ctx.fillText(m.label, x, h - 12);
    });

    if (hoverIdx != null && pontos[0] && pontos[0][hoverIdx]) {
      const alvoY = Math.min(...pontos.map(p => p[hoverIdx].y));
      drawChartTooltip(
        ctx, w, pontos[0][hoverIdx].x, alvoY,
        months[hoverIdx].label,
        series.map((s, si) => ({ valor: formatCurrency(s.values[hoverIdx]), cor: series.length > 1 ? cores[si] : null }))
      );
    }

    canvas.__geo = { padLeft, stepX, n: months.length };
  }

  // `onmousemove` (propriedade, não addEventListener) para não empilhar
  // handlers a cada re-render do gráfico.
  canvas.onmousemove = (e) => {
    const geo = canvas.__geo;
    if (!geo || geo.n < 2) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let idx = Math.round((x - geo.padLeft) / geo.stepX);
    idx = Math.max(0, Math.min(idx, geo.n - 1));
    if (canvas.__hover !== idx) {
      canvas.__hover = idx;
      desenhar(idx);
    }
  };
  canvas.onmouseleave = () => {
    if (canvas.__hover == null) return;
    canvas.__hover = null;
    desenhar(null);
  };

  canvas.__hover = null;
  desenhar(null);

  if (legendId) {
    const legendEl = document.getElementById(legendId);
    if (legendEl) {
      legendEl.innerHTML = series.map((s, i) => `
        <div class="chart-legend-item">
          <span class="chart-legend-dot" style="background:${cssVar(s.colorVar)}"></span>
          <span>${escapeHtml(s.label)}: <strong>${formatCurrency(s.values.reduce((a, b) => a + b, 0))}</strong></span>
        </div>
      `).join('');
    }
  }
}

// Atalho para os gráficos de uma série só.
function renderTrendChart(canvasId, months, values, colorVarName, label) {
  renderLineChart(canvasId, months, [{ label: label || '', values, colorVar: colorVarName }]);
}

// Total em atraso mês a mês (aluguel + juros/multa acumulados), pelo vencimento.
function atrasoPorMes(months) {
  const dividas = todasDividas();
  return months.map(m => dividas.reduce((sum, d) => {
    const venc = parseDate(d.vencimento);
    if (venc.getFullYear() === m.year && venc.getMonth() === m.month && getStatus(d) === 'atrasado') {
      return sum + d.total + calcAtrasoAtual(d);
    }
    return sum;
  }, 0));
}

// Valores líquidos (já descontando corretor e condomínio), mesma convenção usada em
// Relatórios — o que efetivamente fica com o proprietário, não o valor bruto cobrado.
function receitaLiquidaPorMes(months) {
  const dividas = todasDividas();
  return months.map(m => dividas.reduce((sum, d) => {
    const pagoNoMes = d.pagamentos
      .filter(p => {
        const dt = parseDate(p.data);
        return dt.getFullYear() === m.year && dt.getMonth() === m.month;
      })
      .reduce((s, p) => s + valorLiquidoPagamento(d, d, p), 0);
    return sum + pagoNoMes;
  }, 0));
}

function despesasPorMes(months) {
  return months.map(m => despesasVisiveis().reduce((sum, d) => {
    const dt = parseDate(d.data);
    return (dt.getFullYear() === m.year && dt.getMonth() === m.month) ? sum + d.valor : sum;
  }, 0));
}

function renderAtrasoEvolucaoChart(ano) {
  const months = mesesDoAno(ano);
  renderTrendChart('chartAtrasoEvolucao', months, atrasoPorMes(months), '--danger');
}

// Receita e despesa no mesmo gráfico: é a comparação que interessa de fato
// (quanto entrou x quanto saiu em cada mês do ano).
function renderReceitaMensalChart(ano) {
  const months = mesesDoAno(ano);
  renderLineChart('chartReceitaMensal', months, [
    { label: 'Recebido (líquido)', values: receitaLiquidaPorMes(months), colorVar: '--success' },
    { label: 'Despesas', values: despesasPorMes(months), colorVar: '--warn' },
  ], 'legendReceitaMensal');
}

function renderDespesasMensalChart(ano) {
  const months = mesesDoAno(ano);
  renderTrendChart('chartDespesasMensal', months, despesasPorMes(months), '--warn');
}

/* ---- Barras horizontais genérico (ranking, ex: quem mais atrasa) ---- */
function renderHorizontalBarChart(canvasId, entries, colorVarName) {
  const canvas = document.getElementById(canvasId);
  const { ctx, w, h } = setupCanvas(canvas);
  const color = cssVar(colorVarName);

  if (!entries.length) {
    drawChartEmptyState(ctx, w, h, 'Nenhuma dívida em atraso neste ano');
    return;
  }

  const max = Math.max(...entries.map(en => en.value));
  const padTop = 6;
  const vao = 12;
  const larguraRotulo = Math.min(180, Math.max(96, w * 0.26));
  const larguraValor = 84;
  const alturaBarra = Math.max(12, Math.min(26, (h - padTop * 2) / entries.length - vao));

  ctx.textBaseline = 'middle';

  entries.forEach((entry, i) => {
    const y = padTop + i * (alturaBarra + vao);
    const meio = y + alturaBarra / 2;

    ctx.font = CHART_FONT;
    ctx.textAlign = 'left';
    ctx.fillStyle = cssVar('--text-dim');
    ctx.fillText(truncateText(ctx, entry.label, larguraRotulo - 10), 0, meio);

    const barX = larguraRotulo;
    const larguraMax = Math.max(10, w - barX - larguraValor);
    const largura = max > 0 ? (entry.value / max) * larguraMax : 0;

    // trilho, para dar noção da escala mesmo nas barras curtas
    ctx.fillStyle = cssVar('--surface-3');
    pathRoundedRect(ctx, barX, y, larguraMax, alturaBarra, alturaBarra / 2);
    ctx.fill();

    ctx.fillStyle = color;
    pathRoundedRect(ctx, barX, y, Math.max(largura, alturaBarra), alturaBarra, alturaBarra / 2);
    ctx.fill();

    ctx.font = CHART_FONT_BOLD;
    ctx.textAlign = 'right';
    ctx.fillStyle = cssVar('--text');
    ctx.fillText(formatCompacto(entry.value), w, meio);
  });
}

function renderInadimplenciaChart(ano) {
  const agrupador = document.getElementById('inadimplenciaAgrupador').value;
  const anoAlvo = ano != null ? ano : anoGraficoSelecionado();
  const atrasadas = todasDividas().filter(d =>
    getStatus(d) === 'atrasado' && parseDate(d.vencimento).getFullYear() === anoAlvo);
  const totais = {};
  atrasadas.forEach(d => {
    const chave = agrupador === 'imovel' ? d.imovel : d.inquilino;
    totais[chave] = (totais[chave] || 0) + d.total + calcAtrasoAtual(d);
  });
  const entries = Object.keys(totais)
    .map(label => ({ label, value: totais[label] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  renderHorizontalBarChart('chartInadimplencia', entries, '--danger');
}

/* ---- Barras verticais genérico (ex: despesas mês a mês) ---- */
function renderColumnChart(canvasId, labels, values, colorVarName, vazioTexto) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  function desenhar(hoverIdx) {
    const { ctx, w, h } = setupCanvas(canvas);
    const cor = cssVar(colorVarName);
    const eixoColor = cssVar('--text-faint');

    if (!values.some(v => v > 0)) {
      drawChartEmptyState(ctx, w, h, vazioTexto || 'Sem dados neste período');
      canvas.__geo = null;
      return;
    }

    const linhas = 4;
    const passo = passoRedondo(Math.max(...values) / linhas);
    const topo = passo * linhas;

    ctx.font = CHART_FONT_SM;
    ctx.textBaseline = 'middle';
    let padLeft = 0;
    for (let i = 0; i <= linhas; i++) {
      padLeft = Math.max(padLeft, ctx.measureText(formatCompacto(topo - passo * i)).width);
    }
    padLeft += 16;
    const padRight = 12;
    const padTop = 16;
    const padBottom = 26;
    const chartW = Math.max(10, w - padLeft - padRight);
    const chartH = Math.max(10, h - padTop - padBottom);

    for (let i = 0; i <= linhas; i++) {
      const y = Math.round(padTop + (chartH / linhas) * i) + 0.5;
      ctx.strokeStyle = cssVar('--border-subtle');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(w - padRight, y);
      ctx.stroke();
      ctx.fillStyle = eixoColor;
      ctx.textAlign = 'right';
      ctx.fillText(formatCompacto(topo - passo * i), padLeft - 8, y);
    }

    const faixa = chartW / values.length;
    const larguraBarra = Math.max(6, Math.min(34, faixa * 0.6));

    values.forEach((v, i) => {
      const cxBarra = padLeft + faixa * i + faixa / 2;
      const altura = topo > 0 ? (v / topo) * chartH : 0;
      const y = padTop + chartH - altura;
      ctx.fillStyle = i === hoverIdx ? cor : cor + 'cc';
      pathRoundedRect(ctx, cxBarra - larguraBarra / 2, y, larguraBarra, Math.max(altura, v > 0 ? 3 : 0), [6, 6, 0, 0]);
      ctx.fill();

      ctx.font = CHART_FONT_SM;
      ctx.fillStyle = eixoColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      if (faixa >= 24 || i % 2 === 0) ctx.fillText(labels[i], cxBarra, h - 10);
      ctx.textBaseline = 'middle';
    });

    if (hoverIdx != null && values[hoverIdx] != null) {
      const cxBarra = padLeft + faixa * hoverIdx + faixa / 2;
      const altura = topo > 0 ? (values[hoverIdx] / topo) * chartH : 0;
      drawChartTooltip(ctx, w, cxBarra, padTop + chartH - altura, labels[hoverIdx],
        [{ valor: formatCurrency(values[hoverIdx]) }]);
    }

    canvas.__geo = { padLeft, faixa, n: values.length };
  }

  canvas.onmousemove = (e) => {
    const geo = canvas.__geo;
    if (!geo) return;
    const rect = canvas.getBoundingClientRect();
    const idx = Math.floor((e.clientX - rect.left - geo.padLeft) / geo.faixa);
    const valido = idx >= 0 && idx < geo.n ? idx : null;
    if (canvas.__hover !== valido) {
      canvas.__hover = valido;
      desenhar(valido);
    }
  };
  canvas.onmouseleave = () => {
    if (canvas.__hover == null) return;
    canvas.__hover = null;
    desenhar(null);
  };

  canvas.__hover = null;
  desenhar(null);
}

document.getElementById('inadimplenciaAgrupador').addEventListener('change', () => renderInadimplenciaChart());
document.getElementById('graficoAno').addEventListener('change', renderCharts);

window.addEventListener('resize', () => {
  if (document.getElementById('tab-graficos').classList.contains('active')) renderCharts();
  if (document.getElementById('tab-despesas').classList.contains('active')) renderDespesasAnoChart();
});

/* ===================== RELATÓRIOS MENSAIS/ANUAIS ===================== */
function populateRelatorioAnoFilter() {
  const select = document.getElementById('relatorioAno');
  const dividas = todasDividas();
  const anos = new Set(dividas.map(d => parseDate(d.vencimento).getFullYear()));
  dividas.forEach(d => d.pagamentos.forEach(p => anos.add(parseDate(p.data).getFullYear())));
  anos.add(new Date().getFullYear());
  const sorted = Array.from(anos).sort((a, b) => b - a);
  const current = select.value;
  select.innerHTML = sorted.map(a => `<option value="${a}">${a}</option>`).join('');
  select.value = sorted.map(String).includes(current) ? current : String(new Date().getFullYear());
}

// Todo o cálculo do relatório de um ano num lugar só — a tela e a exportação
// em CSV consomem exatamente o mesmo resultado, então nunca divergem.
function calcularRelatorioAnual(ano) {
  const dividas = todasDividas();

  let totalPagoAno = 0;
  let totalAtrasoAno = 0;
  let totalDespesasAno = 0;

  const linhas = MESES_PT.map((nomeMes, mesIndex) => {
    // Valor líquido = valor pago - comissão do corretor (se houver) - condomínio,
    // já que nenhum dos dois fica com o proprietário (mesma convenção do Histórico).
    const totalPago = dividas.reduce((sum, d) => {
      const pagoNoMes = d.pagamentos
        .filter(p => {
          const dt = parseDate(p.data);
          return dt.getFullYear() === ano && dt.getMonth() === mesIndex;
        })
        .reduce((s, p) => s + valorLiquidoPagamento(d, d, p), 0);
      return sum + pagoNoMes;
    }, 0);

    const dividasPeriodo = dividas.filter(d => {
      const dt = parseDate(d.vencimento);
      return dt.getFullYear() === ano && dt.getMonth() === mesIndex;
    });

    const totalAtraso = dividasPeriodo
      .filter(d => getStatus(d) === 'atrasado')
      .reduce((sum, d) => sum + d.total + calcAtrasoAtual(d), 0);

    const totalDespesas = despesasVisiveis()
      .filter(d => { const dt = parseDate(d.data); return dt.getFullYear() === ano && dt.getMonth() === mesIndex; })
      .reduce((sum, d) => sum + d.valor, 0);

    totalPagoAno += totalPago;
    totalAtrasoAno += totalAtraso;
    totalDespesasAno += totalDespesas;

    return { nomeMes, totalPago, totalAtraso, totalDespesas, count: dividasPeriodo.length };
  });

  const pagamentosDoAno = [];
  dividas.forEach(d => d.pagamentos.forEach(p => {
    if (parseDate(p.data).getFullYear() === ano) pagamentosDoAno.push({ ...p, valorLiquido: valorLiquidoPagamento(d, d, p) });
  }));

  const totalDescontoAno = pagamentosDoAno.reduce((sum, p) => sum + (p.desconto || 0), 0);

  const porForma = {};
  pagamentosDoAno.forEach(p => {
    const forma = p.forma || 'Não informado';
    if (!porForma[forma]) porForma[forma] = { count: 0, total: 0 };
    porForma[forma].count++;
    porForma[forma].total += p.valorLiquido;
  });

  // Comissões do ano, por corretor — o que precisa ser pago a cada um. A base é
  // sempre só o aluguel da dívida (ver comissaoCorretor).
  const corretores = comissoesPorCorretor(d => parseDate(d.vencimento).getFullYear() === ano);
  const totalCorretorAno = corretores.reduce((s, x) => s + x.total, 0);

  return { ano, linhas, totalPagoAno, totalAtrasoAno, totalDespesasAno, totalDescontoAno, porForma, corretores, totalCorretorAno };
}

function renderRelatorios() {
  populateRelatorioAnoFilter();
  const ano = Number(document.getElementById('relatorioAno').value);
  const r = calcularRelatorioAnual(ano);

  document.getElementById('relatorioTotalPagoAno').textContent = formatCurrency(r.totalPagoAno);
  document.getElementById('relatorioTotalAtrasoAno').textContent = formatCurrency(r.totalAtrasoAno);
  document.getElementById('relatorioTotalDespesasAno').textContent = formatCurrency(r.totalDespesasAno);
  document.getElementById('relatorioLucroLiquidoAno').textContent = formatCurrency(r.totalPagoAno - r.totalDespesasAno);
  document.getElementById('relatorioTotalDescontoAno').textContent = formatCurrency(r.totalDescontoAno);

  document.getElementById('relatorioTabelaBody').innerHTML = r.linhas.map(l => `
    <tr>
      <td>${l.nomeMes}</td>
      <td>${formatCurrency(l.totalPago)}</td>
      <td>${formatCurrency(l.totalDespesas)}</td>
      <td class="${l.totalAtraso > 0 ? 'text-danger' : ''}">${formatCurrency(l.totalAtraso)}</td>
      <td>${l.count}</td>
    </tr>
  `).join('');

  const formaBody = document.getElementById('relatorioFormaPagamentoBody');
  const formas = Object.keys(r.porForma);
  if (!formas.length) {
    formaBody.innerHTML = '<tr><td colspan="3">Nenhum pagamento registrado neste ano.</td></tr>';
  } else {
    formaBody.innerHTML = formas.map(forma => `
      <tr>
        <td>${escapeHtml(forma)}</td>
        <td>${r.porForma[forma].count}</td>
        <td>${formatCurrency(r.porForma[forma].total)}</td>
      </tr>
    `).join('');
  }

  // Comissão de corretores: o card inteiro some quando nenhum contrato tem corretor
  const corretorCard = document.getElementById('relatorioCorretorCard');
  corretorCard.classList.toggle('hidden', !r.corretores.length);
  if (r.corretores.length) {
    document.getElementById('relatorioCorretorBody').innerHTML = r.corretores.map(x => `
      <tr>
        <td>${escapeHtml(x.nome)}</td>
        <td>${x.contratos}</td>
        <td>${x.dividas}</td>
        <td>${formatCurrency(x.total)}</td>
      </tr>
    `).join('') + `
      <tr class="is-current">
        <td><strong>Total</strong></td>
        <td colspan="2"></td>
        <td><strong>${formatCurrency(r.totalCorretorAno)}</strong></td>
      </tr>
    `;
  }

  renderComparativoAnual(ano);
}

function calcularComparativoAnual() {
  const dividas = todasDividas();
  const anos = new Set(dividas.map(d => parseDate(d.vencimento).getFullYear()));
  dividas.forEach(d => d.pagamentos.forEach(p => anos.add(parseDate(p.data).getFullYear())));
  anos.add(new Date().getFullYear());
  const sorted = Array.from(anos).sort((a, b) => b - a);

  return sorted.map(ano => {
    const totalPago = dividas.reduce((sum, d) => {
      const pagoNoAno = d.pagamentos
        .filter(p => parseDate(p.data).getFullYear() === ano)
        .reduce((s, p) => s + valorLiquidoPagamento(d, d, p), 0);
      return sum + pagoNoAno;
    }, 0);

    const dividasAno = dividas.filter(d => parseDate(d.vencimento).getFullYear() === ano);
    const totalAtraso = dividasAno
      .filter(d => getStatus(d) === 'atrasado')
      .reduce((sum, d) => sum + d.total + calcAtrasoAtual(d), 0);

    const totalDespesas = despesasVisiveis()
      .filter(d => parseDate(d.data).getFullYear() === ano)
      .reduce((sum, d) => sum + d.valor, 0);

    return { ano, totalPago, totalAtraso, totalDespesas, count: dividasAno.length };
  });
}

function renderComparativoAnual(anoSelecionado) {
  document.getElementById('comparativoAnualBody').innerHTML = calcularComparativoAnual().map(l => `
    <tr class="${l.ano === anoSelecionado ? 'is-current' : ''}">
      <td>${l.ano}</td>
      <td>${formatCurrency(l.totalPago)}</td>
      <td>${formatCurrency(l.totalDespesas)}</td>
      <td class="${l.totalAtraso > 0 ? 'text-danger' : ''}">${formatCurrency(l.totalAtraso)}</td>
      <td>${l.count}</td>
    </tr>
  `).join('');
}

/* ---- Exportação do relatório do ano (CSV com todas as seções da tela) ---- */
document.getElementById('btnExportRelatorio').addEventListener('click', () => {
  const ano = Number(document.getElementById('relatorioAno').value);
  const r = calcularRelatorioAnual(ano);
  const v = (n) => (Number(n) || 0).toFixed(2);

  const rows = [
    [`Relatório anual — ${ano}`],
    [`Gerado em`, formatDate(todayStr())],
    ['Observação', 'Valores recebidos são líquidos: já descontam a comissão do corretor (quando houver) e o condomínio.'],
    [],
    ['RESUMO DO ANO'],
    ['Recebido no ano (líquido)', v(r.totalPagoAno)],
    ['Total em atraso no ano (aluguel + juros/multa)', v(r.totalAtrasoAno)],
    ['Descontos concedidos no ano', v(r.totalDescontoAno)],
    ['Despesas no ano', v(r.totalDespesasAno)],
    ['Lucro líquido no ano (pago − despesas)', v(r.totalPagoAno - r.totalDespesasAno)],
    [],
    ['PAGAMENTOS POR FORMA'],
    ['Forma', 'Quantidade', 'Total recebido (líquido)'],
  ];

  const formas = Object.keys(r.porForma);
  if (!formas.length) rows.push(['Nenhum pagamento registrado neste ano', '', '']);
  else formas.forEach(f => rows.push([f, r.porForma[f].count, v(r.porForma[f].total)]));

  if (r.corretores.length) {
    rows.push([]);
    rows.push(['COMISSÃO DE CORRETORES (base: só o aluguel de cada dívida)']);
    rows.push(['Corretor', 'Contratos', 'Dívidas', 'Comissão no ano']);
    r.corretores.forEach(x => rows.push([x.nome, x.contratos, x.dividas, v(x.total)]));
    rows.push(['Total', '', '', v(r.totalCorretorAno)]);
  }

  rows.push([]);
  rows.push(['MÊS A MÊS']);
  rows.push(['Mês', 'Recebido (líquido)', 'Despesas', 'Total em atraso', 'Contratos no período']);
  r.linhas.forEach(l => rows.push([l.nomeMes, v(l.totalPago), v(l.totalDespesas), v(l.totalAtraso), l.count]));

  rows.push([]);
  rows.push(['COMPARATIVO ANUAL']);
  rows.push(['Ano', 'Recebido (líquido)', 'Despesas', 'Total em atraso', 'Contratos no ano']);
  calcularComparativoAnual().forEach(l => rows.push([l.ano, v(l.totalPago), v(l.totalDespesas), v(l.totalAtraso), l.count]));

  downloadCsvRows(`relatorio_${ano}_${todayStr()}.csv`, rows);
  showToast(`Relatório de ${ano} exportado com sucesso.`, 'success');
});

/* ===================== RENDER: AUDITORIA ===================== */
function populateAuditoriaFiltros() {
  const todas = state.auditoria || [];

  const selectAno = document.getElementById('auditoriaFiltroAno');
  const anos = new Set(todas.map(e => new Date(e.timestamp).getFullYear()));
  anos.add(new Date().getFullYear());
  const anosOrdenados = Array.from(anos).sort((a, b) => b - a);
  const anoAtual = selectAno.value;
  selectAno.innerHTML = '<option value="">Todos os anos</option>' + anosOrdenados.map(a => `<option value="${a}">${a}</option>`).join('');
  selectAno.value = anosOrdenados.map(String).includes(anoAtual) ? anoAtual : '';

  const selectUsuario = document.getElementById('auditoriaFiltroUsuario');
  const usuarios = Array.from(new Set(todas.map(e => e.usuario))).sort();
  const usuarioAtual = selectUsuario.value;
  selectUsuario.innerHTML = '<option value="">Todos os usuários</option>' + usuarios.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');
  selectUsuario.value = usuarios.includes(usuarioAtual) ? usuarioAtual : '';
}

function renderAuditoria() {
  populateAuditoriaFiltros();
  const list = document.getElementById('auditoriaList');

  const ano = document.getElementById('auditoriaFiltroAno').value;
  const mes = document.getElementById('auditoriaFiltroMes').value;
  const usuario = document.getElementById('auditoriaFiltroUsuario').value;

  const entries = (state.auditoria || [])
    .filter(e => {
      const dt = new Date(e.timestamp);
      if (ano && dt.getFullYear() !== Number(ano)) return false;
      if (mes !== '' && dt.getMonth() !== Number(mes)) return false;
      if (usuario && e.usuario !== usuario) return false;
      return true;
    })
    .sort((a, b) => b.timestamp - a.timestamp);

  if (!entries.length) {
    list.innerHTML = '<div class="empty-state">Nenhum evento encontrado para esse filtro.</div>';
    return;
  }

  list.innerHTML = entries.map(e => `
    <div class="card">
      <div class="contrato-top">
        <div>
          <div class="contrato-title">${escapeHtml(e.descricao)}</div>
          <div class="contrato-sub">${icon('user')} ${escapeHtml(e.usuario)} · ${formatDateTime(e.timestamp)}</div>
        </div>
      </div>
      ${e.alteracoes && e.alteracoes.length ? `
        <ul class="auditoria-diff">
          ${e.alteracoes.map(a => `<li><strong>${escapeHtml(a.campo)}:</strong> ${escapeHtml(formatDiffValor(a.de))} → ${escapeHtml(formatDiffValor(a.para))}</li>`).join('')}
        </ul>
      ` : ''}
    </div>
  `).join('');
}

document.getElementById('relatorioAno').addEventListener('change', renderRelatorios);

['auditoriaFiltroAno', 'auditoriaFiltroMes', 'auditoriaFiltroUsuario'].forEach(id => {
  document.getElementById(id).addEventListener('change', renderAuditoria);
});

/* ===================== CALENDÁRIO ===================== */
let calendarioAtual = new Date();
calendarioAtual.setDate(1);
let calendarioDiaSelecionado = null;

function dateStrLocal(ano, mes, dia) {
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function renderCalendario() {
  const ano = calendarioAtual.getFullYear();
  const mes = calendarioAtual.getMonth();
  document.getElementById('calendarioMesAno').textContent = `${MESES_PT[mes]} ${ano}`;

  const primeiroDiaSemana = new Date(ano, mes, 1).getDay();
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const diasNoMesAnterior = new Date(ano, mes, 0).getDate();
  const hojeStr = todayStr();
  const dividas = todasDividas();

  // A grade sempre fecha semanas completas: começa com os últimos dias do mês
  // anterior e termina com os primeiros dias do mês seguinte, numerados de
  // verdade (1, 2, 3...) e não pelo índice da célula.
  const celulas = [];
  for (let i = 0; i < primeiroDiaSemana; i++) {
    celulas.push({ dia: diasNoMesAnterior - primeiroDiaSemana + 1 + i, outside: true });
  }
  for (let d = 1; d <= diasNoMes; d++) {
    celulas.push({ dia: d, outside: false });
  }
  let diaProximoMes = 1;
  while (celulas.length % 7 !== 0) {
    celulas.push({ dia: diaProximoMes++, outside: true });
  }

  const grid = document.getElementById('calendarioGrid');
  grid.innerHTML = celulas.map(c => {
    if (c.outside) {
      return `<div class="calendar-day is-outside"><span class="calendar-day-number">${c.dia}</span></div>`;
    }
    const dataStr = dateStrLocal(ano, mes, c.dia);
    const vencimentos = dividas.filter(d => d.vencimento === dataStr);
    const pagamentosNoDia = [];
    dividas.forEach(d => d.pagamentos.forEach(p => { if (p.data === dataStr) pagamentosNoDia.push(p); }));

    const classes = ['calendar-day'];
    if (dataStr === hojeStr) classes.push('is-today');
    if (dataStr === calendarioDiaSelecionado) classes.push('is-selected');

    // Cor de fundo do dia todo = pior status entre os vencimentos daquele dia
    // (atrasado ganha de ativo, que ganha de "só teve pagamento recebido").
    const temAtrasado = vencimentos.some(d => getStatus(d) === 'atrasado');
    const temAtivo = vencimentos.some(d => getStatus(d) === 'ativo');
    if (temAtrasado) classes.push('has-atrasado');
    else if (temAtivo) classes.push('has-ativo');
    else if (vencimentos.length || pagamentosNoDia.length) classes.push('has-pago');

    const dots = [];
    vencimentos.forEach(d => {
      const st = getStatus(d);
      const classeCor = st === 'atrasado' ? 'bg-danger' : st === 'pago' ? 'bg-success' : 'bg-accent';
      dots.push(`<span class="calendar-dot ${classeCor}"></span>`);
    });
    pagamentosNoDia.forEach(() => dots.push('<span class="calendar-dot bg-success"></span>'));

    const totalVencimentos = vencimentos.reduce((sum, d) => sum + d.total, 0);
    const valorLabel = totalVencimentos > 0
      ? `<div class="calendar-day-valor">${formatCurrency(totalVencimentos)}</div>`
      : '';

    return `
      <div class="${classes.join(' ')}" data-data="${dataStr}">
        <span class="calendar-day-number">${c.dia}</span>
        ${valorLabel}
        <div class="calendar-day-dots">${dots.join('')}</div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.calendar-day[data-data]').forEach(el => {
    el.addEventListener('click', () => {
      calendarioDiaSelecionado = el.dataset.data;
      renderCalendario();
      renderCalendarioDetalhe(el.dataset.data);
    });
  });
}

function renderCalendarioDetalhe(dataStr) {
  const card = document.getElementById('calendarioDetalheCard');
  const lista = document.getElementById('calendarioDetalheLista');
  const dividas = todasDividas();
  const vencimentos = dividas.filter(d => d.vencimento === dataStr);
  const pagamentos = [];
  dividas.forEach(d => d.pagamentos.forEach(p => { if (p.data === dataStr) pagamentos.push({ ...p, divida: d }); }));

  document.getElementById('calendarioDetalheTitulo').textContent = formatDate(dataStr);
  card.classList.remove('hidden');

  if (!vencimentos.length && !pagamentos.length) {
    lista.innerHTML = '<div class="empty-state">Nenhum vencimento ou pagamento neste dia.</div>';
    return;
  }

  const itensVencimento = vencimentos.map(d => {
    const status = getStatus(d);
    return `
      <div class="card">
        <div class="contrato-top">
          <div>
            <div class="contrato-title">${escapeHtml(d.imovel)}</div>
            <div class="contrato-sub">${icon('user')} ${escapeHtml(d.inquilino)} · Vencimento · ${formatCurrency(d.total)}</div>
          </div>
          <span class="status-badge status-${status}">${statusLabel(status)}</span>
        </div>
      </div>
    `;
  });

  const itensPagamento = pagamentos.map(p => `
    <div class="card">
      <div class="contrato-top">
        <div>
          <div class="contrato-title">${escapeHtml(p.divida.imovel)}</div>
          <div class="contrato-sub">${icon('user')} ${escapeHtml(p.divida.inquilino)} · Pagamento recebido · ${formatCurrency(p.valor)}</div>
        </div>
        <span class="status-badge status-pago">Pago</span>
      </div>
    </div>
  `);

  lista.innerHTML = itensVencimento.join('') + itensPagamento.join('');
}

function mudarMesCalendario(delta) {
  calendarioAtual.setMonth(calendarioAtual.getMonth() + delta);
  calendarioDiaSelecionado = null;
  document.getElementById('calendarioDetalheCard').classList.add('hidden');
  renderCalendario();
}

document.getElementById('btnCalendarioAnterior').addEventListener('click', () => mudarMesCalendario(-1));
document.getElementById('btnCalendarioProximo').addEventListener('click', () => mudarMesCalendario(1));
document.getElementById('btnCalendarioHoje').addEventListener('click', () => {
  calendarioAtual = new Date();
  calendarioAtual.setDate(1);
  calendarioDiaSelecionado = null;
  document.getElementById('calendarioDetalheCard').classList.add('hidden');
  renderCalendario();
});

/* ===================== EXPORT CSV ===================== */
// Recebe as linhas já prontas (inclusive linhas em branco, usadas para separar
// seções num relatório) e gera o arquivo. O BOM no início é o que faz o Excel
// abrir os acentos corretamente.
function downloadCsvRows(filename, rows) {
  const csvContent = rows
    .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');

  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCsv(filename, headers, rows) {
  downloadCsvRows(filename, [headers, ...rows]);
}

// Nome de arquivo seguro a partir de um texto livre.
function nomeArquivoSeguro(texto) {
  return String(texto || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase() || 'export';
}

document.getElementById('btnExportCSV').addEventListener('click', () => {
  const dividas = getFilteredDividasFlat();
  if (!dividas.length) { showToast('Nenhuma dívida para exportar.', 'error'); return; }

  // As 14 primeiras colunas NÃO podem mudar de posição: a importação lê por
  // posição, e mexer nelas quebraria arquivos exportados antes. Tudo que é novo
  // entra sempre no fim da linha (a importação ignora o que não conhece).
  const headers = [
    'Nº Contrato', 'Vencimento', 'Imóvel', 'Inquilino', 'Aluguel', 'Desconto', 'Juros',
    'Multa', 'Condomínio', 'Total a Cobrar', 'Valor em Atraso', 'Status', 'Quem Recebe',
    'Observação', 'Carteira', 'Proprietário', 'Corretor', '% Corretor',
    'Comissão do Corretor', 'Total Líquido', 'Dias em Atraso', 'Já Recebido',
    'Pago em', 'Situação do Contrato', 'Início do Contrato', 'Dia de Pagamento', 'Caução',
    'Condomínio Pago Direto pelo Inquilino',
  ];
  const rows = dividas.map(d => {
    const c = state.contratos.find(x => x.id === d.contratoId) || {};
    const carteira = carteiraPorId(c.carteiraId) || {};
    const recebido = (d.pagamentos || []).reduce((s, p) => s + (Number(p.valor) || 0), 0);
    return [
      d.numero || '',
      formatDate(d.vencimento),
      d.imovel,
      d.inquilino,
      d.aluguel.toFixed(2),
      d.desconto.toFixed(2),
      d.juros.toFixed(2),
      d.multa.toFixed(2),
      condominioCobrado(d).toFixed(2),
      d.total.toFixed(2),
      calcAtrasoAtual(d).toFixed(2),
      statusLabel(getStatus(d)),
      d.quemRecebeu || '',
      d.observacao || '',
      carteiraNome(c.carteiraId),
      carteira.proprietario || '',
      c.corretorNome || '',
      c.corretorNome ? (Number(c.corretorPercentual) || 0).toFixed(2) : '',
      comissaoCorretor(c, d).toFixed(2),
      totalLiquidoDivida(c, d).toFixed(2),
      getStatus(d) === 'atrasado' ? diasAtraso(d) : 0,
      recebido.toFixed(2),
      d.dataPagamento ? formatDate(d.dataPagamento) : '',
      c.encerrado ? 'Encerrado' : 'Ativo',
      c.dataInicio ? formatDate(c.dataInicio) : '',
      c.diaPagamento || '',
      (Number(c.caucao) || 0).toFixed(2),
      d.condominioDireto ? 'Sim' : 'Não',
    ];
  });

  downloadCsv(`contratos_${todayStr()}.csv`, headers, rows);
  showToast(`${dividas.length} dívida(s) exportada(s) para CSV.`, 'success');
});

document.getElementById('btnExportHistoricoContrato').addEventListener('click', () => {
  const c = state.contratos.find(x => x.id === historicoContratoAtualId);
  if (!c) return;
  const pagamentos = [];
  c.dividas.forEach(d => d.pagamentos.forEach(p => pagamentos.push({ ...p, divida: d })));
  if (!pagamentos.length) { showToast('Nenhum pagamento para exportar.', 'error'); return; }
  pagamentos.sort((a, b) => parseDate(a.data) - parseDate(b.data));

  const carteira = carteiraPorId(c.carteiraId) || {};
  const soma = (fn) => pagamentos.reduce((s, p) => s + fn(p), 0);

  // Um cabeçalho identificando o contrato antes da tabela: o arquivo sai de um
  // contrato específico, e sem isso só o nome do arquivo diria de qual.
  const rows = [
    [`Pagamentos do contrato #${c.numero || '--'}`],
    ['Imóvel', c.imovel],
    ['Inquilino', c.inquilino],
    ['Carteira', carteiraNome(c.carteiraId) || 'Sem carteira'],
    ['Proprietário', carteira.proprietario || ''],
    ['Corretor', c.corretorNome ? `${c.corretorNome} (${c.corretorPercentual}%)` : 'Nenhum'],
    ['Situação', c.encerrado ? `Encerrado em ${formatDate(c.dataEncerramento)}` : 'Ativo'],
    ['Gerado em', formatDate(todayStr())],
    [],
    ['Dívida (Vencimento)', 'Total da Dívida', 'Data do Pagamento', 'Valor Pago',
      'Comissão do Corretor', 'Condomínio (Repasse)', 'Valor Líquido',
      'Desconto', 'Motivo do Desconto', 'Forma de Pagamento', 'Quem Recebeu', 'Observação'],
  ];

  pagamentos.forEach(p => rows.push([
    formatDate(p.divida.vencimento),
    (Number(p.divida.total) || 0).toFixed(2),
    formatDate(p.data),
    (Number(p.valor) || 0).toFixed(2),
    comissaoCorretor(c, p.divida).toFixed(2),
    condominioNoPagamento(p.divida, p).toFixed(2),
    valorLiquidoPagamento(c, p.divida, p).toFixed(2),
    (p.desconto || 0).toFixed(2),
    p.motivoDesconto || '',
    p.forma || '',
    p.quemRecebeu || '',
    p.observacao || '',
  ]));

  rows.push([]);
  rows.push(['TOTAIS', '', `${pagamentos.length} pagamento(s)`,
    soma(p => Number(p.valor) || 0).toFixed(2),
    soma(p => comissaoCorretor(c, p.divida)).toFixed(2),
    soma(p => condominioNoPagamento(p.divida, p)).toFixed(2),
    soma(p => valorLiquidoPagamento(c, p.divida, p)).toFixed(2),
    soma(p => Number(p.desconto) || 0).toFixed(2)]);

  downloadCsvRows(`pagamentos_${nomeArquivoSeguro(c.imovel)}_${todayStr()}.csv`, rows);
  showToast('CSV do contrato exportado com sucesso.', 'success');
});

/* ===================== IMPORT CSV (contratos) ===================== */
function parseCsvLine(line, delimiter) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function parseCsv(text) {
  const clean = text.replace(/^﻿/, '');
  return clean.split(/\r\n|\n/).filter(l => l.length > 0).map(l => parseCsvLine(l, ';'));
}

function parseDateBR(str) {
  const partes = (str || '').split('-');
  if (partes.length !== 3) return null;
  const [d, m, y] = partes;
  if (!d || !m || !y) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

document.getElementById('btnImportCSV').addEventListener('click', () => {
  document.getElementById('inputImportCSV').click();
});

document.getElementById('inputImportCSV').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const linhas = parseCsv(String(reader.result));
    const linhasDados = linhas.slice(1); // pula o cabeçalho
    let importados = 0;
    let ignorados = 0;

    linhasDados.forEach(row => {
      // Colunas seguem a mesma ordem do CSV exportado (ver btnExportCSV):
      // Nº Contrato (ignorado — é sempre gerado de novo), Vencimento, Imóvel,
      // Inquilino, Aluguel, Desconto, Juros, Multa, Condomínio, Total, Valor
      // em Atraso, Status, Quem Recebe, Observação, Carteira (opcional: só
      // existe em arquivos exportados depois das carteiras, e vale só se uma
      // carteira com esse nome já estiver cadastrada aqui)
      const vencimento = parseDateBR(row[1]);
      const imovel = (row[2] || '').trim();
      const inquilino = (row[3] || '').trim();
      if (!vencimento || !imovel || !inquilino) { ignorados++; return; }

      const aluguel = parseFloat(row[4]) || 0;
      const desconto = parseFloat(row[5]) || 0;
      const juros = parseFloat(row[6]) || 0;
      const multa = parseFloat(row[7]) || 0;
      const condominio = parseFloat(row[8]) || 0;
      const quemRecebeu = (row[12] || '').trim();
      const nomeCarteira = (row[14] || '').trim().toLowerCase();
      const carteira = nomeCarteira ? state.carteiras.find(x => x.nome.toLowerCase() === nomeCarteira) : null;

      const divida = {
        id: uuid(),
        vencimento,
        aluguel, desconto, juros, multa, condominio,
        valorAtrasoBase: parseFloat(row[10]) || 0,
        observacao: (row[13] || '').trim(),
        pago: false,
        dataPagamento: null,
        pagamentos: [],
        criadoEm: Date.now(),
      };
      divida.total = calcTotal(divida);

      state.contratos.push({
        id: uuid(),
        numero: proximoNumeroContrato(),
        imovel,
        carteiraId: carteira ? carteira.id : '',
        inquilino,
        quemRecebeu,
        dataInicio: vencimento,
        diaPagamento: parseDate(vencimento).getDate(),
        aluguel, desconto, juros, multa, condominio,
        anexoContrato: null,
        dataUltimoReajuste: vencimento,
        encerrado: false,
        dataEncerramento: null,
        criadoEm: Date.now(),
        dividas: [divida],
      });
      importados++;
    });

    if (importados > 0) {
      saveState();
      renderAll();
    }
    showToast(`${importados} contrato(s) importado(s)${ignorados ? `, ${ignorados} ignorado(s)` : ''}.`, importados ? 'success' : 'error');
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
});

/* ===================== EXPORT PDF (relatório de contratos impresso) =====================
 * Agrupado por contrato, uma tabela de dívidas por contrato, com subtotal de
 * cada um e total geral no fim. Sai em A4 deitado (são muitas colunas de
 * dinheiro) e quebra em páginas sozinho, sem cortar um contrato ao meio.
 */

// Contratos que passam no filtro da tela, cada um já com a lista das SUAS
// dívidas que também passam — o PDF é agrupado por contrato, então precisa
// desse recorte, e não da lista achatada usada no CSV.
function getFilteredContratosComDividas() {
  const filtros = lerFiltrosContratos();
  return contratosVisiveis()
    .filter(c => contratoPassaFiltro(c, filtros))
    .map(c => {
      const dividas = (c.dividas || []).filter(d => {
        const venc = parseDate(d.vencimento);
        if (filtros.ano && venc.getFullYear() !== Number(filtros.ano)) return false;
        if (filtros.mes !== '' && venc.getMonth() !== Number(filtros.mes)) return false;
        if (filtros.status && getStatus(d) !== filtros.status) return false;
        return true;
      }).sort((a, b) => a.vencimento < b.vencimento ? -1 : 1);
      return { contrato: c, dividas };
    })
    .filter(x => x.dividas.length)
    .sort((a, b) => (Number(a.contrato.numero) || 0) - (Number(b.contrato.numero) || 0));
}

// Descrição legível dos filtros ativos, impressa no cabeçalho — sem isso não dá
// para saber, olhando o papel, se ele mostra o ano todo ou só um mês.
function descricaoFiltrosAtivos() {
  const f = lerFiltrosContratos();
  const partes = [];
  if (carteiraAtiva) partes.push(`Carteira: ${carteiraNome(carteiraAtiva)}`);
  if (f.search) partes.push(`Busca: "${f.search}"`);
  if (f.ano) partes.push(`Ano: ${f.ano}`);
  if (f.mes !== '') partes.push(`Mês: ${MESES_PT[Number(f.mes)]}`);
  if (f.status) partes.push(`Status: ${statusLabel(f.status)}`);
  return partes.length ? partes.join(' · ') : 'Sem filtros — todos os contratos';
}

// Nas tabelas o cabeçalho já diz que a coluna é em R$; repetir o símbolo em
// cada célula só rouba largura.
function formatNumero(v) {
  return (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ESTILO_RELATORIO = `
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px; background: #fff; color: #14161a;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 9pt; line-height: 1.45;
  }
  h1 { font-size: 16pt; margin: 0 0 2px; }
  h2 { font-size: 10.5pt; margin: 0 0 1px; }
  .doc-head { border-bottom: 2px solid #14161a; padding-bottom: 8px; margin-bottom: 14px; }
  .meta { color: #5b6270; font-size: 8.5pt; margin: 0; }
  .meta strong { color: #14161a; }

  .contrato { margin-bottom: 14px; page-break-inside: avoid; }
  .contrato-head { border-left: 3px solid #14161a; padding-left: 8px; margin-bottom: 5px; }
  .contrato-head .sub { color: #5b6270; font-size: 8pt; margin: 0; }
  .tag {
    display: inline-block; padding: 0 5px; margin-left: 5px; border-radius: 3px;
    border: 1px solid #b9bfca; font-size: 7.5pt; font-weight: 600; color: #5b6270;
    vertical-align: middle;
  }

  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { padding: 3px 5px; border-bottom: 1px solid #e2e5ea; text-align: right; white-space: nowrap; }
  th { background: #f2f4f7; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .04em; color: #5b6270; }
  th:first-child, td:first-child, th.txt, td.txt { text-align: left; }
  tfoot td { font-weight: 700; border-top: 1.5px solid #14161a; border-bottom: 0; background: #f8f9fb; }
  .neg { color: #a8321f; }
  .liq { font-weight: 700; }
  .zero { color: #a6acb8; }

  .totais { margin-top: 18px; page-break-inside: avoid; }
  .totais h2 { border-top: 2px solid #14161a; padding-top: 8px; }
  .totais table { max-width: 420px; }
  .rodape { margin-top: 16px; color: #8b92a0; font-size: 7.5pt; text-align: center; }
  @media print { body { padding: 0; } }
`;

const COLUNAS_PDF = [
  { rotulo: 'Vencimento', txt: true },
  { rotulo: 'Status', txt: true },
  { rotulo: 'Aluguel' },
  { rotulo: 'Condom.' },
  { rotulo: 'Juros' },
  { rotulo: 'Multa' },
  { rotulo: 'Desconto' },
  { rotulo: 'Total a cobrar' },
  { rotulo: 'Corretor' },
  { rotulo: 'Total líquido' },
  { rotulo: 'Em atraso' },
  { rotulo: 'Dias' },
  { rotulo: 'Pago em', txt: true },
];

// Célula de dinheiro: zero fica apagado, para a vista cair no que tem valor.
function celulaValor(v, classe) {
  const n = Number(v) || 0;
  return `<td class="${n === 0 ? 'zero' : (classe || '')}">${formatNumero(n)}</td>`;
}

function linhaDividaPdf(c, d) {
  const status = getStatus(d);
  const comissao = comissaoCorretor(c, d);
  const atraso = calcAtrasoAtual(d);
  return `
    <tr>
      <td class="txt">${formatDate(d.vencimento)}</td>
      <td class="txt">${statusLabel(status)}</td>
      ${celulaValor(d.aluguel)}
      ${celulaValor(condominioCobrado(d))}
      ${celulaValor(d.juros)}
      ${celulaValor(d.multa)}
      ${celulaValor(d.desconto, 'neg')}
      ${celulaValor(d.total)}
      ${celulaValor(comissao, 'neg')}
      ${celulaValor(totalLiquidoDivida(c, d), 'liq')}
      ${celulaValor(atraso, 'neg')}
      <td class="${atraso > 0 ? 'neg' : 'zero'}">${status === 'atrasado' ? diasAtraso(d) : '—'}</td>
      <td class="txt">${d.dataPagamento ? formatDate(d.dataPagamento) : '—'}</td>
    </tr>
  `;
}

function somarDividas(c, dividas) {
  return dividas.reduce((acc, d) => ({
    aluguel: acc.aluguel + (Number(d.aluguel) || 0),
    condominio: acc.condominio + condominioCobrado(d),
    juros: acc.juros + (Number(d.juros) || 0),
    multa: acc.multa + (Number(d.multa) || 0),
    desconto: acc.desconto + (Number(d.desconto) || 0),
    total: acc.total + (Number(d.total) || 0),
    comissao: acc.comissao + comissaoCorretor(c, d),
    liquido: acc.liquido + totalLiquidoDivida(c, d),
    atraso: acc.atraso + calcAtrasoAtual(d),
    quantidade: acc.quantidade + 1,
  }), { aluguel: 0, condominio: 0, juros: 0, multa: 0, desconto: 0, total: 0, comissao: 0, liquido: 0, atraso: 0, quantidade: 0 });
}

function linhaTotalPdf(rotulo, s) {
  return `
    <tr>
      <td class="txt" colspan="2">${escapeHtml(rotulo)}</td>
      ${celulaValor(s.aluguel)}
      ${celulaValor(s.condominio)}
      ${celulaValor(s.juros)}
      ${celulaValor(s.multa)}
      ${celulaValor(s.desconto, 'neg')}
      ${celulaValor(s.total)}
      ${celulaValor(s.comissao, 'neg')}
      ${celulaValor(s.liquido, 'liq')}
      ${celulaValor(s.atraso, 'neg')}
      <td colspan="2"></td>
    </tr>
  `;
}

function blocoContratoPdf({ contrato: c, dividas }) {
  const carteira = carteiraPorId(c.carteiraId);
  const detalhes = [
    escapeHtml(c.inquilino),
    c.dataInicio ? `início ${formatDate(c.dataInicio)}, todo dia ${c.diaPagamento}` : '',
    carteira ? `carteira: ${escapeHtml(carteira.nome)}${carteira.proprietario ? ` (${escapeHtml(carteira.proprietario)})` : ''}` : '',
    c.quemRecebeu ? `recebedor: ${escapeHtml(c.quemRecebeu)}` : '',
    c.corretorNome ? `corretor: ${escapeHtml(c.corretorNome)} (${c.corretorPercentual}%)` : '',
    c.caucao ? `caução: ${formatNumero(c.caucao)}${c.caucaoDevolvida ? ' (devolvida)' : ''}` : '',
    dividas.some(d => d.condominioDireto) ? 'condomínio pago direto pelo inquilino' : '',
  ].filter(Boolean).join(' · ');

  return `
    <section class="contrato">
      <div class="contrato-head">
        <h2>#${c.numero || '--'} — ${escapeHtml(c.imovel)}${c.encerrado ? '<span class="tag">Encerrado</span>' : ''}</h2>
        <p class="sub">${detalhes}</p>
      </div>
      <table>
        <thead><tr>${COLUNAS_PDF.map(col => `<th class="${col.txt ? 'txt' : ''}">${col.rotulo}</th>`).join('')}</tr></thead>
        <tbody>${dividas.map(d => linhaDividaPdf(c, d)).join('')}</tbody>
        <tfoot>${linhaTotalPdf(`Subtotal — ${dividas.length} dívida(s)`, somarDividas(c, dividas))}</tfoot>
      </table>
    </section>
  `;
}

document.getElementById('btnExportPDF').addEventListener('click', () => {
  const grupos = getFilteredContratosComDividas();
  if (!grupos.length) { showToast('Nenhuma dívida para exportar.', 'error'); return; }

  const geral = grupos.reduce((acc, g) => {
    const s = somarDividas(g.contrato, g.dividas);
    Object.keys(acc).forEach(k => { acc[k] += s[k]; });
    return acc;
  }, { aluguel: 0, condominio: 0, juros: 0, multa: 0, desconto: 0, total: 0, comissao: 0, liquido: 0, atraso: 0, quantidade: 0 });

  const recebido = grupos.reduce((soma, g) =>
    soma + g.dividas.reduce((s, d) => s + (d.pagamentos || []).reduce((x, p) => x + (Number(p.valor) || 0), 0), 0), 0);

  const corpo = `
    <div class="doc-head">
      <h1>Relatório de contratos de aluguel</h1>
      <p class="meta">Gerado em <strong>${formatDate(todayStr())}</strong> · ${escapeHtml(descricaoFiltrosAtivos())}
         · <strong>${grupos.length}</strong> contrato(s), <strong>${geral.quantidade}</strong> dívida(s)</p>
    </div>

    ${grupos.map(blocoContratoPdf).join('')}

    <section class="totais">
      <h2>Total geral</h2>
      <table>
        <tbody>
          <tr><td class="txt">Aluguel</td>${celulaValor(geral.aluguel)}</tr>
          <tr><td class="txt">+ Condomínio</td>${celulaValor(geral.condominio)}</tr>
          <tr><td class="txt">+ Juros</td>${celulaValor(geral.juros)}</tr>
          <tr><td class="txt">+ Multa</td>${celulaValor(geral.multa)}</tr>
          <tr><td class="txt">− Desconto</td>${celulaValor(geral.desconto, 'neg')}</tr>
          <tr><td class="txt"><strong>= Total a cobrar</strong></td>${celulaValor(geral.total, 'liq')}</tr>
          <tr><td class="txt">− Comissão do corretor</td>${celulaValor(geral.comissao, 'neg')}</tr>
          <tr><td class="txt">− Condomínio (repasse)</td>${celulaValor(geral.condominio, 'neg')}</tr>
          <tr><td class="txt"><strong>= Total líquido</strong></td>${celulaValor(geral.liquido, 'liq')}</tr>
        </tbody>
        <tfoot>
          <tr><td class="txt">Já recebido (bruto)</td>${celulaValor(recebido)}</tr>
          <tr><td class="txt">Em atraso hoje (juros/multa)</td>${celulaValor(geral.atraso, 'neg')}</tr>
        </tfoot>
      </table>
    </section>

    <p class="rodape">
      Valores em R$. "Total a cobrar" é o que o inquilino deve; "Total líquido" é o que sobra
      para o proprietário depois de deduzir a comissão do corretor e o condomínio, que são repassados.
      "Em atraso hoje" é o acréscimo de juros/multa calculado até a data de emissão deste relatório.
    </p>
  `;

  if (abrirJanelaImpressao('Relatório de contratos', ESTILO_RELATORIO, corpo)) {
    showToast('Relatório gerado. Use "Salvar como PDF" na janela de impressão.', 'success');
  }
});

/* ===================== RENDER ALL ===================== */
function renderAll() {
  renderDashboard();
  renderImoveis();
  renderContratos();
  renderAtrasos();
  renderHistorico();
  renderConfig();
  const graficosTab = document.getElementById('tab-graficos');
  if (graficosTab.classList.contains('active')) renderCharts();
  const relatoriosTab = document.getElementById('tab-relatorios');
  if (relatoriosTab.classList.contains('active')) renderRelatorios();
  const auditoriaTab = document.getElementById('tab-auditoria');
  if (auditoriaTab.classList.contains('active')) renderAuditoria();
  const calendarioTab = document.getElementById('tab-calendario');
  if (calendarioTab.classList.contains('active')) renderCalendario();
  const despesasTab = document.getElementById('tab-despesas');
  if (despesasTab.classList.contains('active')) renderDespesas();
}

/* ===================== INIT ===================== */
(async function init() {
  const session = await checkSession();
  if (session) {
    setCurrentUsername(session.username);
    await showApp();
  } else {
    showLogin();
  }
})();
