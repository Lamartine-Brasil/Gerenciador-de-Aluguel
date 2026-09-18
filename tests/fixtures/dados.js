'use strict';

/* Dados fictícios para os testes. Nenhum nome, documento ou valor aqui é real.
 *
 * Os testes congelam o relógio do navegador em HOJE (abaixo), então as datas
 * são fixas: o que está "em atraso", "a vencer" ou "no aniversário de
 * reajuste" é sempre o mesmo, em qualquer dia em que os testes rodarem.
 *
 * Cenários cobertos: contrato com e sem corretor; condomínio cobrado junto e
 * pago direto; dívidas pagas, a vencer e em atraso; contrato encerrado com
 * caução devolvida; contratos retroativos com vários anos de histórico;
 * despesas gerais e ligadas a contrato; pessoas; e 25 contratos (duas páginas).
 * `carteiras` escolhe entre nenhuma, uma ou várias carteiras.
 */

const HOJE = '2026-09-17';

let seq = 0;
const id = (prefixo) => `${prefixo}_teste_${(++seq).toString(36)}`;

function addMonthsClamped(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const total = (m - 1) + n;
  const ano = y + Math.floor(total / 12);
  const mes = ((total % 12) + 12) % 12;
  const dias = new Date(ano, mes + 1, 0).getDate();
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(Math.min(d, dias)).padStart(2, '0')}`;
}

function primeiroVencimento(inicio, dia) {
  const [y, m] = inicio.split('-').map(Number);
  const ano = y + Math.floor(m / 12);
  const mes = m % 12;
  const dias = new Date(ano, mes + 1, 0).getDate();
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(Math.min(dia, dias)).padStart(2, '0')}`;
}

// Mesma regra do sistema: o primeiro vencimento sempre existe; os seguintes,
// só até hoje.
function vencimentos(inicio, dia, ate) {
  const primeiro = primeiroVencimento(inicio, dia);
  const lista = [primeiro];
  for (let i = 1; i < 400; i++) {
    const v = addMonthsClamped(primeiro, i);
    if (v > ate) break;
    lista.push(v);
  }
  return lista;
}

function total(d) {
  const cond = d.condominioDireto ? 0 : d.condominio;
  return d.aluguel - d.desconto + d.juros + d.multa + cond;
}

function contrato(opcoes) {
  const {
    numero, imovel, inquilino, carteiraId = '', quemRecebeu = '', inicio, dia,
    aluguel, juros = 0, multa = 0, desconto = 0, condominio = 0, condominioDireto = false,
    corretorNome = '', corretorPercentual = 0, caucao = 0, encerradoEm = null,
    caucaoDevolvida = null, dataUltimoReajuste = null,
    naoPagas = [],            // vencimentos que ficam em aberto
    condominioJunto = [],     // vencimentos em que o condomínio veio junto
    formas = ['Pix', 'Dinheiro'],
    recebedor = quemRecebeu || 'Ana Souza',
    atePagamento = HOJE,
  } = opcoes;

  const fim = encerradoEm || HOJE;
  const dividas = vencimentos(inicio, dia, fim).map((venc, i) => {
    const d = {
      id: id('d'), vencimento: venc, aluguel, desconto, juros, multa, condominio,
      condominioDireto, valorAtrasoBase: 0, observacao: '', pago: false,
      dataPagamento: null, pagamentos: [], criadoEm: Date.parse(venc) - 86400000 * 20 + i,
    };
    d.total = total(d);
    const aberta = naoPagas.includes(venc) || venc > atePagamento;
    if (!aberta) {
      // paga com alguns dias de diferença, alternando a forma de pagamento
      const dataPag = addDias(venc, (i % 4) - 1);
      const condJunto = condominioJunto.includes(venc);
      const cobraCond = !condominioDireto && condominio > 0;
      const valor = d.total - (cobraCond && !condJunto ? condominio : 0);
      d.pagamentos.push({
        data: dataPag, desconto: 0, motivoDesconto: '', valor,
        forma: formas[i % formas.length], quemRecebeu: recebedor,
        condominioRecebido: cobraCond ? condJunto : false,
        observacao: i % 5 === 0 ? 'Pago na imobiliária' : '',
      });
      d.pago = true;
      d.dataPagamento = dataPag;
    }
    return d;
  });

  return {
    id: id('c'), numero, imovel, carteiraId, inquilino, quemRecebeu, dataInicio: inicio,
    diaPagamento: dia, aluguel, desconto, juros, multa, condominio, condominioDireto,
    anexoContrato: null, corretorNome, corretorPercentual, caucao,
    dataUltimoReajuste: dataUltimoReajuste || inicio,
    caucaoDevolvida: !!caucaoDevolvida,
    dataCaucaoDevolvida: caucaoDevolvida ? caucaoDevolvida.data : null,
    valorCaucaoDevolvida: caucaoDevolvida ? caucaoDevolvida.valor : null,
    encerrado: !!encerradoEm, dataEncerramento: encerradoEm,
    criadoEm: Date.parse(inicio), dividas,
  };
}

function addDias(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {{ carteiras?: 'nenhuma' | 'uma' | 'varias' }} opcoes
 */
function gerarDados({ carteiras = 'varias' } = {}) {
  seq = 0;
  const carteiraA = { id: 'cart_a', nome: 'Imóveis do Sr. João', proprietario: 'João da Silva', documento: '123.456.789-00', observacao: 'Repasse todo dia 10', criadoEm: Date.parse('2025-01-01') };
  const carteiraB = { id: 'cart_b', nome: 'Família Pereira', proprietario: 'Helena Pereira', documento: '12.345.678/0001-90', observacao: '', criadoEm: Date.parse('2025-02-01') };
  const lista = carteiras === 'nenhuma' ? [] : carteiras === 'uma' ? [carteiraA] : [carteiraA, carteiraB];
  const cart = (c) => (lista.includes(c) ? c.id : '');

  const pessoas = [
    { id: 'p1', nome: 'Ana Souza', carteiraId: '' },
    { id: 'p2', nome: 'Carlos Lima', carteiraId: '' },
    { id: 'p3', nome: 'Paula Reis', carteiraId: cart(carteiraB) },
  ];

  const imoveis = [
    { id: 'i1', nome: 'Apto 101 - Rua das Flores, 10', carteiraId: cart(carteiraA) },
    { id: 'i2', nome: 'Apto 202 - Rua das Flores, 10', carteiraId: cart(carteiraA) },
    { id: 'i3', nome: 'Casa - Av. Brasil, 500', carteiraId: cart(carteiraB) },
    { id: 'i4', nome: 'Sala 3 - Centro Comercial', carteiraId: '' },
    { id: 'i5', nome: 'Kitnet 4 - Rua Chile, 45', carteiraId: '' },
    { id: 'i6', nome: 'Loja 1 - Rua Nova, 7', carteiraId: '' },
  ];

  const contratos = [
    // corretor + condomínio cobrado junto + caução + reajuste vencido + 2 em atraso
    contrato({
      numero: 1, imovel: imoveis[0].nome, inquilino: 'Maria Oliveira', carteiraId: cart(carteiraA),
      quemRecebeu: 'Ana Souza', inicio: '2025-06-10', dia: 10, aluguel: 1500, juros: 15, multa: 30,
      condominio: 400, corretorNome: 'Carlos Lima', corretorPercentual: 5, caucao: 3000,
      naoPagas: ['2026-08-10', '2026-09-10'], condominioJunto: ['2025-12-10', '2026-03-10'],
    }),
    // condomínio pago direto, sem corretor, uma em atraso
    contrato({
      numero: 2, imovel: imoveis[1].nome, inquilino: 'José Santos', carteiraId: cart(carteiraA),
      quemRecebeu: 'Ana Souza', inicio: '2026-01-20', dia: 20, aluguel: 1200, condominio: 350,
      condominioDireto: true, naoPagas: ['2026-08-20'],
    }),
    // encerrado, retroativo, caução devolvida, uma dívida antiga em atraso
    contrato({
      numero: 3, imovel: imoveis[2].nome, inquilino: 'Fernanda Costa', carteiraId: cart(carteiraB),
      quemRecebeu: 'Paula Reis', inicio: '2024-03-05', dia: 5, aluguel: 2200, corretorNome: 'Paula Reis',
      corretorPercentual: 8, caucao: 2000, encerradoEm: '2025-12-31',
      caucaoDevolvida: { data: '2026-01-10', valor: 1800 }, naoPagas: ['2025-11-05'],
      recebedor: 'Paula Reis',
    }),
    // a vencer em 3 dias (alerta de vencimento)
    contrato({
      numero: 4, imovel: imoveis[4].nome, inquilino: 'Pedro Almeida', inicio: '2026-08-25', dia: 20,
      aluguel: 850,
    }),
    // vários anos de histórico (mais de 20 pagamentos), uma em atraso
    contrato({
      numero: 5, imovel: imoveis[3].nome, inquilino: 'Ricardo Mendes Advocacia', inicio: '2023-01-15',
      dia: 15, aluguel: 3100, dataUltimoReajuste: '2025-10-01', naoPagas: ['2026-09-15'],
    }),
  ];

  // 20 contratos pequenos, para a lista de contratos ter duas páginas
  for (let n = 6; n <= 25; n++) {
    const nome = `Vaga de garagem ${n - 5}`;
    imoveis.push({ id: `iv${n}`, nome, carteiraId: '' });
    contratos.push(contrato({
      numero: n, imovel: nome, inquilino: `Inquilino Teste ${n}`, inicio: '2026-07-01', dia: 1,
      aluguel: 150 + n, naoPagas: n % 3 === 0 ? ['2026-09-01'] : [], dataUltimoReajuste: '2026-07-01',
    }));
  }

  const despesas = [];
  for (let i = 0; i < 24; i++) {
    const mes = (i % 9) + 1;
    const ligada = i % 3 === 0 ? contratos[i % 5] : null;
    despesas.push({
      id: `desp${i}`, data: `2026-${String(mes).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
      descricao: ['Manutenção hidráulica', 'Pintura', 'IPTU parcela', 'Troca de fechadura'][i % 4] + ` ${i + 1}`,
      valor: 80 + i * 17.5, contratoId: ligada ? ligada.id : null,
      carteiraId: !ligada && i % 4 === 1 ? cart(carteiraB) : '', criadoEm: Date.parse('2026-01-01') + i,
    });
  }
  for (let i = 0; i < 5; i++) {
    despesas.push({
      id: `desp25_${i}`, data: `2025-${String(i + 3).padStart(2, '0')}-12`, descricao: `Reparo telhado ${i + 1}`,
      valor: 300 + i * 40, contratoId: null, carteiraId: '', criadoEm: Date.parse('2025-01-01') + i,
    });
  }

  const auditoria = [
    { id: 'a1', timestamp: Date.parse('2026-07-02T10:00:00'), usuario: 'admin', acao: 'contrato_criado', descricao: 'Contrato criado: Kitnet 4 - Rua Chile, 45 - Pedro Almeida', alteracoes: [] },
    { id: 'a2', timestamp: Date.parse('2026-08-11T15:30:00'), usuario: 'gerente', acao: 'divida_editada', descricao: 'Dívida editada: Apto 101 - Rua das Flores, 10 - Maria Oliveira (10-08-2026)', alteracoes: [{ campo: 'Desconto (R$)', de: 0, para: 50 }] },
    { id: 'a3', timestamp: Date.parse('2025-12-31T09:00:00'), usuario: 'admin', acao: 'contrato_encerrado', descricao: 'Contrato encerrado: Casa - Av. Brasil, 500 - Fernanda Costa', alteracoes: [] },
  ];

  return {
    contratos,
    config: {
      taxaJurosMensal: 1, taxaMultaPercent: 2, corretorPercentualPadrao: 5, percentualReajusteSugerido: 5,
      recibo: {
        titulo: 'RECIBO DE ALUGUEL', cidade: 'Belo Horizonte',
        corpo: 'Recibo nº {{recibo_numero}}\n\nRecebi de {{inquilino}} a importância de {{valor_pago}} ({{valor_extenso}}), referente ao aluguel do imóvel {{imovel}}, competência {{mes_referencia}}.',
        rodape: '{{cidade_data}}\n\n\n_______________________\n{{quem_recebeu}}',
      },
    },
    auditoria, pessoas, despesas, imoveis, carteiras: lista,
  };
}

module.exports = { gerarDados, HOJE };
