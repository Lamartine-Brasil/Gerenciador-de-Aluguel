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
$erro = null;
$usuarioAtualizado = null;

// Tudo entre ler e gravar o auth.json acontece sob a trava exclusiva.
$gravou = atualizarAuth(function ($auth) use ($currentUsername, $currentPassword, $newUsername, $newPassword, &$erro, &$usuarioAtualizado) {
    $userIndex = null;
    foreach ($auth['users'] as $i => $u) {
        if (hash_equals($u['username'], $currentUsername)) { $userIndex = $i; break; }
    }
    if ($userIndex === null || !password_verify($currentPassword, $auth['users'][$userIndex]['passwordHash'])) {
        $erro = [401, 'Senha atual incorreta.'];
        return null;
    }
    $erroNome = erroNomeUsuario($newUsername);
    if ($erroNome !== null) {
        $erro = [400, $erroNome];
        return null;
    }
    if ($newPassword !== '' && strlen($newPassword) < 8) {
        $erro = [400, 'A nova senha deve ter pelo menos 8 caracteres.'];
        return null;
    }
    foreach ($auth['users'] as $i => $u) {
        if ($i !== $userIndex && strcasecmp($u['username'], $newUsername) === 0) {
            $erro = [400, 'Já existe outro usuário com esse nome.'];
            return null;
        }
    }
    $auth['users'][$userIndex]['username'] = $newUsername;
    if ($newPassword !== '') {
        $auth['users'][$userIndex]['passwordHash'] = password_hash($newPassword, PASSWORD_DEFAULT);
    }
    $usuarioAtualizado = $auth['users'][$userIndex];
    return $auth;
});

if ($erro !== null) {
    http_response_code($erro[0]);
    echo json_encode(['ok' => false, 'error' => $erro[1]]);
    exit;
}

if (!$gravou) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Não foi possível salvar as alterações.']);
    exit;
}

// Com a senha nova, os cookies antigos deste usuário deixam de valer (ver
// chaveDoCookie em auth.php); quem trocou recebe um cookie novo aqui.
issueAuthCookie($usuarioAtualizado);
echo json_encode(['ok' => true, 'username' => $newUsername, 'senhaPadrao' => usaSenhaPadrao($usuarioAtualizado)]);
