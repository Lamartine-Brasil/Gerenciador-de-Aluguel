'use strict';

/* =============================================================================
   ui.js — CAMADA DE INTERFACE
   -----------------------------------------------------------------------------
   Este arquivo NÃO contém nenhuma regra de negócio, nenhum cálculo e nenhuma
   chamada de API. Ele só cuida do comportamento visual da nova casca:

     · recolher/expandir a sidebar (com estado persistido)
     · drawer da sidebar no celular
     · menus suspensos (notificações e usuário)
     · painel de notificações espelhando os alertas já renderizados no Dashboard
     · expandir/recolher as dívidas dentro de cada contrato

   A navegação entre telas (endereço de cada tela, menu, abas de
   Configurações, busca do topo) é do roteador do index.js.

   Tudo que depende de dados continua vindo do index.js, que não foi alterado.
   Aqui só lemos o que ele já colocou na tela e reorganizamos a apresentação.
============================================================================= */

(function () {

  const root = document.documentElement;
  const $  = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  const SIDEBAR_KEY = 'aluguelApp_sidebar';

  /* ===========================================================================
     SIDEBAR — recolher / expandir (estado persistido)
  =========================================================================== */
  function applySidebar(state) {
    root.setAttribute('data-sidebar', state);
    const btn = $('#uiSidebarToggle');
    if (btn) {
      const recolhida = state === 'collapsed';
      btn.setAttribute('aria-label', recolhida ? 'Expandir menu lateral' : 'Recolher menu lateral');
      btn.setAttribute('title', recolhida ? 'Expandir menu lateral' : 'Recolher menu lateral');
      btn.setAttribute('aria-expanded', String(!recolhida));
    }
  }

  applySidebar(localStorage.getItem(SIDEBAR_KEY) === 'collapsed' ? 'collapsed' : 'expanded');

  const sidebarToggle = $('#uiSidebarToggle');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      const novo = root.getAttribute('data-sidebar') === 'collapsed' ? 'expanded' : 'collapsed';
      localStorage.setItem(SIDEBAR_KEY, novo);
      applySidebar(novo);
    });
  }

  /* ===========================================================================
     DRAWER — sidebar vira gaveta no celular (até 960px, o que inclui um
     computador com zoom de 200%)
     Fechada, a gaveta só sai da tela com `transform` — sem `inert`, o Tab
     continuava passando pelos itens invisíveis do menu. Aberta, ela recebe o
     foco e o resto da página fica inerte, como num modal.
  =========================================================================== */
  const sidebar = $('#uiSidebar');
  const conteudo = $('.app-main');
  const drawerToggle = $('#uiDrawerToggle');
  const ehGaveta = window.matchMedia('(max-width: 960px)');
  let backdropEl = null;

  function gavetaAberta() { return root.getAttribute('data-drawer') === 'open'; }

  function sincronizarGaveta() {
    const aberta = gavetaAberta();
    if (sidebar) sidebar.inert = ehGaveta.matches && !aberta;
    if (conteudo) conteudo.inert = ehGaveta.matches && aberta;
  }

  function openDrawer() {
    root.setAttribute('data-drawer', 'open');
    if (drawerToggle) {
      drawerToggle.setAttribute('aria-expanded', 'true');
      drawerToggle.setAttribute('aria-label', 'Fechar menu');
    }
    if (!backdropEl) {
      backdropEl = document.createElement('div');
      backdropEl.className = 'sidebar-backdrop';
      backdropEl.addEventListener('click', () => closeDrawer({ devolverFoco: true }));
      document.body.appendChild(backdropEl);
    }
    sincronizarGaveta();
    const alvo = $('#tabsNav .tab-btn.active') || $('#tabsNav .tab-btn');
    if (alvo) alvo.focus();
  }

  function closeDrawer(opcoes = {}) {
    const estavaAberta = gavetaAberta();
    root.removeAttribute('data-drawer');
    if (drawerToggle) {
      drawerToggle.setAttribute('aria-expanded', 'false');
      drawerToggle.setAttribute('aria-label', 'Abrir menu');
    }
    if (backdropEl) {
      backdropEl.remove();
      backdropEl = null;
    }
    sincronizarGaveta();
    if (estavaAberta && opcoes.devolverFoco && drawerToggle && ehGaveta.matches) drawerToggle.focus();
  }

  if (drawerToggle) {
    drawerToggle.addEventListener('click', () => {
      gavetaAberta() ? closeDrawer({ devolverFoco: true }) : openDrawer();
    });
  }
  // ao passar de celular para computador (ou tirar o zoom), a gaveta deixa de existir
  ehGaveta.addEventListener('change', () => { if (!ehGaveta.matches) closeDrawer(); sincronizarGaveta(); });
  sincronizarGaveta();

  /* ===========================================================================
     NAVEGAÇÃO
     A troca de tela é do roteador do index.js (cada tela tem endereço
     próprio, #/contratos etc.); aqui só fechamos a gaveta e os menus quando a
     tela muda.
  =========================================================================== */
  document.addEventListener('rota-mudou', () => {
    closeAllDropdowns();
    closeDrawer();
  });

  /* ===========================================================================
     MENUS DO TOPO (notificações e usuário)
     Padrão simples: um botão que abre e fecha uma lista comum de botões e
     links (aria-expanded + aria-controls). Não usamos role="menu": ele promete
     navegação por setas que um leitor de tela espera encontrar. Tab percorre os
     itens normalmente; Esc fecha e devolve o foco ao botão; sair do menu com o
     Tab ou clicar fora também fecha.
  =========================================================================== */
  const dropdowns = [
    { button: $('#uiNotifButton'), menu: $('#uiNotifMenu') },
    { button: $('#uiUserButton'),  menu: $('#uiUserDropdown') },
  ].filter(d => d.button && d.menu);

  function closeAllDropdowns(exceto) {
    dropdowns.forEach(d => {
      if (d === exceto) return;
      d.menu.classList.add('hidden');
      d.button.setAttribute('aria-expanded', 'false');
    });
  }

  dropdowns.forEach(d => {
    d.button.setAttribute('aria-controls', d.menu.id);
    d.button.addEventListener('click', () => {
      const aberto = !d.menu.classList.contains('hidden');
      closeAllDropdowns(d);
      d.menu.classList.toggle('hidden', aberto);
      d.button.setAttribute('aria-expanded', String(!aberto));
    });
    // escolher um item (inclusive "Sair") fecha o menu
    d.menu.addEventListener('click', (e) => {
      if (e.target.closest('.dropdown-item, .notif-item')) closeAllDropdowns();
    });
    d.button.parentElement.addEventListener('focusout', (e) => {
      if (e.relatedTarget && !d.button.parentElement.contains(e.relatedTarget)) closeAllDropdowns();
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) closeAllDropdowns();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const aberto = dropdowns.find(d => !d.menu.classList.contains('hidden'));
    if (aberto) {
      const focoDentro = aberto.button.parentElement.contains(document.activeElement);
      closeAllDropdowns();
      if (focoDentro) aberto.button.focus();
      return;
    }
    if (gavetaAberta()) closeDrawer({ devolverFoco: true });
  });

  /* ===========================================================================
     AVATAR DO USUÁRIO — inicial derivada do nome já exibido
  =========================================================================== */
  const userNameEl = $('#currentUserName');
  const avatarEl = $('#uiUserAvatar');

  function syncAvatar() {
    if (!userNameEl || !avatarEl) return;
    const nome = (userNameEl.textContent || '').trim();
    avatarEl.textContent = nome ? nome.charAt(0) : '?';
  }

  if (userNameEl) {
    syncAvatar();
    new MutationObserver(syncAvatar).observe(userNameEl, {
      childList: true, characterData: true, subtree: true,
    });
  }

  /* ===========================================================================
     NOTIFICAÇÕES
     Espelham os alertas que o Dashboard já renderiza (vencimentos próximos e
     reajustes sugeridos). Clicar em um item aciona o clique no item original,
     preservando exatamente o comportamento programado no index.js.
  =========================================================================== */
  const notifBadge = $('#uiNotifBadge');
  const notifList  = $('#uiNotifList');
  const notifSummary = $('#uiNotifSummary');

  const FONTES_ALERTA = [
    { id: 'dashboardAlertaVencimento', cor: 'bg-warn',   rotulo: 'Vencimento próximo' },
    { id: 'dashboardAlertaReajuste',   cor: 'bg-accent', rotulo: 'Reajuste sugerido' },
  ];

  function renderNotificacoes() {
    if (!notifList) return;

    const itens = [];
    FONTES_ALERTA.forEach(fonte => {
      const banner = document.getElementById(fonte.id);
      if (!banner || banner.classList.contains('hidden')) return;
      $$('.alert-banner-item', banner).forEach(origem => {
        itens.push({ cor: fonte.cor, rotulo: fonte.rotulo, texto: origem.textContent.trim(), origem });
      });
    });

    notifList.innerHTML = '';

    if (!itens.length) {
      const vazio = document.createElement('div');
      vazio.className = 'dropdown-empty';
      vazio.textContent = 'Nenhum aviso no momento.';
      notifList.appendChild(vazio);
    } else {
      itens.forEach(item => {
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'notif-item';

        const ponto = document.createElement('span');
        ponto.className = 'notif-dot ' + item.cor;

        const texto = document.createElement('span');
        texto.className = 'notif-text';
        texto.textContent = item.texto;

        const meta = document.createElement('span');
        meta.className = 'notif-meta';
        meta.textContent = item.rotulo;
        texto.appendChild(meta);

        botao.appendChild(ponto);
        botao.appendChild(texto);
        botao.addEventListener('click', () => {
          closeAllDropdowns();
          item.origem.click();
        });
        notifList.appendChild(botao);
      });
    }

    if (notifBadge) {
      notifBadge.textContent = itens.length > 9 ? '9+' : String(itens.length);
      notifBadge.classList.toggle('hidden', itens.length === 0);
    }
    if (notifSummary) {
      notifSummary.textContent = itens.length ? `${itens.length} aviso(s)` : '';
    }
  }

  FONTES_ALERTA.forEach(fonte => {
    const banner = document.getElementById(fonte.id);
    if (!banner) return;
    new MutationObserver(renderNotificacoes).observe(banner, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['class'],
    });
  });
  renderNotificacoes();

  /* ===========================================================================
     CONTRATOS — expandir/recolher as dívidas sem sair da página
     Cada contrato mostra as 3 dívidas mais recentes; o restante abre no lugar.
  =========================================================================== */
  const contratosList = $('#contratosList');
  const LIMITE_DIVIDAS_VISIVEIS = 3;

  function montarToggles() {
    if (!contratosList) return;
    $$('.contrato-grupo', contratosList).forEach(grupo => {
      const caixa = $('.contrato-grupo-dividas', grupo);
      if (!caixa || caixa.dataset.uiToggle === '1') return;

      const linhas = $$('.divida-row', caixa);
      if (linhas.length <= LIMITE_DIVIDAS_VISIVEIS) return;

      caixa.dataset.uiToggle = '1';
      caixa.classList.add('collapsed');

      const ocultas = linhas.length - LIMITE_DIVIDAS_VISIVEIS;
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'contrato-grupo-toggle';
      botao.setAttribute('aria-expanded', 'false');

      const rotulo = document.createElement('span');

      const atualizar = () => {
        const aberto = !caixa.classList.contains('collapsed');
        rotulo.textContent = aberto ? 'Mostrar menos' : `Mostrar mais ${ocultas} dívida(s)`;
        botao.classList.toggle('is-open', aberto);
        botao.setAttribute('aria-expanded', String(aberto));
      };

      botao.innerHTML = '<svg class="icon"><use href="#icon-chevron-down"></use></svg>';
      botao.appendChild(rotulo);
      atualizar();

      botao.addEventListener('click', () => {
        caixa.classList.toggle('collapsed');
        atualizar();
      });

      caixa.appendChild(botao);
    });
  }

  if (contratosList) {
    // childList sem subtree: o index.js troca o innerHTML da lista inteira, e as
    // nossas próprias inserções (dentro dos filhos) não disparam o observador.
    new MutationObserver(montarToggles).observe(contratosList, { childList: true });
    montarToggles();
  }

})();
