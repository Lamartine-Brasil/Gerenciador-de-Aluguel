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

$currentUsername = getAuthenticatedUsername();
$auth = readAuth();
$userIndex = null;
foreach ($auth['users'] as $i => $u) {
    if (hash_equals($u['username'], $currentUsername)) { $userIndex = $i; break; }
}

if ($userIndex === null || !password_verify($currentPassword, $auth['users'][$userIndex]['passwordHash'])) {
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

foreach ($auth['users'] as $i => $u) {
    if ($i !== $userIndex && strcasecmp($u['username'], $newUsername) === 0) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Já existe outro usuário com esse nome.']);
        exit;
    }
}

$auth['users'][$userIndex]['username'] = $newUsername;
if ($newPassword !== '') {
    $auth['users'][$userIndex]['passwordHash'] = password_hash($newPassword, PASSWORD_DEFAULT);
}

if (!writeAuth($auth)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Não foi possível salvar as alterações.']);
    exit;
}

issueAuthCookie($newUsername);
echo json_encode(['ok' => true, 'username' => $newUsername]);
