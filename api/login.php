<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Método não permitido']);
    exit;
}

$ip = clienteIp();
$bloqueadoPor = segundosBloqueadoLogin($ip);
if ($bloqueadoPor > 0) {
    http_response_code(429);
    $minutos = (int)ceil($bloqueadoPor / 60);
    echo json_encode(['ok' => false, 'error' => "Muitas tentativas incorretas. Tente novamente em {$minutos} minuto(s)."]);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
$username = trim((string)($input['username'] ?? ''));
$password = (string)($input['password'] ?? '');

$auth = readAuth();
$user = findUserByUsername($auth, $username);

if ($user !== null && password_verify($password, $user['passwordHash'])) {
    limparTentativasLogin($ip);
    issueAuthCookie($user['username']);
    echo json_encode(['ok' => true, 'username' => $user['username']]);
} else {
    registrarTentativaLoginFalha($ip);
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'Usuário ou senha incorretos.']);
}
