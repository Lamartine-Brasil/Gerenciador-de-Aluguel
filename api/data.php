<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

header('Content-Type: application/json; charset=utf-8');
requireAuth();
ensureDataFile();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    echo file_get_contents(DATA_FILE);
    exit;
}

if ($method === 'POST') {
    $decoded = json_decode(file_get_contents('php://input'), true);
    if (!is_array($decoded) || !isset($decoded['contratos']) || !is_array($decoded['contratos']) || !isset($decoded['config']) || !is_array($decoded['config'])) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Dados inválidos.']);
        exit;
    }

    $fp = fopen(DATA_FILE, 'c+');
    if ($fp === false) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Não foi possível salvar os dados.']);
        exit;
    }
    flock($fp, LOCK_EX);
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($decoded, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);

    echo json_encode(['ok' => true]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Método não permitido']);
