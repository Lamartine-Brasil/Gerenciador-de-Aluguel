'use strict';

/* ===================== CONSTANTS ===================== */
const API_BASE = 'api/';

const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_ALERTA_VENCIMENTO = 5;

/* ===================== STATE =====================
 * Cada item de state.contratos representa UM contrato de aluguel (um imóvel +
 * um inquilino), e guarda dentro de si a lista `dividas`: uma por mês/ciclo de
 * cobrança (vencimento, valores, se foi paga, pagamentos). Isso permite um
 * contrato antigo já nascer com várias dívidas em aberto (uma por mês em
 * atraso), em vez de virar vários "contratos" separados.
 */
let state = { contratos: [], config: { taxaJurosMensal: 1, taxaMultaPercent: 2, corretorPercentualPadrao: 5, percentualReajusteSugerido: 5 }, auditoria: [], pessoas: [], despesas: [], imoveis: [] };
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
  data.config = Object.assign({ taxaJurosMensal: 1, taxaMultaPercent: 2, corretorPercentualPadrao: 5, percentualReajusteSugerido: 5 }, data.config || {});
  data.auditoria = data.auditoria || [];
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
// dia de pagamento escolhido (ex: início 03-06-2023 + dia 1 -> primeiro
// vencimento 01-06-2023). Se o dia de pagamento não existir naquele mês
// (ex: dia 31 em fevereiro), usa o último dia do mês.
function primeiroVencimento(dataInicioStr, diaPagamento) {
  const [y, m] = dataInicioStr.split('-').map(Number);
  const diasNoMes = new Date(y, m, 0).getDate();
  const dia = Math.min(diaPagamento, diasNoMes);
  return `${y}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
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
function calcTotal(d) {
  return (Number(d.aluguel) || 0) - (Number(d.desconto) || 0) + (Number(d.juros) || 0) + (Number(d.multa) || 0) + (Number(d.condominio) || 0);
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

// Valor que o proprietário de fato fica com um pagamento, descontando a parte
// do corretor (se houver) e o condomínio — nenhum dos dois é receita dele,
// só "passa pela mão" antes de ser repassado.
function valorLiquidoPagamento(c, d, p) {
  const corretorCut = c.corretorNome ? (Number(d.aluguel) || 0) * (Number(c.corretorPercentual) || 0) / 100 : 0;
  const condominio = Number(d.condominio) || 0;
  return (Number(p.valor) || 0) - corretorCut - condominio;
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

// Retorna todas as dívidas de todos os contratos, "achatadas" numa lista só,
// cada uma já com os dados do contrato pai (imóvel, inquilino etc.) juntos —
// usada por todas as telas que listam/somam por mês (Dashboard, Atrasos,
// Histórico, Gráficos, Relatórios, Calendário, exportações).
function todasDividas() {
  const lista = [];
  state.contratos.forEach(c => {
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
  loadUsers();
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
  const total = calcTotal({
    aluguel,
    desconto: document.getElementById('fDesconto').value,
    juros,
    multa,
    condominio: document.getElementById('fCondominio').value,
  });
  document.getElementById('fTotalPreview').textContent = formatCurrency(total);
}

['fAluguel', 'fDesconto', 'fJuros', 'fMulta', 'fJurosPercentual', 'fMultaPercentual', 'fCondominio'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateTotalPreview);
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
  document.getElementById('fSemImovelHint').classList.toggle('hidden', state.imoveis.length > 0);
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
  document.getElementById('fValorAtraso').value = d.valorAtrasoBase || '';
  document.getElementById('fObservacao').value = d.observacao || '';
  document.getElementById('modalContratoTitle').textContent = `Editar dívida — ${c.imovel} (${c.inquilino})`;
  document.getElementById('fCampoDataInicio').classList.add('hidden');
  document.getElementById('fCampoDiaPagamento').classList.add('hidden');
  document.getElementById('fCampoImovel').classList.add('hidden');
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
      inquilino,
      quemRecebeu,
      dataInicio,
      diaPagamento,
      aluguel: camposDivida.aluguel,
      desconto: camposDivida.desconto,
      juros: camposDivida.juros,
      multa: camposDivida.multa,
      condominio: camposDivida.condominio,
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

  const alteracoes = diffCampos(antes, c, LABELS_CONTRATO_INFO);
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

function openPagamento(dividaId) {
  const achado = encontrarDivida(dividaId);
  if (!achado) return;
  const { contrato: c, divida: d } = achado;
  document.getElementById('pagDividaId').value = d.id;
  document.getElementById('pagContratoInfo').textContent = `#${c.numero} — ${c.imovel} — ${c.inquilino} — Vencimento: ${formatDate(d.vencimento)} — Total: ${formatCurrency(d.total)}`;
  document.getElementById('pagData').value = todayStr();
  document.getElementById('pagDesconto').value = '';
  document.getElementById('pagMotivoDesconto').value = '';
  document.getElementById('pagCampoMotivoDesconto').classList.add('hidden');
  document.getElementById('pagValor').value = (d.total + calcAtrasoAtual(d)).toFixed(2);
  document.getElementById('pagForma').value = '';
  populatePessoaSelect(document.getElementById('pagQuemRecebeu'), c.quemRecebeu || '', 'Nenhum / outro');
  document.getElementById('pagObservacao').value = '';
  openModal('modalPagamento');
}

document.getElementById('pagDesconto').addEventListener('input', () => {
  const dividaId = document.getElementById('pagDividaId').value;
  const achado = encontrarDivida(dividaId);
  if (!achado) return;
  const { divida: d } = achado;
  const desconto = Number(document.getElementById('pagDesconto').value) || 0;
  const base = d.total + calcAtrasoAtual(d);
  document.getElementById('pagValor').value = Math.max(base - desconto, 0).toFixed(2);
  document.getElementById('pagCampoMotivoDesconto').classList.toggle('hidden', desconto <= 0);
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
  const pagamentos = [];
  c.dividas.forEach(d => d.pagamentos.forEach(p => pagamentos.push({ ...p, vencimentoDivida: d.vencimento, valorLiquido: valorLiquidoPagamento(c, d, p) })));
  pagamentos.sort((a, b) => a.data < b.data ? 1 : -1);

  if (!pagamentos.length) {
    list.innerHTML = '<div class="empty-state">Nenhum pagamento registrado ainda.</div>';
  } else {
    list.innerHTML = pagamentos.map(p => `
      <div class="card">
        <div class="contrato-grid">
          <div><span>Dívida (vencimento)</span><strong>${formatDate(p.vencimentoDivida)}</strong></div>
          <div><span>Data do pagamento</span><strong>${formatDate(p.data)}</strong></div>
          <div><span>Valor pago</span><strong>${formatCurrency(p.valor)}</strong></div>
          ${Math.abs(p.valorLiquido - p.valor) > 0.001 ? `<div><span>Valor líquido</span><strong>${formatCurrency(p.valorLiquido)}</strong></div>` : ''}
          ${p.desconto ? `<div><span>Desconto</span><strong>${formatCurrency(p.desconto)}</strong></div>` : ''}
          ${p.desconto && p.motivoDesconto ? `<div><span>Motivo do desconto</span><strong>${escapeHtml(p.motivoDesconto)}</strong></div>` : ''}
          <div><span>Forma de pagamento</span><strong>${escapeHtml(p.forma) || '--'}</strong></div>
          <div><span>Quem recebeu</span><strong>${escapeHtml(p.quemRecebeu) || '--'}</strong></div>
          <div><span>Observação</span><strong>${escapeHtml(p.observacao) || '--'}</strong></div>
        </div>
      </div>
    `).join('');
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
    const haystack = (c.inquilino + ' ' + c.imovel + ' #' + (c.numero || '')).toLowerCase();
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
  return state.contratos.filter(c => contratoPassaFiltro(c, filtros)).sort((a, b) => {
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

/* ===================== RENDER: CARD DE DÍVIDA (linha dentro do grupo) ===================== */
function dividaRowHtml(c, d) {
  const status = getStatus(d);
  const atrasoAtual = calcAtrasoAtual(d);
  return `
    <div class="divida-row status-${status}" data-divida-id="${d.id}">
      <div class="divida-row-top">
        <span class="divida-row-venc">${formatDate(d.vencimento)}</span>
        <span class="status-badge status-${status}">${statusLabel(status)}</span>
      </div>
      <div class="divida-row-valores">
        <div><span>Total</span><strong>${formatCurrency(d.total)}</strong></div>
        ${status === 'atrasado' ? `<div><span>Em atraso</span><strong class="text-danger">${formatCurrency(atrasoAtual)}</strong></div>` : ''}
        ${d.juros ? `<div><span>Juros</span><strong>${formatCurrency(d.juros)}</strong></div>` : ''}
        ${d.multa ? `<div><span>Multa</span><strong>${formatCurrency(d.multa)}</strong></div>` : ''}
        ${c.corretorNome ? `<div><span>Corretor (${c.corretorPercentual}%)</span><strong>${formatCurrency(d.aluguel * c.corretorPercentual / 100)}</strong></div>` : ''}
        ${d.dataPagamento ? `<div><span>Pago em</span><strong>${formatDate(d.dataPagamento)}</strong></div>` : ''}
      </div>
      ${d.observacao ? `<div class="contrato-sub">${icon('file-text')} ${escapeHtml(d.observacao)}</div>` : ''}
      <div class="divida-row-actions">
        ${status !== 'pago' ? `<button class="btn btn-success btn-sm" data-divida-action="pagar" data-divida-id="${d.id}">${icon('dollar')} Pagar</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-divida-action="editar" data-divida-id="${d.id}">${icon('pencil')} Editar</button>
        <button class="btn btn-danger btn-sm" data-divida-action="excluir" data-divida-id="${d.id}">${icon('trash')} Excluir</button>
      </div>
    </div>
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
          ${c.quemRecebeu ? `<div class="contrato-sub">Recebedor padrão: ${escapeHtml(c.quemRecebeu)}</div>` : ''}
          ${c.corretorNome ? `<div class="contrato-sub">${icon('user')} Corretor: ${escapeHtml(c.corretorNome)} (${c.corretorPercentual}% do aluguel — não somado ao total)</div>` : ''}
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
        ${dividasOrdenadas.length ? dividasOrdenadas.map(d => dividaRowHtml(c, d)).join('') : '<div class="empty-state">Nenhuma dívida cadastrada. Use "Atualizar dívidas" para gerar a próxima.</div>'}
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

/* ===================== RENDER: CARD SIMPLES DE DÍVIDA (Dashboard/Atrasos) =====================
 * Usado nas telas que listam dívidas "achatadas" (não agrupadas por contrato).
 */
function dividaCardHtml(item) {
  const status = getStatus(item);
  const atrasoAtual = calcAtrasoAtual(item);
  return `
    <div class="contrato-card status-${status}" data-divida-id="${item.id}">
      <div class="contrato-top">
        <div>
          <div class="contrato-title">#${item.numero || '--'} — ${escapeHtml(item.imovel)}</div>
          <div class="contrato-sub">${icon('user')} ${escapeHtml(item.inquilino)} · Vencimento: ${formatDate(item.vencimento)}</div>
        </div>
        <span class="status-badge status-${status}">${statusLabel(status)}</span>
      </div>
      <div class="contrato-grid">
        <div><span>Total</span><strong>${formatCurrency(item.total)}</strong></div>
        ${status === 'atrasado' ? `<div><span>Em atraso</span><strong class="text-danger">${formatCurrency(atrasoAtual)}</strong></div>` : ''}
        ${item.quemRecebeu ? `<div><span>Quem recebe</span><strong>${escapeHtml(item.quemRecebeu)}</strong></div>` : ''}
      </div>
      ${item.observacao ? `<div class="contrato-sub">${icon('file-text')} ${escapeHtml(item.observacao)}</div>` : ''}
      <div class="contrato-actions">
        ${status !== 'pago' ? `<button class="btn btn-success btn-sm" data-divida-action="pagar" data-divida-id="${item.id}">${icon('dollar')} Pagar</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-grupo-action="historico" data-contrato-id="${item.contratoId}">${icon('receipt')} Histórico</button>
        <button class="btn btn-ghost btn-sm" data-divida-action="editar" data-divida-id="${item.id}">${icon('pencil')} Editar</button>
      </div>
    </div>
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

  document.getElementById('statAtivos').textContent = ativos.length;
  document.getElementById('statAtraso').textContent = formatCurrency(totalAtraso);

  const pendentes = dividas.filter(d => getStatus(d) !== 'pago');
  const proximo = pendentes.slice().sort((a, b) => parseDate(a.vencimento) - parseDate(b.vencimento))[0];
  document.getElementById('statProximo').textContent = proximo ? formatDate(proximo.vencimento) : '--';

  const hoje = new Date();
  const despesasMes = state.despesas
    .filter(d => { const dt = parseDate(d.data); return dt.getFullYear() === hoje.getFullYear() && dt.getMonth() === hoje.getMonth(); })
    .reduce((sum, d) => sum + d.valor, 0);
  document.getElementById('statDespesasMesDashboard').textContent = formatCurrency(despesasMes);

  renderAlertaVencimento(ativos);
  renderAlertaReajuste();

  const recentes = dividas.slice().sort((a, b) => b.criadoEm - a.criadoEm).slice(0, 5);
  const recentList = document.getElementById('dashboardRecentList');
  recentList.innerHTML = recentes.length
    ? recentes.map(dividaCardHtml).join('')
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
  const pendentes = state.contratos.filter(precisaReajuste);

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
  list.innerHTML = atrasados.map(dividaCardHtml).join('');
  bindDividaCardActions(list);
}

/* ===================== RENDER: HISTÓRICO ===================== */
function populateHistoricoFilter() {
  const select = document.getElementById('historicoFiltroContrato');
  const current = select.value;
  select.innerHTML = '<option value="">Todos os contratos</option>' +
    state.contratos.map(c => `<option value="${c.id}">${escapeHtml(c.imovel)} — ${escapeHtml(c.inquilino)}</option>`).join('');
  select.value = current || '';
}

function renderHistorico() {
  populateHistoricoFilter();
  const filtroId = document.getElementById('historicoFiltroContrato').value;
  const list = document.getElementById('historicoList');

  let entries = [];
  state.contratos.forEach(c => {
    if (filtroId && c.id !== filtroId) return;
    c.dividas.forEach(d => d.pagamentos.forEach(p => entries.push({ ...p, contrato: c, divida: d })));
  });
  entries.sort((a, b) => parseDate(b.data) - parseDate(a.data));

  if (!entries.length) {
    list.innerHTML = '<div class="empty-state">Nenhum pagamento registrado ainda.</div>';
    return;
  }

  list.innerHTML = entries.map(e => {
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
        <div><span>Forma de pagamento</span><strong>${escapeHtml(e.forma) || '--'}</strong></div>
        <div><span>Quem recebeu</span><strong>${escapeHtml(e.quemRecebeu) || '--'}</strong></div>
        <div><span>Observação</span><strong>${escapeHtml(e.observacao) || '--'}</strong></div>
      </div>
    </div>
  `;
  }).join('');
}

document.getElementById('historicoFiltroContrato').addEventListener('change', renderHistorico);

/* ===================== DESPESAS =====================
 * Lançamentos simples de despesa (data, descrição, valor), opcionalmente
 * ligados a um contrato. Consultáveis por mês (filtro de mês) e por ano
 * (filtro de ano, com total do ano sempre visível independente do mês).
 */
const formDespesa = document.getElementById('formDespesa');

function populateDespesaContratoSelect() {
  const select = document.getElementById('despContrato');
  const current = select.value;
  select.innerHTML = '<option value="">Nenhum (despesa geral)</option>' +
    state.contratos.map(c => `<option value="${c.id}">${escapeHtml(c.imovel)} — ${escapeHtml(c.inquilino)}</option>`).join('');
  select.value = current || '';
}

function populateDespesaAnoFilter() {
  const select = document.getElementById('despesaFiltroAno');
  const anos = new Set(state.despesas.map(d => parseDate(d.data).getFullYear()));
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

function renderDespesas() {
  if (!document.getElementById('despData').value) document.getElementById('despData').value = todayStr();
  populateDespesaContratoSelect();
  populateDespesaAnoFilter();

  const ano = Number(document.getElementById('despesaFiltroAno').value);
  const mes = document.getElementById('despesaFiltroMes').value;

  const doAno = state.despesas.filter(d => parseDate(d.data).getFullYear() === ano);
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
          <div class="contrato-sub">${icon('calendar')} ${formatDate(d.data)}${d.contratoId ? ` · ${icon('user')} ${escapeHtml(despesaContratoLabel(d.contratoId))}` : ' · Despesa geral'}</div>
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
  document.getElementById('formDespesaTitle').textContent = 'Editar despesa';
  document.getElementById('btnSalvarDespesa').textContent = 'Salvar alterações';
  document.getElementById('btnCancelarEdicaoDespesa').classList.remove('hidden');
  document.getElementById('despDescricao').focus();
}

function cancelarEdicaoDespesa() {
  document.getElementById('despesaId').value = '';
  formDespesa.reset();
  document.getElementById('despData').value = todayStr();
  document.getElementById('formDespesaTitle').textContent = 'Nova despesa';
  document.getElementById('btnSalvarDespesa').textContent = 'Adicionar despesa';
  document.getElementById('btnCancelarEdicaoDespesa').classList.add('hidden');
}

document.getElementById('btnCancelarEdicaoDespesa').addEventListener('click', cancelarEdicaoDespesa);

formDespesa.addEventListener('submit', (e) => {
  e.preventDefault();
  const despesaId = document.getElementById('despesaId').value;
  const data = document.getElementById('despData').value;
  const descricao = document.getElementById('despDescricao').value.trim();
  const valor = Number(document.getElementById('despValor').value) || 0;
  const contratoId = document.getElementById('despContrato').value || null;
  if (!data || !descricao || valor <= 0) return;

  if (despesaId) {
    const d = state.despesas.find(x => x.id === despesaId);
    if (!d) return;
    const antes = Object.assign({}, d);
    Object.assign(d, { data, descricao, valor, contratoId });
    const alteracoes = diffCampos(antes, d, LABELS_DESPESA);
    registrarAuditoria('despesa_editada', `Despesa editada: ${descricao} (${formatCurrency(valor)})`, alteracoes);
    saveState();
    cancelarEdicaoDespesa();
    renderDespesas();
    showToast('Despesa atualizada com sucesso.', 'success');
  } else {
    state.despesas.push({ id: uuid(), data, descricao, valor, contratoId, criadoEm: Date.now() });
    registrarAuditoria('despesa_criada', `Despesa registrada: ${descricao} (${formatCurrency(valor)})`);
    saveState();
    const dataAtual = data;
    formDespesa.reset();
    document.getElementById('despData').value = dataAtual;
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
  document.getElementById('accUsername').value = currentUsername;
  renderPessoasConfig();
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
  selectEl.innerHTML = `<option value="">${placeholder}</option>` +
    state.pessoas.map(p => `<option value="${escapeHtml(p.nome)}">${escapeHtml(p.nome)}</option>`).join('');
  // se o valor atual não estiver na lista (pessoa removida do cadastro depois
  // de já usada num contrato/pagamento), mantém mostrando o nome mesmo assim
  if (atual && !state.pessoas.some(p => p.nome === atual)) {
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
  if (!state.pessoas.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma pessoa cadastrada ainda.</div>';
    return;
  }
  list.innerHTML = state.pessoas.map(p => `
    <div class="card">
      <div class="contrato-top">
        <div class="contrato-title">${escapeHtml(p.nome)}</div>
        <button type="button" class="btn btn-danger btn-sm" data-remove-pessoa="${p.id}">${icon('trash')} Remover</button>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('[data-remove-pessoa]').forEach(btn => {
    btn.addEventListener('click', () => removePessoa(btn.dataset.removePessoa));
  });
}

function removePessoa(id) {
  const p = state.pessoas.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Remover "${p.nome}" da lista de pessoas? Contratos/pagamentos que já usam esse nome não são afetados.`)) return;
  state.pessoas = state.pessoas.filter(x => x.id !== id);
  saveState();
  renderPessoasConfig();
  showToast('Pessoa removida.', 'success');
}

addPessoaForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const nomeInput = document.getElementById('newPessoaNome');
  const nome = nomeInput.value.trim();
  if (!nome) return;
  if (state.pessoas.some(p => p.nome.toLowerCase() === nome.toLowerCase())) {
    showToast('Já existe uma pessoa cadastrada com esse nome.', 'error');
    return;
  }
  state.pessoas.push({ id: uuid(), nome });
  saveState();
  nomeInput.value = '';
  renderPessoasConfig();
  showToast('Pessoa adicionada com sucesso.', 'success');
});

/* ===================== IMÓVEIS (cadastro reutilizável) ===================== */
const formImovel = document.getElementById('formImovel');

function populateImovelSelect(selectEl, valorAtual) {
  const atual = valorAtual || '';
  selectEl.innerHTML = '<option value="" disabled' + (atual ? '' : ' selected') + '>Selecione um imóvel...</option>' +
    state.imoveis.map(i => `<option value="${escapeHtml(i.nome)}">${escapeHtml(i.nome)}</option>`).join('');
  // se o valor atual não estiver na lista (imóvel removido do cadastro depois
  // de já usado num contrato), mantém mostrando o nome mesmo assim
  if (atual && !state.imoveis.some(i => i.nome === atual)) {
    selectEl.innerHTML += `<option value="${escapeHtml(atual)}">${escapeHtml(atual)}</option>`;
  }
  selectEl.value = atual;
}

function renderImoveis() {
  const list = document.getElementById('imoveisList');
  if (!state.imoveis.length) {
    list.innerHTML = '<div class="empty-state">Nenhum imóvel cadastrado ainda.</div>';
    return;
  }
  list.innerHTML = state.imoveis.map(i => `
    <div class="card">
      <div class="contrato-top">
        <div class="contrato-title">${escapeHtml(i.nome)}</div>
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
  saveState();
  renderImoveis();
  showToast('Imóvel removido.', 'success');
}

// Diferente de remover, editar o nome ATUALIZA também os contratos que já usam
// essa descrição (já que aqui a intenção normal é corrigir um erro de digitação,
// não trocar de imóvel) — a lista de imóveis é só um cadastro por nome, sem um
// vínculo por id com o contrato.
function editarImovel(id) {
  const i = state.imoveis.find(x => x.id === id);
  if (!i) return;
  const novoNome = prompt('Editar descrição do imóvel:', i.nome);
  if (novoNome === null) return;
  const nome = novoNome.trim();
  if (!nome) { showToast('A descrição do imóvel não pode ficar vazia.', 'error'); return; }
  if (nome === i.nome) return;
  if (state.imoveis.some(x => x.id !== id && x.nome.toLowerCase() === nome.toLowerCase())) {
    showToast('Já existe um imóvel cadastrado com essa descrição.', 'error');
    return;
  }

  const nomeAntigo = i.nome;
  i.nome = nome;
  let contratosAtualizados = 0;
  state.contratos.forEach(c => {
    if (c.imovel === nomeAntigo) { c.imovel = nome; contratosAtualizados++; }
  });

  registrarAuditoria(
    'imovel_editado',
    `Imóvel renomeado: "${nomeAntigo}" → "${nome}"${contratosAtualizados ? ` (${contratosAtualizados} contrato(s) atualizado(s))` : ''}`,
    [{ campo: 'Descrição do imóvel', de: nomeAntigo, para: nome }]
  );
  saveState();
  renderAll();
  showToast('Imóvel atualizado com sucesso.', 'success');
}

formImovel.addEventListener('submit', (e) => {
  e.preventDefault();
  const nomeInput = document.getElementById('newImovelNome');
  const nome = nomeInput.value.trim();
  if (!nome) return;
  if (state.imoveis.some(i => i.nome.toLowerCase() === nome.toLowerCase())) {
    showToast('Já existe um imóvel cadastrado com essa descrição.', 'error');
    return;
  }
  state.imoveis.push({ id: uuid(), nome });
  saveState();
  nomeInput.value = '';
  renderImoveis();
  showToast('Imóvel adicionado com sucesso.', 'success');
});

/* ===================== CONTA (usuário/senha) ===================== */
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
    state.auditoria = state.auditoria || [];
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
  state = { contratos: [], config: { taxaJurosMensal: 1, taxaMultaPercent: 2, corretorPercentualPadrao: 5, percentualReajusteSugerido: 5 }, auditoria: [], pessoas: [], despesas: [], imoveis: [] };
  await saveState();
  renderAll();
  showToast('Todos os dados foram excluídos.', 'success');
});

/* ===================== CHARTS (canvas nativo) ===================== */
// O canvas não lê as variáveis de font-size do CSS — por isso os tamanhos de
// fonte dos gráficos ficam centralizados aqui (mesma escala usada no resto do
// site: 13px = --text-sm, o piso de legibilidade adotado nos gráficos).
const CHART_FONT = '13px sans-serif';
const CHART_FONT_BOLD = 'bold 13px sans-serif';
const CHART_FONT_LG_BOLD = 'bold 22px sans-serif';

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function ultimosMeses(n) {
  const now = new Date();
  const months = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth(), label: MESES_PT[d.getMonth()].slice(0, 3) + '/' + String(d.getFullYear()).slice(2) });
  }
  return months;
}

function setupCanvas(canvas) {
  const w = canvas.clientWidth || 600;
  const h = canvas.height;
  canvas.width = w;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function drawChartEmptyState(ctx, w, h, texto) {
  ctx.fillStyle = cssVar('--text-faint');
  ctx.font = CHART_FONT;
  ctx.textAlign = 'center';
  ctx.fillText(texto, w / 2, h / 2);
}

function renderCharts() {
  renderStatusChart();
  renderFormaPagamentoChart();
  renderAtrasoEvolucaoChart();
  renderReceitaMensalChart();
  renderDespesasMensalChart();
  renderInadimplenciaChart();
}

/* ---- Donut chart genérico (legenda renderizada em HTML ao lado) ---- */
function renderDonutChart(canvasId, legendId, data, centerValue, centerLabel) {
  const canvas = document.getElementById(canvasId);
  const legendEl = document.getElementById(legendId);
  const { ctx, w, h } = setupCanvas(canvas);

  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total <= 0) {
    drawChartEmptyState(ctx, w, h, 'Sem dados ainda');
    legendEl.innerHTML = '';
    return;
  }

  const cx = w / 2;
  const cy = h / 2;
  const outerR = Math.min(w, h) / 2 - 10;
  const innerR = outerR * 0.62;

  let anguloAtual = -Math.PI / 2;
  data.filter(d => d.value > 0).forEach(d => {
    const fatia = (d.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerR, anguloAtual, anguloAtual + fatia);
    ctx.closePath();
    ctx.fillStyle = d.color;
    ctx.fill();
    anguloAtual += fatia;
  });

  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  ctx.fillStyle = cssVar('--text');
  ctx.font = CHART_FONT_LG_BOLD;
  ctx.textAlign = 'center';
  ctx.fillText(centerValue, cx, cy - 2);
  ctx.fillStyle = cssVar('--text-dim');
  ctx.font = CHART_FONT;
  ctx.fillText(centerLabel, cx, cy + 18);

  legendEl.innerHTML = data.map(d => `
    <div class="chart-legend-item">
      <span class="chart-legend-dot" style="background:${d.color}"></span>
      <span>${escapeHtml(d.label)}: <strong>${d.displayValue}</strong></span>
    </div>
  `).join('');
}

function renderStatusChart() {
  const dividas = todasDividas();
  const counts = { ativo: 0, atrasado: 0, pago: 0 };
  dividas.forEach(d => counts[getStatus(d)]++);
  const total = counts.ativo + counts.atrasado + counts.pago;

  const data = [
    { label: 'Ativos', value: counts.ativo, color: cssVar('--accent'), displayValue: String(counts.ativo) },
    { label: 'Atrasados', value: counts.atrasado, color: cssVar('--danger'), displayValue: String(counts.atrasado) },
    { label: 'Pagos', value: counts.pago, color: cssVar('--success'), displayValue: String(counts.pago) },
  ];
  renderDonutChart('chartStatus', 'legendStatus', data, String(total), total === 1 ? 'dívida' : 'dívidas');
}

function renderFormaPagamentoChart() {
  const totais = {};
  todasDividas().forEach(d => d.pagamentos.forEach(p => {
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
  renderDonutChart('chartFormaPagamento', 'legendFormaPagamento', data, formatCurrency(totalGeral).replace('R$', '').trim(), 'recebido');
}

/* ---- Trend chart genérico (linha + área, com gridlines) ---- */
function renderTrendChart(canvasId, months, values, colorVarName) {
  const canvas = document.getElementById(canvasId);
  const { ctx, w, h } = setupCanvas(canvas);
  const color = cssVar(colorVarName);
  const gridColor = cssVar('--border');
  const textColor = cssVar('--text-dim');

  const paddingLeft = 8;
  const paddingRight = 8;
  const paddingTop = 24;
  const paddingBottom = 34;
  const chartW = w - paddingLeft - paddingRight;
  const chartH = h - paddingTop - paddingBottom;
  const max = Math.max(1, ...values);

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const y = paddingTop + (chartH / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(w - paddingRight, y);
    ctx.stroke();
  }

  const stepX = values.length > 1 ? chartW / (values.length - 1) : 0;
  const points = values.map((v, i) => ({
    x: paddingLeft + stepX * i,
    y: paddingTop + chartH - (v / max) * chartH,
    v,
  }));

  if (points.length) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, paddingTop + chartH);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, paddingTop + chartH);
    ctx.closePath();
    ctx.fillStyle = color + '26';
    ctx.fill();
  }

  ctx.beginPath();
  points.forEach((p, i) => { i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.font = CHART_FONT;
    ctx.textAlign = 'center';
    if (p.v > 0) {
      ctx.fillStyle = textColor;
      ctx.fillText(formatCurrency(p.v).replace('R$', '').trim(), p.x, Math.max(p.y - 10, 12));
    }
    ctx.fillStyle = textColor;
    ctx.fillText(months[i].label, p.x, h - 10);
  });
}

function renderAtrasoEvolucaoChart() {
  const months = ultimosMeses(6);
  const dividas = todasDividas();
  const values = months.map(m => dividas.reduce((sum, d) => {
    const venc = parseDate(d.vencimento);
    if (venc.getFullYear() === m.year && venc.getMonth() === m.month && getStatus(d) === 'atrasado') {
      return sum + d.total + calcAtrasoAtual(d);
    }
    return sum;
  }, 0));
  renderTrendChart('chartAtrasoEvolucao', months, values, '--danger');
}

// Valores líquidos (já descontando corretor e condomínio), mesma convenção usada em
// Relatórios — o que efetivamente fica com o proprietário, não o valor bruto cobrado.
function renderReceitaMensalChart() {
  const months = ultimosMeses(6);
  const dividas = todasDividas();
  const values = months.map(m => dividas.reduce((sum, d) => {
    const pagoNoMes = d.pagamentos
      .filter(p => {
        const dt = parseDate(p.data);
        return dt.getFullYear() === m.year && dt.getMonth() === m.month;
      })
      .reduce((s, p) => s + valorLiquidoPagamento(d, d, p), 0);
    return sum + pagoNoMes;
  }, 0));
  renderTrendChart('chartReceitaMensal', months, values, '--success');
}

function renderDespesasMensalChart() {
  const months = ultimosMeses(6);
  const values = months.map(m => state.despesas.reduce((sum, d) => {
    const dt = parseDate(d.data);
    return (dt.getFullYear() === m.year && dt.getMonth() === m.month) ? sum + d.valor : sum;
  }, 0));
  renderTrendChart('chartDespesasMensal', months, values, '--warn');
}

/* ---- Barras horizontais genérico (ranking, ex: quem mais atrasa) ---- */
function renderHorizontalBarChart(canvasId, entries, colorVarName) {
  const canvas = document.getElementById(canvasId);
  const { ctx, w, h } = setupCanvas(canvas);
  const color = cssVar(colorVarName);
  const textColor = cssVar('--text-dim');
  const valueColor = cssVar('--text');

  if (!entries.length) {
    drawChartEmptyState(ctx, w, h, 'Nenhuma dívida em atraso');
    return;
  }

  const max = Math.max(...entries.map(en => en.value));
  const paddingTop = 8;
  const barGap = 10;
  const labelWidth = 110;
  const barHeight = Math.max(10, Math.min(26, (h - paddingTop) / entries.length - barGap));

  ctx.font = CHART_FONT;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  entries.forEach((entry, i) => {
    const y = paddingTop + i * (barHeight + barGap);
    ctx.fillStyle = textColor;
    ctx.fillText(truncateText(ctx, entry.label, labelWidth - 8), 0, y + barHeight / 2);

    const barX = labelWidth;
    const barMaxWidth = w - barX - 70;
    const barWidth = max > 0 ? (entry.value / max) * barMaxWidth : 0;

    ctx.fillStyle = color;
    ctx.fillRect(barX, y, Math.max(barWidth, 2), barHeight);

    ctx.fillStyle = valueColor;
    ctx.font = CHART_FONT_BOLD;
    ctx.fillText(formatCurrency(entry.value).replace('R$', '').trim(), barX + barWidth + 8, y + barHeight / 2);
    ctx.font = CHART_FONT;
  });
}

function renderInadimplenciaChart() {
  const agrupador = document.getElementById('inadimplenciaAgrupador').value;
  const atrasadas = todasDividas().filter(d => getStatus(d) === 'atrasado');
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

document.getElementById('inadimplenciaAgrupador').addEventListener('change', renderInadimplenciaChart);

window.addEventListener('resize', () => {
  const graficosTab = document.getElementById('tab-graficos');
  if (graficosTab.classList.contains('active')) renderCharts();
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

function renderRelatorios() {
  populateRelatorioAnoFilter();
  const ano = Number(document.getElementById('relatorioAno').value);
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

    const totalDespesas = state.despesas
      .filter(d => { const dt = parseDate(d.data); return dt.getFullYear() === ano && dt.getMonth() === mesIndex; })
      .reduce((sum, d) => sum + d.valor, 0);

    totalPagoAno += totalPago;
    totalAtrasoAno += totalAtraso;
    totalDespesasAno += totalDespesas;

    return { nomeMes, totalPago, totalAtraso, totalDespesas, count: dividasPeriodo.length };
  });

  document.getElementById('relatorioTotalPagoAno').textContent = formatCurrency(totalPagoAno);
  document.getElementById('relatorioTotalAtrasoAno').textContent = formatCurrency(totalAtrasoAno);
  document.getElementById('relatorioTotalDespesasAno').textContent = formatCurrency(totalDespesasAno);
  document.getElementById('relatorioLucroLiquidoAno').textContent = formatCurrency(totalPagoAno - totalDespesasAno);

  document.getElementById('relatorioTabelaBody').innerHTML = linhas.map(l => `
    <tr>
      <td>${l.nomeMes}</td>
      <td>${formatCurrency(l.totalPago)}</td>
      <td>${formatCurrency(l.totalDespesas)}</td>
      <td class="${l.totalAtraso > 0 ? 'text-danger' : ''}">${formatCurrency(l.totalAtraso)}</td>
      <td>${l.count}</td>
    </tr>
  `).join('');

  const pagamentosDoAno = [];
  dividas.forEach(d => d.pagamentos.forEach(p => {
    if (parseDate(p.data).getFullYear() === ano) pagamentosDoAno.push({ ...p, valorLiquido: valorLiquidoPagamento(d, d, p) });
  }));

  const totalDescontoAno = pagamentosDoAno.reduce((sum, p) => sum + (p.desconto || 0), 0);
  document.getElementById('relatorioTotalDescontoAno').textContent = formatCurrency(totalDescontoAno);

  const porForma = {};
  pagamentosDoAno.forEach(p => {
    const forma = p.forma || 'Não informado';
    if (!porForma[forma]) porForma[forma] = { count: 0, total: 0 };
    porForma[forma].count++;
    porForma[forma].total += p.valorLiquido;
  });

  const formaBody = document.getElementById('relatorioFormaPagamentoBody');
  const formas = Object.keys(porForma);
  if (!formas.length) {
    formaBody.innerHTML = '<tr><td colspan="3">Nenhum pagamento registrado neste ano.</td></tr>';
  } else {
    formaBody.innerHTML = formas.map(forma => `
      <tr>
        <td>${escapeHtml(forma)}</td>
        <td>${porForma[forma].count}</td>
        <td>${formatCurrency(porForma[forma].total)}</td>
      </tr>
    `).join('');
  }

  renderComparativoAnual(ano);
}

function renderComparativoAnual(anoSelecionado) {
  const dividas = todasDividas();
  const anos = new Set(dividas.map(d => parseDate(d.vencimento).getFullYear()));
  dividas.forEach(d => d.pagamentos.forEach(p => anos.add(parseDate(p.data).getFullYear())));
  anos.add(new Date().getFullYear());
  const sorted = Array.from(anos).sort((a, b) => b - a);

  const linhas = sorted.map(ano => {
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

    const totalDespesas = state.despesas
      .filter(d => parseDate(d.data).getFullYear() === ano)
      .reduce((sum, d) => sum + d.valor, 0);

    return { ano, totalPago, totalAtraso, totalDespesas, count: dividasAno.length };
  });

  document.getElementById('comparativoAnualBody').innerHTML = linhas.map(l => `
    <tr class="${l.ano === anoSelecionado ? 'is-current' : ''}">
      <td>${l.ano}</td>
      <td>${formatCurrency(l.totalPago)}</td>
      <td>${formatCurrency(l.totalDespesas)}</td>
      <td class="${l.totalAtraso > 0 ? 'text-danger' : ''}">${formatCurrency(l.totalAtraso)}</td>
      <td>${l.count}</td>
    </tr>
  `).join('');
}

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

  const celulas = [];
  for (let i = 0; i < primeiroDiaSemana; i++) {
    celulas.push({ dia: diasNoMesAnterior - primeiroDiaSemana + 1 + i, outside: true });
  }
  for (let d = 1; d <= diasNoMes; d++) {
    celulas.push({ dia: d, outside: false });
  }
  while (celulas.length % 7 !== 0) {
    celulas.push({ dia: celulas.length, outside: true });
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
      const cor = st === 'atrasado' ? 'var(--danger)' : st === 'pago' ? 'var(--success)' : 'var(--accent)';
      dots.push(`<span class="calendar-dot" style="background:${cor}"></span>`);
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
function downloadCsv(filename, headers, rows) {
  const csvContent = [headers, ...rows]
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

document.getElementById('btnExportCSV').addEventListener('click', () => {
  const dividas = getFilteredDividasFlat();
  if (!dividas.length) { showToast('Nenhuma dívida para exportar.', 'error'); return; }

  const headers = ['Nº Contrato', 'Vencimento', 'Imóvel', 'Inquilino', 'Aluguel', 'Desconto', 'Juros', 'Multa', 'Condomínio', 'Total', 'Valor em Atraso', 'Status', 'Quem Recebe', 'Observação'];
  const rows = dividas.map(d => [
    d.numero || '',
    formatDate(d.vencimento),
    d.imovel,
    d.inquilino,
    d.aluguel.toFixed(2),
    d.desconto.toFixed(2),
    d.juros.toFixed(2),
    d.multa.toFixed(2),
    d.condominio.toFixed(2),
    d.total.toFixed(2),
    calcAtrasoAtual(d).toFixed(2),
    statusLabel(getStatus(d)),
    d.quemRecebeu || '',
    d.observacao || '',
  ]);

  downloadCsv(`contratos_${todayStr()}.csv`, headers, rows);
  showToast('CSV exportado com sucesso.', 'success');
});

document.getElementById('btnExportHistoricoContrato').addEventListener('click', () => {
  const c = state.contratos.find(x => x.id === historicoContratoAtualId);
  if (!c) return;
  const pagamentos = [];
  c.dividas.forEach(d => d.pagamentos.forEach(p => pagamentos.push({ ...p, vencimentoDivida: d.vencimento, valorLiquido: valorLiquidoPagamento(c, d, p) })));
  if (!pagamentos.length) { showToast('Nenhum pagamento para exportar.', 'error'); return; }

  const headers = ['Dívida (Vencimento)', 'Data do Pagamento', 'Valor Pago', 'Valor Líquido', 'Desconto', 'Motivo do Desconto', 'Forma de Pagamento', 'Quem Recebeu', 'Observação'];
  const rows = pagamentos.map(p => [
    formatDate(p.vencimentoDivida),
    formatDate(p.data),
    p.valor.toFixed(2),
    p.valorLiquido.toFixed(2),
    (p.desconto || 0).toFixed(2),
    p.motivoDesconto || '',
    p.forma || '',
    p.quemRecebeu || '',
    p.observacao || '',
  ]);

  const nomeArquivo = `pagamentos_${c.imovel.replace(/[^a-z0-9]+/gi, '_')}_${todayStr()}.csv`;
  downloadCsv(nomeArquivo, headers, rows);
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
      // em Atraso, Status, Quem Recebe, Observação
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

/* ===================== EXPORT PDF (canvas + impressão do navegador) ===================== */
document.getElementById('btnExportPDF').addEventListener('click', () => {
  const dividas = getFilteredDividasFlat();
  if (!dividas.length) { showToast('Nenhuma dívida para exportar.', 'error'); return; }

  const canvas = document.getElementById('hiddenReportCanvas');
  const rowHeight = 26;
  const headerHeight = 90;
  const footerPad = 30;
  canvas.width = 900;
  canvas.height = headerHeight + rowHeight * (dividas.length + 1) + footerPad;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#111111';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('Relatório de Contratos de Aluguel', 20, 36);
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#555555';
  ctx.fillText('Gerado em ' + formatDate(todayStr()), 20, 58);

  const cols = [
    { key: 'vencimento', label: 'Vencimento', x: 20, w: 90 },
    { key: 'imovel', label: 'Imóvel', x: 110, w: 200 },
    { key: 'inquilino', label: 'Inquilino', x: 310, w: 140 },
    { key: 'total', label: 'Total', x: 450, w: 90 },
    { key: 'atraso', label: 'Em Atraso', x: 540, w: 90 },
    { key: 'status', label: 'Status', x: 630, w: 90 },
    { key: 'quemRecebeu', label: 'Quem Recebe', x: 720, w: 160 },
  ];

  let y = headerHeight;
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#111111';
  cols.forEach(col => ctx.fillText(col.label, col.x, y));
  y += 8;
  ctx.strokeStyle = '#cccccc';
  ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(880, y); ctx.stroke();
  y += rowHeight - 8;

  ctx.font = '11px sans-serif';
  dividas.forEach(d => {
    const status = getStatus(d);
    const values = {
      vencimento: formatDate(d.vencimento),
      imovel: truncateText(ctx, d.imovel, 190),
      inquilino: truncateText(ctx, d.inquilino, 130),
      total: formatCurrency(d.total),
      atraso: status === 'atrasado' ? formatCurrency(calcAtrasoAtual(d)) : '--',
      status: statusLabel(status),
      quemRecebeu: truncateText(ctx, d.quemRecebeu || '--', 150),
    };
    ctx.fillStyle = '#222222';
    cols.forEach(col => ctx.fillText(values[col.key], col.x, y));
    y += rowHeight;
  });

  const imgData = canvas.toDataURL('image/png');
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <html><head><title>Relatório de Contratos</title>
    <style>body{margin:0;display:flex;justify-content:center;background:#fff;} img{max-width:100%;}</style>
    </head><body>
    <img src="${imgData}" onload="window.print();">
    </body></html>
  `);
  printWindow.document.close();
  showToast('Relatório gerado. Use "Salvar como PDF" na janela de impressão.', 'success');
});

function truncateText(ctx, text, maxWidth) {
  text = text || '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 0 && ctx.measureText(text + '…').width > maxWidth) {
    text = text.slice(0, -1);
  }
  return text + '…';
}

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
