<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

header('Content-Type: application/json; charset=utf-8');
requireAuth();
ensureDataFile();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    echo comTrava(false, function () { return file_get_contents(DATA_FILE); });
    exit;
}

if ($method === 'POST') {
    $decoded = json_decode(file_get_contents('php://input'), true);
    if (!is_array($decoded) || !isset($decoded['contratos']) || !is_array($decoded['contratos']) || !isset($decoded['config']) || !is_array($decoded['config'])) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Dados inválidos.']);
        exit;
    }

    $gravou = comTrava(true, function () use ($decoded) {
        return gravarArquivoAtomico(DATA_FILE, json_encode($decoded, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    });
    if (!$gravou) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Não foi possível salvar os dados.']);
        exit;
    }

    echo json_encode(['ok' => true]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Método não permitido']);
