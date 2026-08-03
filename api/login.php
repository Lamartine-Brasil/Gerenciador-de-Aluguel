<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

header('Content-Type: application/json; charset=utf-8');

$input = json_decode(file_get_contents('php://input'), true);
$username = trim((string)($input['username'] ?? ''));
$password = (string)($input['password'] ?? '');

$auth = readAuth();
$user = findUserByUsername($auth, $username);

if ($user !== null && password_verify($password, $user['passwordHash'])) {
    issueAuthCookie($user['username']);
    echo json_encode(['ok' => true, 'username' => $user['username']]);
} else {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'Usuário ou senha incorretos.']);
}
