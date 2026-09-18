<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
requireAuth();
ensureDataFile();

$method = $_SERVER['REQUEST_METHOD'];

// Versão dos dados: um número em `versao`, dentro do próprio dados.json, que
// sobe a cada gravação. Arquivos de antes desse campo contam como versão 0.
function versaoDe($dados) {
    return (is_array($dados) && isset($dados['versao'])) ? (int)$dados['versao'] : 0;
}

if ($method === 'GET') {
    $conteudo = comTrava(false, function () { return file_get_contents(DATA_FILE); });
    $dados = json_decode($conteudo, true);
    if (!is_array($dados)) {
        // Nunca deixa o navegador abrir "vazio" por cima de um arquivo que não
        // conseguiu ler: é assim que um erro de leitura virava perda de dados.
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'O arquivo de dados não pôde ser lido. Nada foi alterado.']);
        exit;
    }
    // ?versao=1 devolve só o número — usado para saber, ao voltar para a aba,
    // se alguém gravou alguma coisa enquanto ela estava parada.
    if (isset($_GET['versao'])) {
        echo json_encode(['ok' => true, 'versao' => versaoDe($dados)]);
        exit;
    }
    // o conteúdo vai como está no arquivo (reconverter trocaria {} por [])
    echo $conteudo;
    exit;
}

if ($method === 'POST') {
    // Formato: { baseVersao: N, dados: {...} }. Sem `baseVersao` a gravação é
    // recusada — o servidor não aceita gravar às cegas por cima do que existe.
    $entrada = json_decode(file_get_contents('php://input'), true);
    $dados = is_array($entrada) ? ($entrada['dados'] ?? null) : null;
    if (!is_array($entrada) || !array_key_exists('baseVersao', $entrada) || !is_int($entrada['baseVersao'])
        || !is_array($dados) || !isset($dados['contratos']) || !is_array($dados['contratos'])
        || !isset($dados['config']) || !is_array($dados['config'])) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Dados inválidos. Recarregue a página e tente de novo.']);
        exit;
    }

    // Compara a versão e grava dentro da mesma trava: entre conferir e gravar,
    // ninguém mais consegue gravar.
    $resultado = comTrava(true, function () use ($entrada, $dados) {
        $atual = json_decode((string)file_get_contents(DATA_FILE), true);
        if (!is_array($atual)) return ['status' => 500, 'erro' => 'O arquivo de dados não pôde ser lido. Nada foi alterado.'];
        $versaoAtual = versaoDe($atual);
        if ($entrada['baseVersao'] !== $versaoAtual) {
            return ['status' => 409, 'versao' => $versaoAtual];
        }
        $dados['versao'] = $versaoAtual + 1;
        if (!gravarArquivoAtomico(DATA_FILE, json_encode($dados, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE))) {
            return ['status' => 500, 'erro' => 'Não foi possível salvar os dados no servidor.'];
        }
        return ['status' => 200, 'versao' => $dados['versao']];
    });

    http_response_code($resultado['status']);
    if ($resultado['status'] === 409) {
        echo json_encode([
            'ok' => false,
            'conflito' => true,
            'versao' => $resultado['versao'],
            'error' => 'Os dados foram alterados em outra aba ou por outro usuário.',
        ]);
    } elseif ($resultado['status'] === 200) {
        echo json_encode(['ok' => true, 'versao' => $resultado['versao']]);
    } else {
        echo json_encode(['ok' => false, 'error' => $resultado['erro']]);
    }
    exit;
}

http_response_code(405);
echo json_encode(['ok' => false, 'error' => 'Método não permitido']);
