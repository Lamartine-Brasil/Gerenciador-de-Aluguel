'use strict';

/* =============================================================================
   ui.js — CAMADA DE INTERFACE
   -----------------------------------------------------------------------------
   Este arquivo NÃO contém nenhuma regra de negócio, nenhum cálculo e nenhuma
   chamada de API. Ele só cuida do comportamento visual da nova casca:

     · recolher/expandir a sidebar (com estado persistido)
     · drawer da sidebar no celular
     · menus suspensos (notificações e usuário)
     · busca do header delegando para a busca de Contratos já existente
     · painel de notificações espelhando os alertas já renderizados no Dashboard
     · abas internas de Configurações
     · expandir/recolher as dívidas dentro de cada contrato
     · busca e paginação em listas já renderizadas (Imóveis, Histórico)

   Tudo que depende de dados continua vindo do index.js, que não foi alterado.
   Aqui só lemos o que ele já colocou na tela e reorganizamos a apresentação.
============================================================================= */

(function () {

  const root = document.documentElement;
  const $  = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  const SIDEBAR_KEY = 'aluguelApp_sidebar';
  const IMOVEIS_POR_PAGINA = 12;

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
     DRAWER — sidebar vira gaveta no celular
  =========================================================================== */
  let backdropEl = null;

  function openDrawer() {
    root.setAttribute('data-drawer', 'open');
    const btn = $('#uiDrawerToggle');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    if (!backdropEl) {
      backdropEl = document.createElement('div');
      backdropEl.className = 'sidebar-backdrop';
      backdropEl.addEventListener('click', closeDrawer);
      document.body.appendChild(backdropEl);
    }
  }

  function closeDrawer() {
    root.removeAttribute('data-drawer');
    const btn = $('#uiDrawerToggle');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (backdropEl) {
      backdropEl.remove();
      backdropEl = null;
    }
  }

  const drawerToggle = $('#uiDrawerToggle');
  if (drawerToggle) {
    drawerToggle.addEventListener('click', () => {
      root.getAttribute('data-drawer') === 'open' ? closeDrawer() : openDrawer();
    });
  }

  /* ===========================================================================
     NAVEGAÇÃO — acessibilidade e atalhos de menu
     O clique em si continua sendo tratado pelo index.js; aqui só refletimos o
     estado em `aria-current` e fechamos a gaveta no celular.
  =========================================================================== */
  const tabsNav = $('#tabsNav');

  function syncAriaCurrent() {
    $$('.tab-btn').forEach(btn => {
      if (btn.classList.contains('active')) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
  }

  if (tabsNav) {
    tabsNav.addEventListener('click', (e) => {
      if (!e.target.closest('.tab-btn')) return;
      syncAriaCurrent();
      closeDrawer();
    });
  }

  // Itens de menu que apenas levam para uma aba (ex: dropdown do usuário).
  $$('[data-tab-link]').forEach(item => {
    item.addEventListener('click', () => {
      const alvo = $(`.tab-btn[data-tab="${item.dataset.tabLink}"]`);
      if (alvo) alvo.click();
      closeAllDropdowns();
    });
  });

  /* ===========================================================================
     DROPDOWNS (notificações e usuário)
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
    d.button.addEventListener('click', (e) => {
      e.stopPropagation();
      const aberto = !d.menu.classList.contains('hidden');
      closeAllDropdowns(d);
      d.menu.classList.toggle('hidden', aberto);
      d.button.setAttribute('aria-expanded', String(!aberto));
    });
    // Clique dentro do menu não fecha os outros por borbulhamento; mas escolher
    // um item (inclusive "Sair") sempre fecha o menu.
    d.menu.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('.dropdown-item, .notif-item')) closeAllDropdowns();
    });
  });

  document.addEventListener('click', () => closeAllDropdowns());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllDropdowns();
      closeDrawer();
    }
  });

  /* ===========================================================================
     BUSCA DO HEADER
     Delega para o campo de busca de Contratos que já existe, disparando o mesmo
     evento `input` que o index.js já escuta — nenhuma lógica de filtro nova.
  =========================================================================== */
  const globalSearch = $('#globalSearch');
  const searchContratos = $('#searchContratos');

  if (globalSearch && searchContratos) {
    globalSearch.addEventListener('input', () => {
      const abaContratos = $('.tab-btn[data-tab="contratos"]');
      if (abaContratos && !abaContratos.classList.contains('active')) {
        abaContratos.click();
        syncAriaCurrent();
      }
      if (searchContratos.value === globalSearch.value) return;
      searchContratos.value = globalSearch.value;
      searchContratos.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Mantém os dois campos com o mesmo conteúdo.
    searchContratos.addEventListener('input', () => {
      if (globalSearch.value !== searchContratos.value) globalSearch.value = searchContratos.value;
    });
  }

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
        botao.setAttribute('role', 'menuitem');

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
     CONFIGURAÇÕES — abas internas
  =========================================================================== */
  const configTabs = $$('[data-config-tab]');
  const configSections = $$('[data-config-section]');

  configTabs.forEach(aba => {
    aba.addEventListener('click', () => {
      const alvo = aba.dataset.configTab;
      configTabs.forEach(b => {
        const ativo = b === aba;
        b.classList.toggle('is-active', ativo);
        b.setAttribute('aria-selected', String(ativo));
      });
      configSections.forEach(sec => {
        sec.classList.toggle('is-active', sec.dataset.configSection === alvo);
      });
    });
  });

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

  /* ===========================================================================
     LISTAS — busca e paginação sobre o que já está renderizado
     Não altera nenhum dado: apenas esconde/mostra linhas já criadas pelo JS.
  =========================================================================== */
  function criarFiltroDeLista({ listaId, buscaId, contadorId, paginacaoId, porPagina, rotuloSingular, rotuloPlural }) {
    const lista = document.getElementById(listaId);
    const busca = buscaId ? document.getElementById(buscaId) : null;
    const contador = contadorId ? document.getElementById(contadorId) : null;
    const paginacao = paginacaoId ? document.getElementById(paginacaoId) : null;
    if (!lista) return;

    let pagina = 1;

    function linhas() {
      return Array.from(lista.children).filter(el => !el.classList.contains('empty-state'));
    }

    function aplicar() {
      const termo = busca ? busca.value.trim().toLowerCase() : '';
      const todas = linhas();

      const visiveis = todas.filter(el => {
        const combina = !termo || (el.textContent || '').toLowerCase().includes(termo);
        el.dataset.uiMatch = combina ? '1' : '0';
        return combina;
      });

      const totalPaginas = porPagina ? Math.max(1, Math.ceil(visiveis.length / porPagina)) : 1;
      pagina = Math.min(Math.max(pagina, 1), totalPaginas);
      const inicio = porPagina ? (pagina - 1) * porPagina : 0;
      const fim = porPagina ? inicio + porPagina : visiveis.length;

      todas.forEach(el => { el.style.display = 'none'; });
      visiveis.slice(inicio, fim).forEach(el => { el.style.display = ''; });

      if (contador) {
        const n = visiveis.length;
        contador.textContent = n === 1
          ? `1 ${rotuloSingular}`
          : `${n} ${rotuloPlural}`;
      }

      // Sem resultado para a busca: mostra um estado vazio próprio, sem tocar
      // no estado vazio que o index.js gera quando não há dados nenhum.
      let semResultado = lista.querySelector('[data-ui-empty]');
      if (termo && !visiveis.length && todas.length) {
        if (!semResultado) {
          semResultado = document.createElement('div');
          semResultado.className = 'empty-state';
          semResultado.setAttribute('data-ui-empty', '');
          semResultado.textContent = 'Nenhum resultado para esta busca.';
          lista.appendChild(semResultado);
        }
      } else if (semResultado) {
        semResultado.remove();
      }

      if (paginacao) renderPaginacao(totalPaginas, visiveis.length);
    }

    function renderPaginacao(totalPaginas, totalItens) {
      paginacao.innerHTML = '';
      if (totalPaginas <= 1) return;

      const anterior = document.createElement('button');
      anterior.type = 'button';
      anterior.className = 'btn btn-ghost btn-sm';
      anterior.textContent = '‹ Anterior';
      anterior.disabled = pagina <= 1;
      anterior.addEventListener('click', () => { pagina--; aplicar(); });

      const info = document.createElement('span');
      info.className = 'pagination-info';
      info.textContent = `Página ${pagina} de ${totalPaginas} (${totalItens} ${totalItens === 1 ? rotuloSingular : rotuloPlural})`;

      const proxima = document.createElement('button');
      proxima.type = 'button';
      proxima.className = 'btn btn-ghost btn-sm';
      proxima.textContent = 'Próxima ›';
      proxima.disabled = pagina >= totalPaginas;
      proxima.addEventListener('click', () => { pagina++; aplicar(); });

      paginacao.appendChild(anterior);
      paginacao.appendChild(info);
      paginacao.appendChild(proxima);
    }

    if (busca) {
      busca.addEventListener('input', () => { pagina = 1; aplicar(); });
    }

    new MutationObserver(() => { aplicar(); }).observe(lista, { childList: true });
    aplicar();
  }

  // Só a lista de Imóveis usa este filtro de apresentação. O Histórico filtra de
  // verdade no index.js (contrato, ano e busca), porque lá o resultado também
  // alimenta a exportação em CSV — filtrar só escondendo linhas faria o arquivo
  // exportado sair diferente do que está na tela.
  criarFiltroDeLista({
    listaId: 'imoveisList',
    buscaId: 'uiImoveisSearch',
    contadorId: 'uiImoveisCount',
    paginacaoId: 'uiImoveisPagination',
    porPagina: IMOVEIS_POR_PAGINA,
    rotuloSingular: 'imóvel',
    rotuloPlural: 'imóveis',
  });

})();
