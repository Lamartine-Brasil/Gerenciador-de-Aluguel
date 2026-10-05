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

// A auditoria é decidida aqui, não no navegador: o que já está gravado não pode
// ser alterado nem apagado por uma gravação, e cada registro novo leva o
// usuário da sessão e a hora do servidor (não o nome e a hora que o navegador
// diz).
define('AUDITORIA_MAX', 300);
define('AUDITORIA_NOVOS_POR_GRAVACAO', 50);

function textoAuditoria($v, $max) {
    if (!is_string($v) && !is_int($v) && !is_float($v) && !is_bool($v) && $v !== null) return '';
    $t = (string)$v;
    if (!preg_match('//u', $t)) return '';
    return preg_match_all('/./us', $t) > $max ? implode('', array_slice(preg_split('//u', $t, -1, PREG_SPLIT_NO_EMPTY), 0, $max)) : $t;
}

function mesclarAuditoria($gravada, $enviada, $usuario) {
    $gravada = is_array($gravada) ? array_values(array_filter($gravada, 'is_array')) : [];
    $ids = [];
    foreach ($gravada as $r) if (isset($r['id'])) $ids[(string)$r['id']] = true;
    $agora = (int)round(microtime(true) * 1000);
    $novos = [];
    foreach ((is_array($enviada) ? $enviada : []) as $r) {
        if (!is_array($r) || !isset($r['id']) || !is_string($r['id']) || isset($ids[$r['id']])) continue;
        if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/', $r['id'])) continue;
        $alteracoes = [];
        foreach ((is_array($r['alteracoes'] ?? null) ? $r['alteracoes'] : []) as $alt) {
            if (!is_array($alt)) continue;
            $alteracoes[] = [
                'campo' => textoAuditoria($alt['campo'] ?? '', 200),
                'de' => is_scalar($alt['de'] ?? null) || ($alt['de'] ?? null) === null ? ($alt['de'] ?? null) : '',
                'para' => is_scalar($alt['para'] ?? null) || ($alt['para'] ?? null) === null ? ($alt['para'] ?? null) : '',
            ];
            if (count($alteracoes) >= 100) break;
        }
        $novos[] = [
            'id' => $r['id'],
            'timestamp' => $agora,
            'usuario' => $usuario,
            'acao' => textoAuditoria($r['acao'] ?? '', 60),
            'descricao' => textoAuditoria($r['descricao'] ?? '', 2000),
            'alteracoes' => $alteracoes,
        ];
        $ids[$r['id']] = true;
        if (count($novos) >= AUDITORIA_NOVOS_POR_GRAVACAO) break;
    }
    return array_slice(array_merge($gravada, $novos), -AUDITORIA_MAX);
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
    $usuario = getAuthenticatedUsername();
    $resultado = comTrava(true, function () use ($entrada, $dados, $usuario) {
        $atual = json_decode((string)file_get_contents(DATA_FILE), true);
        if (!is_array($atual)) return ['status' => 500, 'erro' => 'O arquivo de dados não pôde ser lido. Nada foi alterado.'];
        $versaoAtual = versaoDe($atual);
        if ($entrada['baseVersao'] !== $versaoAtual) {
            return ['status' => 409, 'versao' => $versaoAtual];
        }
        $dados['auditoria'] = mesclarAuditoria($atual['auditoria'] ?? [], $dados['auditoria'] ?? [], $usuario);
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
