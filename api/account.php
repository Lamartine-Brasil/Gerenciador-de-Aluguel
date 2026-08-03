<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

header('Content-Type: application/json; charset=utf-8');
requireAuth();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Método não permitido']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
$currentPassword = (string)($input['currentPassword'] ?? '');
$newUsername = trim((string)($input['newUsername'] ?? ''));
$newPassword = (string)($input['newPassword'] ?? '');

$auth = readAuth();

if (!password_verify($currentPassword, $auth['passwordHash'])) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'Senha atual incorreta.']);
    exit;
}

if ($newUsername === '') {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Informe um nome de usuário.']);
    exit;
}

if ($newPassword !== '' && strlen($newPassword) < 4) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'A nova senha deve ter pelo menos 4 caracteres.']);
    exit;
}

$auth['username'] = $newUsername;
if ($newPassword !== '') {
    $auth['passwordHash'] = password_hash($newPassword, PASSWORD_DEFAULT);
}

if (!writeAuth($auth)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Não foi possível salvar as alterações.']);
    exit;
}

issueAuthCookie($auth['username']);
echo json_encode(['ok' => true, 'username' => $auth['username']]);
