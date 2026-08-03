'use strict';

/* ===================== CONSTANTS ===================== */
const API_BASE = 'api/';

const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_ALERTA_VENCIMENTO = 5;

/* ===================== STATE ===================== */
let state = { contratos: [], config: { taxaJurosMensal: 1, taxaMultaPercent: 2, jurosPadrao: 0, multaPadrao: 0 }, auditoria: [] };
let currentUsername = '';

function setCurrentUsername(username) {
  currentUsername = username || '';
  document.getElementById('currentUserName').textContent = currentUsername;
}

/* ===================== TEMA (claro/escuro) ===================== */
const THEME_KEY = 'aluguelApp_theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('btnThemeToggle').textContent = theme === 'light' ? '☀️' : '🌙';
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
  data.config = Object.assign({ taxaJurosMensal: 1, taxaMultaPercent: 2, jurosPadrao: 0, multaPadrao: 0 }, data.config || {});
  data.auditoria = data.auditoria || [];
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

function formatDate(dateStr) {
  if (!dateStr) return '--';
  const d = parseDate(dateStr);
  return String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + d.getFullYear();
}

function formatCurrency(value) {
  return (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateTime(timestamp) {
  const d = new Date(timestamp);
  const data = String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + d.getFullYear();
  const hora = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return `${data} ${hora}`;
}

function calcTotal(c) {
  return (Number(c.aluguel) || 0) - (Number(c.desconto) || 0) + (Number(c.juros) || 0) + (Number(c.multa) || 0) + (Number(c.condominio) || 0);
}

function diasAtraso(c) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const venc = parseDate(c.vencimento);
  const diff = Math.floor((hoje - venc) / 86400000);
  return diff > 0 ? diff : 0;
}

function calcAtrasoAtual(c) {
  if (c.pago) return 0;
  const dias = diasAtraso(c);
  if (dias <= 0) return Number(c.valorAtrasoBase) || 0;
  const meses = dias / 30;
  const jurosCalc = c.total * (state.config.taxaJurosMensal / 100) * meses;
  const multaCalc = c.total * (state.config.taxaMultaPercent / 100);
  return (Number(c.valorAtrasoBase) || 0) + jurosCalc + multaCalc;
}

function getStatus(c) {
  if (c.pago) return 'pago';
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const venc = parseDate(c.vencimento);
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

/* ===================== CONTRATO FORM ===================== */
const formContrato = document.getElementById('formContrato');
const fFields = ['fVencimento', 'fImovel', 'fInquilino', 'fAluguel', 'fDesconto', 'fJuros', 'fMulta', 'fCondominio', 'fValorAtraso', 'fQuemRecebeu', 'fObservacao'];

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
  document.getElementById('modalContratoTitle').textContent = 'Novo contrato';
  document.getElementById('fVencimento').value = todayStr();
  document.getElementById('fJuros').value = state.config.jurosPadrao || '';
  document.getElementById('fMulta').value = state.config.multaPadrao || '';
  updateTotalPreview();
  openModal('modalContrato');
});

function openEditContrato(id) {
  const c = state.contratos.find(x => x.id === id);
  if (!c) return;
  document.getElementById('contratoId').value = c.id;
  document.getElementById('fVencimento').value = c.vencimento;
  document.getElementById('fImovel').value = c.imovel;
  document.getElementById('fInquilino').value = c.inquilino;
  document.getElementById('fAluguel').value = c.aluguel;
  document.getElementById('fDesconto').value = c.desconto || '';
  document.getElementById('fJuros').value = c.juros || '';
  document.getElementById('fMulta').value = c.multa || '';
  document.getElementById('fCondominio').value = c.condominio || '';
  document.getElementById('fValorAtraso').value = c.valorAtrasoBase || '';
  document.getElementById('fQuemRecebeu').value = c.quemRecebeu || '';
  document.getElementById('fObservacao').value = c.observacao || '';
  document.getElementById('modalContratoTitle').textContent = 'Editar contrato';
  updateTotalPreview();
  openModal('modalContrato');
}

formContrato.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('contratoId').value;
  const data = {
    vencimento: document.getElementById('fVencimento').value,
    imovel: document.getElementById('fImovel').value.trim(),
    inquilino: document.getElementById('fInquilino').value.trim(),
    aluguel: Number(document.getElementById('fAluguel').value) || 0,
    desconto: Number(document.getElementById('fDesconto').value) || 0,
    juros: Number(document.getElementById('fJuros').value) || 0,
    multa: Number(document.getElementById('fMulta').value) || 0,
    condominio: Number(document.getElementById('fCondominio').value) || 0,
    valorAtrasoBase: Number(document.getElementById('fValorAtraso').value) || 0,
    quemRecebeu: document.getElementById('fQuemRecebeu').value.trim(),
    observacao: document.getElementById('fObservacao').value.trim(),
  };
  data.total = calcTotal(data);

  if (id) {
    const c = state.contratos.find(x => x.id === id);
    Object.assign(c, data);
    registrarAuditoria('contrato_editado', `Contrato editado: ${data.imovel} - ${data.inquilino}`);
    showToast('Contrato atualizado com sucesso.', 'success');
  } else {
    state.contratos.push({
      id: uuid(),
      ...data,
      pago: false,
      dataPagamento: null,
      pagamentos: [],
      criadoEm: Date.now(),
    });
    registrarAuditoria('contrato_criado', `Contrato criado: ${data.imovel} - ${data.inquilino}`);
    showToast('Contrato criado com sucesso.', 'success');
  }
  saveState();
  closeModal('modalContrato');
  renderAll();
});

function excluirContrato(id) {
  if (!confirm('Tem certeza que deseja excluir este contrato? Esta ação não pode ser desfeita.')) return;
  const c = state.contratos.find(x => x.id === id);
  state.contratos = state.contratos.filter(x => x.id !== id);
  if (c) registrarAuditoria('contrato_excluido', `Contrato excluído: ${c.imovel} - ${c.inquilino}`);
  saveState();
  renderAll();
  showToast('Contrato excluído.', 'success');
}

/* ===================== PAGAMENTO ===================== */
const formPagamento = document.getElementById('formPagamento');

function openPagamento(id) {
  const c = state.contratos.find(x => x.id === id);
  if (!c) return;
  document.getElementById('pagContratoId').value = c.id;
  document.getElementById('pagContratoInfo').textContent = `${c.imovel} — ${c.inquilino} — Total: ${formatCurrency(c.total)}`;
  document.getElementById('pagData').value = todayStr();
  document.getElementById('pagDesconto').value = '';
  document.getElementById('pagValor').value = (c.total + calcAtrasoAtual(c)).toFixed(2);
  document.getElementById('pagForma').value = '';
  document.getElementById('pagQuemRecebeu').value = c.quemRecebeu || '';
  document.getElementById('pagObservacao').value = '';
  openModal('modalPagamento');
}

document.getElementById('pagDesconto').addEventListener('input', () => {
  const id = document.getElementById('pagContratoId').value;
  const c = state.contratos.find(x => x.id === id);
  if (!c) return;
  const desconto = Number(document.getElementById('pagDesconto').value) || 0;
  const base = c.total + calcAtrasoAtual(c);
  document.getElementById('pagValor').value = Math.max(base - desconto, 0).toFixed(2);
});

formPagamento.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('pagContratoId').value;
  const c = state.contratos.find(x => x.id === id);
  if (!c) return;
  const pagamento = {
    data: document.getElementById('pagData').value,
    desconto: Number(document.getElementById('pagDesconto').value) || 0,
    valor: Number(document.getElementById('pagValor').value) || 0,
    forma: document.getElementById('pagForma').value,
    quemRecebeu: document.getElementById('pagQuemRecebeu').value.trim(),
    observacao: document.getElementById('pagObservacao').value.trim(),
  };
  c.pagamentos.push(pagamento);
  c.pago = true;
  c.dataPagamento = pagamento.data;
  c.valorAtrasoBase = 0;
  registrarAuditoria('pagamento_registrado', `Pagamento registrado: ${c.imovel} - ${c.inquilino} - ${formatCurrency(pagamento.valor)}`);
  saveState();
  closeModal('modalPagamento');
  renderAll();
  showToast('Pagamento registrado com sucesso.', 'success');
});

/* ===================== HISTÓRICO POR CONTRATO ===================== */
let historicoContratoAtualId = null;

function openHistoricoContrato(id) {
  const c = state.contratos.find(x => x.id === id);
  if (!c) return;
  historicoContratoAtualId = id;
  document.getElementById('histContratoInfo').textContent = `${c.imovel} — ${c.inquilino}`;
  const list = document.getElementById('histContratoList');
  if (!c.pagamentos.length) {
    list.innerHTML = '<div class="empty-state">Nenhum pagamento registrado ainda.</div>';
  } else {
    list.innerHTML = c.pagamentos.slice().reverse().map(p => `
      <div class="card">
        <div class="contrato-grid">
          <div><span>Data</span><strong>${formatDate(p.data)}</strong></div>
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
function populateAnoFilter() {
  const select = document.getElementById('filterAno');
  const anos = new Set(state.contratos.map(c => parseDate(c.vencimento).getFullYear()));
  anos.add(new Date().getFullYear());
  const sorted = Array.from(anos).sort((a, b) => b - a);
  const current = select.value;
  select.innerHTML = '<option value="">Todos os anos</option>' + sorted.map(a => `<option value="${a}">${a}</option>`).join('');
  select.value = current || '';
}

function getFilteredContratos() {
  const search = document.getElementById('searchContratos').value.trim().toLowerCase();
  const ano = document.getElementById('filterAno').value;
  const mes = document.getElementById('filterMes').value;
  const status = document.getElementById('filterStatus').value;

  return state.contratos.filter(c => {
    if (search) {
      const haystack = (c.inquilino + ' ' + c.imovel).toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    const venc = parseDate(c.vencimento);
    if (ano && venc.getFullYear() !== Number(ano)) return false;
    if (mes !== '' && venc.getMonth() !== Number(mes)) return false;
    if (status && getStatus(c) !== status) return false;
    return true;
  }).sort((a, b) => parseDate(a.vencimento) - parseDate(b.vencimento));
}

['searchContratos', 'filterAno', 'filterMes', 'filterStatus'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    contratosPaginaAtual = 1;
    renderContratos();
  });
});

/* ===================== RENDER: CONTRATO CARD ===================== */
function contratoCardHtml(c) {
  const status = getStatus(c);
  const atrasoAtual = calcAtrasoAtual(c);
  return `
    <div class="contrato-card status-${status}" data-id="${c.id}">
      <div class="contrato-top">
        <div>
          <div class="contrato-title">${escapeHtml(c.imovel)}</div>
          <div class="contrato-sub">👤 ${escapeHtml(c.inquilino)} · Vencimento: ${formatDate(c.vencimento)}</div>
        </div>
        <span class="status-badge status-${status}">${statusLabel(status)}</span>
      </div>
      <div class="contrato-grid">
        <div><span>Aluguel</span><strong>${formatCurrency(c.aluguel)}</strong></div>
        <div><span>Desconto</span><strong>${formatCurrency(c.desconto)}</strong></div>
        <div><span>Juros</span><strong>${formatCurrency(c.juros)}</strong></div>
        <div><span>Multa</span><strong>${formatCurrency(c.multa)}</strong></div>
        <div><span>Condomínio</span><strong>${formatCurrency(c.condominio)}</strong></div>
        <div><span>Total</span><strong>${formatCurrency(c.total)}</strong></div>
        ${status === 'atrasado' ? `<div><span>Em atraso</span><strong style="color:var(--danger)">${formatCurrency(atrasoAtual)}</strong></div>` : ''}
        ${c.quemRecebeu ? `<div><span>Quem recebe</span><strong>${escapeHtml(c.quemRecebeu)}</strong></div>` : ''}
      </div>
      ${c.observacao ? `<div class="contrato-sub">📝 ${escapeHtml(c.observacao)}</div>` : ''}
      <div class="contrato-actions">
        ${status !== 'pago' ? `<button class="btn btn-success btn-sm" data-action="pagar" data-id="${c.id}">💰 Pagar</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-action="historico" data-id="${c.id}">🧾 Histórico</button>
        <button class="btn btn-ghost btn-sm" data-action="editar" data-id="${c.id}">✏️ Editar</button>
        <button class="btn btn-danger btn-sm" data-action="excluir" data-id="${c.id}">🗑️ Excluir</button>
      </div>
    </div>
  `;
}

function bindCardActions(container) {
  container.querySelectorAll('[data-action]').forEach(btn => {
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    btn.addEventListener('click', () => {
      if (action === 'pagar') openPagamento(id);
      else if (action === 'historico') openHistoricoContrato(id);
      else if (action === 'editar') openEditContrato(id);
      else if (action === 'excluir') excluirContrato(id);
    });
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

  list.innerHTML = pagina.map(contratoCardHtml).join('');
  bindCardActions(list);
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
  const ativos = state.contratos.filter(c => getStatus(c) === 'ativo');
  const atrasados = state.contratos.filter(c => getStatus(c) === 'atrasado');
  const totalAtraso = atrasados.reduce((sum, c) => sum + calcAtrasoAtual(c), 0);

  document.getElementById('statAtivos').textContent = ativos.length;
  document.getElementById('statAtraso').textContent = formatCurrency(totalAtraso);

  const pendentes = state.contratos.filter(c => getStatus(c) !== 'pago');
  const proximo = pendentes.slice().sort((a, b) => parseDate(a.vencimento) - parseDate(b.vencimento))[0];
  document.getElementById('statProximo').textContent = proximo ? formatDate(proximo.vencimento) : '--';

  renderAlertaVencimento(ativos);

  const recentes = state.contratos.slice().sort((a, b) => b.criadoEm - a.criadoEm).slice(0, 5);
  const recentList = document.getElementById('dashboardRecentList');
  recentList.innerHTML = recentes.length
    ? recentes.map(contratoCardHtml).join('')
    : '<div class="empty-state">Nenhum contrato cadastrado ainda. Clique em "Novo contrato" para começar.</div>';
  bindCardActions(recentList);
}

function renderAlertaVencimento(ativos) {
  const banner = document.getElementById('dashboardAlertaVencimento');
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const limite = new Date(hoje); limite.setDate(limite.getDate() + DIAS_ALERTA_VENCIMENTO);

  const vencendo = ativos
    .filter(c => parseDate(c.vencimento) <= limite)
    .sort((a, b) => parseDate(a.vencimento) - parseDate(b.vencimento));

  if (!vencendo.length) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }

  const itens = vencendo.map(c => `${escapeHtml(c.imovel)} (${escapeHtml(c.inquilino)}) — ${formatDate(c.vencimento)}`).join(' · ');
  banner.innerHTML = `<strong>⚠️ ${vencendo.length} contrato(s) vencendo nos próximos ${DIAS_ALERTA_VENCIMENTO} dias</strong><span>${itens}</span>`;
  banner.classList.remove('hidden');
}

/* ===================== RENDER: ATRASOS ===================== */
function renderAtrasos() {
  const list = document.getElementById('atrasosList');
  const atrasados = state.contratos.filter(c => getStatus(c) === 'atrasado')
    .sort((a, b) => parseDate(a.vencimento) - parseDate(b.vencimento));

  const totalAtrasados = atrasados.reduce((sum, c) => sum + c.total + calcAtrasoAtual(c), 0);
  document.getElementById('statTotalAtrasados').textContent = formatCurrency(totalAtrasados);

  if (!atrasados.length) {
    list.innerHTML = '<div class="empty-state">Nenhum contrato em atraso. 🎉</div>';
    return;
  }
  list.innerHTML = atrasados.map(contratoCardHtml).join('');
  bindCardActions(list);
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
    c.pagamentos.forEach(p => entries.push({ ...p, contrato: c }));
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
          <div class="contrato-sub">👤 ${escapeHtml(e.contrato.inquilino)}</div>
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
  document.getElementById('accUsername').value = currentUsername;
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
  saveState();
  const msg = document.getElementById('configPadraoSaved');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2200);
  showToast('Valores padrão salvos com sucesso.', 'success');
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
        ${u.username !== currentUsername && users.length > 1 ? `<button type="button" class="btn btn-danger btn-sm" data-remove-user="${u.id}" data-remove-username="${escapeHtml(u.username)}">🗑️ Remover</button>` : ''}
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
    await saveState();
    renderAll();
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
  state = { contratos: [], config: { taxaJurosMensal: 1, taxaMultaPercent: 2, jurosPadrao: 0, multaPadrao: 0 } };
  await saveState();
  renderAll();
  showToast('Todos os dados foram excluídos.', 'success');
});

/* ===================== CHARTS (canvas nativo) ===================== */
function renderCharts() {
  renderStatusChart();
  renderAtrasoEvolucaoChart();
}

function renderStatusChart() {
  const canvas = document.getElementById('chartStatus');
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth || 600;
  const h = canvas.height;
  canvas.width = w;

  const counts = { ativo: 0, atrasado: 0, pago: 0 };
  state.contratos.forEach(c => counts[getStatus(c)]++);

  ctx.clearRect(0, 0, w, h);
  const data = [
    { label: 'Ativos', value: counts.ativo, color: '#4f7fff' },
    { label: 'Atrasados', value: counts.atrasado, color: '#ff5c6c' },
    { label: 'Pagos', value: counts.pago, color: '#2fbf71' },
  ];
  const max = Math.max(1, ...data.map(d => d.value));
  const barWidth = w / (data.length * 2);
  const chartHeight = h - 50;

  data.forEach((d, i) => {
    const barHeight = (d.value / max) * (chartHeight - 20);
    const x = barWidth * (i * 2 + 0.5);
    const y = chartHeight - barHeight + 10;
    ctx.fillStyle = d.color;
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = '#e8eaed';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(d.value), x + barWidth / 2, y - 8);
    ctx.fillStyle = '#9aa1ac';
    ctx.fillText(d.label, x + barWidth / 2, chartHeight + 26);
  });
}

function renderAtrasoEvolucaoChart() {
  const canvas = document.getElementById('chartAtrasoEvolucao');
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth || 600;
  const h = canvas.height;
  canvas.width = w;

  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth(), label: MESES_PT[d.getMonth()].slice(0, 3) + '/' + String(d.getFullYear()).slice(2) });
  }

  const totals = months.map(m => {
    return state.contratos.reduce((sum, c) => {
      const venc = parseDate(c.vencimento);
      if (venc.getFullYear() === m.year && venc.getMonth() === m.month && getStatus(c) === 'atrasado') {
        return sum + calcAtrasoAtual(c);
      }
      return sum;
    }, 0);
  });

  ctx.clearRect(0, 0, w, h);
  const max = Math.max(1, ...totals);
  const chartHeight = h - 50;
  const barWidth = w / (months.length * 1.6);
  const gap = (w - barWidth * months.length) / (months.length + 1);

  totals.forEach((val, i) => {
    const barHeight = (val / max) * (chartHeight - 20);
    const x = gap + i * (barWidth + gap);
    const y = chartHeight - barHeight + 10;
    ctx.fillStyle = '#ffb547';
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = '#e8eaed';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(formatCurrency(val).replace('R$', '').trim(), x + barWidth / 2, y - 8);
    ctx.fillStyle = '#9aa1ac';
    ctx.fillText(months[i].label, x + barWidth / 2, chartHeight + 26);
  });
}

window.addEventListener('resize', () => {
  const graficosTab = document.getElementById('tab-graficos');
  if (graficosTab.classList.contains('active')) renderCharts();
});

/* ===================== RELATÓRIOS MENSAIS/ANUAIS ===================== */
function populateRelatorioAnoFilter() {
  const select = document.getElementById('relatorioAno');
  const anos = new Set(state.contratos.map(c => parseDate(c.vencimento).getFullYear()));
  state.contratos.forEach(c => c.pagamentos.forEach(p => anos.add(parseDate(p.data).getFullYear())));
  anos.add(new Date().getFullYear());
  const sorted = Array.from(anos).sort((a, b) => b - a);
  const current = select.value;
  select.innerHTML = sorted.map(a => `<option value="${a}">${a}</option>`).join('');
  select.value = sorted.map(String).includes(current) ? current : String(new Date().getFullYear());
}

function renderRelatorios() {
  populateRelatorioAnoFilter();
  const ano = Number(document.getElementById('relatorioAno').value);

  let totalPagoAno = 0;
  let totalAtrasoAno = 0;

  const linhas = MESES_PT.map((nomeMes, mesIndex) => {
    const totalPago = state.contratos.reduce((sum, c) => {
      const pagoNoMes = c.pagamentos
        .filter(p => {
          const d = parseDate(p.data);
          return d.getFullYear() === ano && d.getMonth() === mesIndex;
        })
        .reduce((s, p) => s + p.valor, 0);
      return sum + pagoNoMes;
    }, 0);

    const contratosPeriodo = state.contratos.filter(c => {
      const d = parseDate(c.vencimento);
      return d.getFullYear() === ano && d.getMonth() === mesIndex;
    });

    const totalAtraso = contratosPeriodo
      .filter(c => getStatus(c) === 'atrasado')
      .reduce((sum, c) => sum + calcAtrasoAtual(c), 0);

    totalPagoAno += totalPago;
    totalAtrasoAno += totalAtraso;

    return { nomeMes, totalPago, totalAtraso, count: contratosPeriodo.length };
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

  renderComparativoAnual(ano);
}

function renderComparativoAnual(anoSelecionado) {
  const anos = new Set(state.contratos.map(c => parseDate(c.vencimento).getFullYear()));
  state.contratos.forEach(c => c.pagamentos.forEach(p => anos.add(parseDate(p.data).getFullYear())));
  anos.add(new Date().getFullYear());
  const sorted = Array.from(anos).sort((a, b) => b - a);

  const linhas = sorted.map(ano => {
    const totalPago = state.contratos.reduce((sum, c) => {
      const pagoNoAno = c.pagamentos
        .filter(p => parseDate(p.data).getFullYear() === ano)
        .reduce((s, p) => s + p.valor, 0);
      return sum + pagoNoAno;
    }, 0);

    const contratosAno = state.contratos.filter(c => parseDate(c.vencimento).getFullYear() === ano);
    const totalAtraso = contratosAno
      .filter(c => getStatus(c) === 'atrasado')
      .reduce((sum, c) => sum + calcAtrasoAtual(c), 0);

    return { ano, totalPago, totalAtraso, count: contratosAno.length };
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
          <div class="contrato-sub">👤 ${escapeHtml(e.usuario)} · ${formatDateTime(e.timestamp)}</div>
        </div>
      </div>
    </div>
  `).join('');
}

document.getElementById('relatorioAno').addEventListener('change', renderRelatorios);

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
  const contratos = getFilteredContratos();
  if (!contratos.length) { showToast('Nenhum contrato para exportar.', 'error'); return; }

  const headers = ['Vencimento', 'Imóvel', 'Inquilino', 'Aluguel', 'Desconto', 'Juros', 'Multa', 'Condomínio', 'Total', 'Valor em Atraso', 'Status', 'Quem Recebe', 'Observação'];
  const rows = contratos.map(c => [
    formatDate(c.vencimento),
    c.imovel,
    c.inquilino,
    c.aluguel.toFixed(2),
    c.desconto.toFixed(2),
    c.juros.toFixed(2),
    c.multa.toFixed(2),
    c.condominio.toFixed(2),
    c.total.toFixed(2),
    calcAtrasoAtual(c).toFixed(2),
    statusLabel(getStatus(c)),
    c.quemRecebeu || '',
    c.observacao || '',
  ]);

  downloadCsv(`contratos_${todayStr()}.csv`, headers, rows);
  showToast('CSV exportado com sucesso.', 'success');
});

document.getElementById('btnExportHistoricoContrato').addEventListener('click', () => {
  const c = state.contratos.find(x => x.id === historicoContratoAtualId);
  if (!c) return;
  if (!c.pagamentos.length) { showToast('Nenhum pagamento para exportar.', 'error'); return; }

  const headers = ['Data do Pagamento', 'Valor Pago', 'Desconto', 'Forma de Pagamento', 'Quem Recebeu', 'Observação'];
  const rows = c.pagamentos.map(p => [
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

      const novo = {
        id: uuid(),
        vencimento,
        imovel,
        inquilino,
        aluguel: parseFloat(row[3]) || 0,
        desconto: parseFloat(row[4]) || 0,
        juros: parseFloat(row[5]) || 0,
        multa: parseFloat(row[6]) || 0,
        condominio: parseFloat(row[7]) || 0,
        valorAtrasoBase: parseFloat(row[9]) || 0,
        quemRecebeu: (row[11] || '').trim(),
        observacao: (row[12] || '').trim(),
        pago: false,
        dataPagamento: null,
        pagamentos: [],
        criadoEm: Date.now(),
      };
      novo.total = calcTotal(novo);
      state.contratos.push(novo);
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
  const contratos = getFilteredContratos();
  if (!contratos.length) { showToast('Nenhum contrato para exportar.', 'error'); return; }

  const canvas = document.getElementById('hiddenReportCanvas');
  const rowHeight = 26;
  const headerHeight = 90;
  const footerPad = 30;
  canvas.width = 900;
  canvas.height = headerHeight + rowHeight * (contratos.length + 1) + footerPad;
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
  contratos.forEach(c => {
    const status = getStatus(c);
    const values = {
      vencimento: formatDate(c.vencimento),
      imovel: truncateText(ctx, c.imovel, 190),
      inquilino: truncateText(ctx, c.inquilino, 130),
      total: formatCurrency(c.total),
      atraso: status === 'atrasado' ? formatCurrency(calcAtrasoAtual(c)) : '--',
      status: statusLabel(status),
      quemRecebeu: truncateText(ctx, c.quemRecebeu || '--', 150),
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
