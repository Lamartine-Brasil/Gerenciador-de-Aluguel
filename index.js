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
let state = { contratos: [], config: { taxaJurosMensal: 1, taxaMultaPercent: 2, jurosPadrao: 0, multaPadrao: 0, corretorPercentualPadrao: 5 }, auditoria: [], corretores: [] };
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
  data.config = Object.assign({ taxaJurosMensal: 1, taxaMultaPercent: 2, jurosPadrao: 0, multaPadrao: 0, corretorPercentualPadrao: 5 }, data.config || {});
  data.auditoria = data.auditoria || [];
  data.corretores = data.corretores || [];
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

function registrarAuditoria(acao, descricao) {
  state.auditoria = state.auditoria || [];
  state.auditoria.push({
    id: uuid(),
    timestamp: Date.now(),
    usuario: currentUsername || '--',
    acao,
    descricao,
  });
  if (state.auditoria.length > AUDITORIA_MAX) {
    state.auditoria = state.auditoria.slice(-AUDITORIA_MAX);
  }
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
        imovel: c.imovel,
        inquilino: c.inquilino,
        quemRecebeu: c.quemRecebeu,
        anexoContrato: c.anexoContrato,
        dataInicio: c.dataInicio,
        diaPagamento: c.diaPagamento,
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

function updateTotalPreview() {
  const total = calcTotal({
    aluguel: document.getElementById('fAluguel').value,
    desconto: document.getElementById('fDesconto').value,
    juros: document.getElementById('fJuros').value,
    multa: document.getElementById('fMulta').value,
    condominio: document.getElementById('fCondominio').value,
  });
  document.getElementById('fTotalPreview').textContent = formatCurrency(total);
}

['fAluguel', 'fDesconto', 'fJuros', 'fMulta', 'fCondominio'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateTotalPreview);
});

document.getElementById('btnNovoContrato').addEventListener('click', () => {
  formContrato.reset();
  document.getElementById('contratoId').value = '';
  document.getElementById('dividaId').value = '';
  document.getElementById('modalContratoTitle').textContent = 'Novo contrato';
  document.getElementById('fDataInicio').value = todayStr();
  document.getElementById('fDiaPagamento').value = new Date().getDate();
  document.getElementById('fJuros').value = state.config.jurosPadrao || '';
  document.getElementById('fMulta').value = state.config.multaPadrao || '';
  document.getElementById('fCampoDataInicio').classList.remove('hidden');
  document.getElementById('fCampoDiaPagamento').classList.remove('hidden');
  document.getElementById('fCampoImovel').classList.remove('hidden');
  document.getElementById('fCampoInquilino').classList.remove('hidden');
  document.getElementById('fCampoQuemRecebeu').classList.remove('hidden');
  document.getElementById('fCampoVencimento').classList.add('hidden');
  document.getElementById('fCampoCorretorNome').classList.remove('hidden');
  document.getElementById('fCampoCorretorPercentual').classList.remove('hidden');
  populateCorretorSelect(document.getElementById('fCorretorNome'), '');
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
  document.getElementById('fCampoCorretorNome').classList.add('hidden');
  document.getElementById('fCampoCorretorPercentual').classList.add('hidden');
  document.getElementById('fCorretorHint').classList.add('hidden');
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

  const camposDivida = {
    aluguel: Number(document.getElementById('fAluguel').value) || 0,
    desconto: Number(document.getElementById('fDesconto').value) || 0,
    juros: Number(document.getElementById('fJuros').value) || 0,
    multa: Number(document.getElementById('fMulta').value) || 0,
    condominio: Number(document.getElementById('fCondominio').value) || 0,
    valorAtrasoBase: Number(document.getElementById('fValorAtraso').value) || 0,
    observacao: document.getElementById('fObservacao').value.trim(),
  };
  camposDivida.total = calcTotal(camposDivida);

  if (dividaId) {
    const achado = encontrarDivida(dividaId);
    if (!achado) return;
    const { contrato: c, divida: d } = achado;
    d.vencimento = document.getElementById('fVencimento').value;
    Object.assign(d, camposDivida);
    registrarAuditoria('divida_editada', `Dívida editada: ${c.imovel} - ${c.inquilino} (${formatDate(d.vencimento)})`);
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
  document.getElementById('infoImovel').value = c.imovel;
  document.getElementById('infoInquilino').value = c.inquilino;
  document.getElementById('infoQuemRecebeu').value = c.quemRecebeu || '';
  document.getElementById('infoContratoSubtitle').textContent = c.dataInicio
    ? `Início do contrato: ${formatDate(c.dataInicio)}, todo dia ${c.diaPagamento}`
    : '';

  populateCorretorSelect(document.getElementById('infoCorretorNome'), c.corretorNome || '');
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

formContratoInfo.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('infoContratoId').value;
  const c = state.contratos.find(x => x.id === id);
  if (!c) return;
  c.imovel = document.getElementById('infoImovel').value.trim();
  c.inquilino = document.getElementById('infoInquilino').value.trim();
  c.quemRecebeu = document.getElementById('infoQuemRecebeu').value.trim();
  c.corretorNome = document.getElementById('infoCorretorNome').value;
  c.corretorPercentual = Number(document.getElementById('infoCorretorPercentual').value) || 0;

  registrarAuditoria('contrato_editado', `Contrato editado: ${c.imovel} - ${c.inquilino}`);
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
  document.getElementById('reajusteNovoValor').value = '';
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
  let dividasAtualizadas = 0;
  c.dividas.forEach(d => {
    if (!d.pago) {
      d.aluguel = novoValor;
      d.total = calcTotal(d);
      dividasAtualizadas++;
    }
  });

  registrarAuditoria('contrato_reajustado', `Aluguel reajustado: ${c.imovel} - ${c.inquilino} de ${formatCurrency(valorAntigo)} para ${formatCurrency(novoValor)} (${dividasAtualizadas} dívida(s) em aberto atualizada(s))`);
  saveState();
  closeModal('modalReajuste');
  renderAll();
  showToast('Reajuste aplicado com sucesso.', 'success');
});

/* ===================== PAGAMENTO ===================== */
const formPagamento = document.getElementById('formPagamento');

function openPagamento(dividaId) {
  const achado = encontrarDivida(dividaId);
  if (!achado) return;
  const { contrato: c, divida: d } = achado;
  document.getElementById('pagDividaId').value = d.id;
  document.getElementById('pagContratoInfo').textContent = `${c.imovel} — ${c.inquilino} — Vencimento: ${formatDate(d.vencimento)} — Total: ${formatCurrency(d.total)}`;
  document.getElementById('pagData').value = todayStr();
  document.getElementById('pagDesconto').value = '';
  document.getElementById('pagValor').value = (d.total + calcAtrasoAtual(d)).toFixed(2);
  document.getElementById('pagForma').value = '';
  document.getElementById('pagQuemRecebeu').value = c.quemRecebeu || '';
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
  document.getElementById('histContratoInfo').textContent = `${c.imovel} — ${c.inquilino}`;
  const list = document.getElementById('histContratoList');
  const pagamentos = [];
  c.dividas.forEach(d => d.pagamentos.forEach(p => pagamentos.push({ ...p, vencimentoDivida: d.vencimento })));
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
          ${p.desconto ? `<div><span>Desconto</span><strong>${formatCurrency(p.desconto)}</strong></div>` : ''}
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
    const haystack = (c.inquilino + ' ' + c.imovel).toLowerCase();
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
        ${status === 'atrasado' ? `<div><span>Em atraso</span><strong style="color:var(--danger)">${formatCurrency(atrasoAtual)}</strong></div>` : ''}
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
          <div class="contrato-title">${escapeHtml(c.imovel)}</div>
          <div class="contrato-sub">${icon('user')} ${escapeHtml(c.inquilino)} · ${c.dividas.length} dívida(s)${pendentes ? `, ${pendentes} em aberto` : ' — tudo pago'}</div>
          ${c.quemRecebeu ? `<div class="contrato-sub">Recebedor padrão: ${escapeHtml(c.quemRecebeu)}</div>` : ''}
          ${c.corretorNome ? `<div class="contrato-sub">${icon('user')} Corretor: ${escapeHtml(c.corretorNome)} (${c.corretorPercentual}% do aluguel — não somado ao total)</div>` : ''}
        </div>
        <div class="contrato-actions">
          <button class="btn btn-ghost btn-sm" data-grupo-action="atualizar" data-contrato-id="${c.id}">${icon('calendar')} Atualizar dívidas</button>
          <button class="btn btn-ghost btn-sm" data-grupo-action="reajustar" data-contrato-id="${c.id}">${icon('trending-up')} Reajustar</button>
          ${c.anexoContrato ? `<a class="btn btn-ghost btn-sm" href="api/anexo.php?file=${encodeURIComponent(c.anexoContrato)}" target="_blank">${icon('paperclip')} Anexo</a>` : ''}
          <button class="btn btn-ghost btn-sm" data-grupo-action="historico" data-contrato-id="${c.id}">${icon('receipt')} Histórico</button>
          <button class="btn btn-ghost btn-sm" data-grupo-action="editar" data-contrato-id="${c.id}">${icon('pencil')} Editar contrato</button>
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
          <div class="contrato-title">${escapeHtml(item.imovel)}</div>
          <div class="contrato-sub">${icon('user')} ${escapeHtml(item.inquilino)} · Vencimento: ${formatDate(item.vencimento)}</div>
        </div>
        <span class="status-badge status-${status}">${statusLabel(status)}</span>
      </div>
      <div class="contrato-grid">
        <div><span>Total</span><strong>${formatCurrency(item.total)}</strong></div>
        ${status === 'atrasado' ? `<div><span>Em atraso</span><strong style="color:var(--danger)">${formatCurrency(atrasoAtual)}</strong></div>` : ''}
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

  renderAlertaVencimento(ativos);

  const recentes = dividas.slice().sort((a, b) => b.criadoEm - a.criadoEm).slice(0, 5);
  const recentList = document.getElementById('dashboardRecentList');
  recentList.innerHTML = recentes.length
    ? recentes.map(dividaCardHtml).join('')
    : '<div class="empty-state">Nenhum contrato cadastrado ainda. Clique em "Novo contrato" para começar.</div>';
  bindDividaCardActions(recentList);
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

  const itens = vencendo.map(d => `${escapeHtml(d.imovel)} (${escapeHtml(d.inquilino)}) — ${formatDate(d.vencimento)}`).join(' · ');
  banner.innerHTML = `<strong>${icon('alert-triangle')} ${vencendo.length} dívida(s) vencendo nos próximos ${DIAS_ALERTA_VENCIMENTO} dias</strong><span>${itens}</span>`;
  banner.classList.remove('hidden');
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

  list.innerHTML = entries.map(e => `
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
        ${e.desconto ? `<div><span>Desconto</span><strong>${formatCurrency(e.desconto)}</strong></div>` : ''}
        <div><span>Forma de pagamento</span><strong>${escapeHtml(e.forma) || '--'}</strong></div>
        <div><span>Quem recebeu</span><strong>${escapeHtml(e.quemRecebeu) || '--'}</strong></div>
        <div><span>Observação</span><strong>${escapeHtml(e.observacao) || '--'}</strong></div>
      </div>
    </div>
  `).join('');
}

document.getElementById('historicoFiltroContrato').addEventListener('change', renderHistorico);

/* ===================== CONFIG ===================== */
const configForm = document.getElementById('configForm');

function renderConfig() {
  document.getElementById('configTaxaJuros').value = state.config.taxaJurosMensal;
  document.getElementById('configTaxaMulta').value = state.config.taxaMultaPercent;
  document.getElementById('configJurosPadrao').value = state.config.jurosPadrao || 0;
  document.getElementById('configMultaPadrao').value = state.config.multaPadrao || 0;
  document.getElementById('configCorretorPercentualPadrao').value = state.config.corretorPercentualPadrao || 0;
  document.getElementById('accUsername').value = currentUsername;
  renderCorretoresConfig();
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
  state.config.jurosPadrao = Number(document.getElementById('configJurosPadrao').value) || 0;
  state.config.multaPadrao = Number(document.getElementById('configMultaPadrao').value) || 0;
  state.config.corretorPercentualPadrao = Number(document.getElementById('configCorretorPercentualPadrao').value) || 0;
  saveState();
  const msg = document.getElementById('configPadraoSaved');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2200);
  showToast('Valores padrão salvos com sucesso.', 'success');
});

/* ===================== CORRETORES (cadastro reutilizável) ===================== */
const addCorretorForm = document.getElementById('addCorretorForm');

function populateCorretorSelect(selectEl, valorAtual) {
  const atual = valorAtual || '';
  selectEl.innerHTML = '<option value="">Nenhum (sem corretor)</option>' +
    state.corretores.map(c => `<option value="${escapeHtml(c.nome)}">${escapeHtml(c.nome)}</option>`).join('');
  // se o valor atual não estiver na lista (corretor removido do cadastro depois
  // de já usado num contrato), mantém mostrando o nome mesmo assim
  if (atual && !state.corretores.some(c => c.nome === atual)) {
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

function renderCorretoresConfig() {
  const list = document.getElementById('corretoresList');
  if (!state.corretores.length) {
    list.innerHTML = '<div class="empty-state">Nenhum corretor cadastrado ainda.</div>';
    return;
  }
  list.innerHTML = state.corretores.map(c => `
    <div class="card">
      <div class="contrato-top">
        <div class="contrato-title">${escapeHtml(c.nome)}</div>
        <button type="button" class="btn btn-danger btn-sm" data-remove-corretor="${c.id}">${icon('trash')} Remover</button>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('[data-remove-corretor]').forEach(btn => {
    btn.addEventListener('click', () => removeCorretor(btn.dataset.removeCorretor));
  });
}

function removeCorretor(id) {
  const c = state.corretores.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`Remover "${c.nome}" da lista de corretores? Contratos que já usam esse nome não são afetados.`)) return;
  state.corretores = state.corretores.filter(x => x.id !== id);
  saveState();
  renderCorretoresConfig();
  showToast('Corretor removido.', 'success');
}

addCorretorForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const nomeInput = document.getElementById('newCorretorNome');
  const nome = nomeInput.value.trim();
  if (!nome) return;
  if (state.corretores.some(c => c.nome.toLowerCase() === nome.toLowerCase())) {
    showToast('Já existe um corretor cadastrado com esse nome.', 'error');
    return;
  }
  state.corretores.push({ id: uuid(), nome });
  saveState();
  nomeInput.value = '';
  renderCorretoresConfig();
  showToast('Corretor adicionado com sucesso.', 'success');
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
  try {
    const res = await apiFetch('users.php', { method: 'POST', body: JSON.stringify({ action: 'remove', id }) });
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
      body: JSON.stringify({ action: 'add', username, password }),
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
    state.corretores = state.corretores || [];
    state.auditoria = state.auditoria || [];
    await saveState();
    renderAll();
    renderCorretoresConfig();
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
  state = { contratos: [], config: { taxaJurosMensal: 1, taxaMultaPercent: 2, jurosPadrao: 0, multaPadrao: 0, corretorPercentualPadrao: 5 }, auditoria: [], corretores: [] };
  await saveState();
  renderAll();
  showToast('Todos os dados foram excluídos.', 'success');
});

/* ===================== CHARTS (canvas nativo) ===================== */
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
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(texto, w / 2, h / 2);
}

function renderCharts() {
  renderStatusChart();
  renderFormaPagamentoChart();
  renderAtrasoEvolucaoChart();
  renderReceitaMensalChart();
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
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(centerValue, cx, cy - 2);
  ctx.fillStyle = cssVar('--text-dim');
  ctx.font = '11px sans-serif';
  ctx.fillText(centerLabel, cx, cy + 16);

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
    totais[forma] = (totais[forma] || 0) + p.valor;
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

    ctx.font = '11px sans-serif';
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

function renderReceitaMensalChart() {
  const months = ultimosMeses(6);
  const dividas = todasDividas();
  const values = months.map(m => dividas.reduce((sum, d) => {
    const pagoNoMes = d.pagamentos
      .filter(p => {
        const dt = parseDate(p.data);
        return dt.getFullYear() === m.year && dt.getMonth() === m.month;
      })
      .reduce((s, p) => s + p.valor, 0);
    return sum + pagoNoMes;
  }, 0));
  renderTrendChart('chartReceitaMensal', months, values, '--success');
}

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

  const linhas = MESES_PT.map((nomeMes, mesIndex) => {
    const totalPago = dividas.reduce((sum, d) => {
      const pagoNoMes = d.pagamentos
        .filter(p => {
          const dt = parseDate(p.data);
          return dt.getFullYear() === ano && dt.getMonth() === mesIndex;
        })
        .reduce((s, p) => s + p.valor, 0);
      return sum + pagoNoMes;
    }, 0);

    const dividasPeriodo = dividas.filter(d => {
      const dt = parseDate(d.vencimento);
      return dt.getFullYear() === ano && dt.getMonth() === mesIndex;
    });

    const totalAtraso = dividasPeriodo
      .filter(d => getStatus(d) === 'atrasado')
      .reduce((sum, d) => sum + d.total + calcAtrasoAtual(d), 0);

    totalPagoAno += totalPago;
    totalAtrasoAno += totalAtraso;

    return { nomeMes, totalPago, totalAtraso, count: dividasPeriodo.length };
  });

  document.getElementById('relatorioTotalPagoAno').textContent = formatCurrency(totalPagoAno);
  document.getElementById('relatorioTotalAtrasoAno').textContent = formatCurrency(totalAtrasoAno);

  document.getElementById('relatorioTabelaBody').innerHTML = linhas.map(l => `
    <tr>
      <td>${l.nomeMes}</td>
      <td>${formatCurrency(l.totalPago)}</td>
      <td style="${l.totalAtraso > 0 ? 'color:var(--danger)' : ''}">${formatCurrency(l.totalAtraso)}</td>
      <td>${l.count}</td>
    </tr>
  `).join('');

  const pagamentosDoAno = [];
  dividas.forEach(d => d.pagamentos.forEach(p => {
    if (parseDate(p.data).getFullYear() === ano) pagamentosDoAno.push(p);
  }));

  const totalDescontoAno = pagamentosDoAno.reduce((sum, p) => sum + (p.desconto || 0), 0);
  document.getElementById('relatorioTotalDescontoAno').textContent = formatCurrency(totalDescontoAno);

  const porForma = {};
  pagamentosDoAno.forEach(p => {
    const forma = p.forma || 'Não informado';
    if (!porForma[forma]) porForma[forma] = { count: 0, total: 0 };
    porForma[forma].count++;
    porForma[forma].total += p.valor;
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
        .reduce((s, p) => s + p.valor, 0);
      return sum + pagoNoAno;
    }, 0);

    const dividasAno = dividas.filter(d => parseDate(d.vencimento).getFullYear() === ano);
    const totalAtraso = dividasAno
      .filter(d => getStatus(d) === 'atrasado')
      .reduce((sum, d) => sum + d.total + calcAtrasoAtual(d), 0);

    return { ano, totalPago, totalAtraso, count: dividasAno.length };
  });

  document.getElementById('comparativoAnualBody').innerHTML = linhas.map(l => `
    <tr style="${l.ano === anoSelecionado ? 'font-weight:600;' : ''}">
      <td>${l.ano}</td>
      <td>${formatCurrency(l.totalPago)}</td>
      <td style="${l.totalAtraso > 0 ? 'color:var(--danger)' : ''}">${formatCurrency(l.totalAtraso)}</td>
      <td>${l.count}</td>
    </tr>
  `).join('');
}

/* ===================== RENDER: AUDITORIA ===================== */
function renderAuditoria() {
  const list = document.getElementById('auditoriaList');
  const entries = (state.auditoria || []).slice().sort((a, b) => b.timestamp - a.timestamp);

  if (!entries.length) {
    list.innerHTML = '<div class="empty-state">Nenhum evento registrado ainda.</div>';
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
    </div>
  `).join('');
}

document.getElementById('relatorioAno').addEventListener('change', renderRelatorios);

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

    const dots = [];
    vencimentos.forEach(d => {
      const st = getStatus(d);
      const cor = st === 'atrasado' ? 'var(--danger)' : st === 'pago' ? 'var(--success)' : 'var(--accent)';
      dots.push(`<span class="calendar-dot" style="background:${cor}"></span>`);
    });
    pagamentosNoDia.forEach(() => dots.push('<span class="calendar-dot" style="background:var(--success)"></span>'));

    return `
      <div class="${classes.join(' ')}" data-data="${dataStr}">
        <span class="calendar-day-number">${c.dia}</span>
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

  const headers = ['Vencimento', 'Imóvel', 'Inquilino', 'Aluguel', 'Desconto', 'Juros', 'Multa', 'Condomínio', 'Total', 'Valor em Atraso', 'Status', 'Quem Recebe', 'Observação'];
  const rows = dividas.map(d => [
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
  c.dividas.forEach(d => d.pagamentos.forEach(p => pagamentos.push({ ...p, vencimentoDivida: d.vencimento })));
  if (!pagamentos.length) { showToast('Nenhum pagamento para exportar.', 'error'); return; }

  const headers = ['Dívida (Vencimento)', 'Data do Pagamento', 'Valor Pago', 'Desconto', 'Forma de Pagamento', 'Quem Recebeu', 'Observação'];
  const rows = pagamentos.map(p => [
    formatDate(p.vencimentoDivida),
    formatDate(p.data),
    p.valor.toFixed(2),
    (p.desconto || 0).toFixed(2),
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
      const vencimento = parseDateBR(row[0]);
      const imovel = (row[1] || '').trim();
      const inquilino = (row[2] || '').trim();
      if (!vencimento || !imovel || !inquilino) { ignorados++; return; }

      const aluguel = parseFloat(row[3]) || 0;
      const desconto = parseFloat(row[4]) || 0;
      const juros = parseFloat(row[5]) || 0;
      const multa = parseFloat(row[6]) || 0;
      const condominio = parseFloat(row[7]) || 0;
      const quemRecebeu = (row[11] || '').trim();

      const divida = {
        id: uuid(),
        vencimento,
        aluguel, desconto, juros, multa, condominio,
        valorAtrasoBase: parseFloat(row[9]) || 0,
        observacao: (row[12] || '').trim(),
        pago: false,
        dataPagamento: null,
        pagamentos: [],
        criadoEm: Date.now(),
      };
      divida.total = calcTotal(divida);

      state.contratos.push({
        id: uuid(),
        imovel,
        inquilino,
        quemRecebeu,
        dataInicio: vencimento,
        diaPagamento: parseDate(vencimento).getDate(),
        aluguel, desconto, juros, multa, condominio,
        anexoContrato: null,
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
