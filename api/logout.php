<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

header('Content-Type: application/json; charset=utf-8');

// Só por POST (com a proteção contra CSRF de config.php): um link ou imagem de
// outro site não consegue mais desconectar ninguém.
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Método não permitido']);
    exit;
}

clearAuthCookie();
echo json_encode(['ok' => true]);
