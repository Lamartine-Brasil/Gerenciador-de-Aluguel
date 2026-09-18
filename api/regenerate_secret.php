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

$currentUsername = getAuthenticatedUsername();
$auth = readAuth();
$user = findUserByUsername($auth, $currentUsername);

if ($user === null || !password_verify($currentPassword, $user['passwordHash'])) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'Senha atual incorreta.']);
    exit;
}

// A chave nova vai para data/cookie_secret.php (fora do Git). Antes ela era
// escrita dentro de api/config.php, que é código: quem atualizava o sistema
// copiando a pasta do projeto voltava sem perceber para a chave pública.
$novaChave = bin2hex(random_bytes(32));
if (!salvarCookieSecret($novaChave)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Não foi possível gravar a nova chave em data/. Confira se a pasta aceita gravação — nada foi alterado.']);
    exit;
}

// Reemite o cookie de quem pediu, já assinado com a chave nova — sem isso o
// próprio administrador que desconectou os outros seria desconectado também.
issueAuthCookie($currentUsername);

echo json_encode(['ok' => true]);
