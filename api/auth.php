<?php
require_once __DIR__ . '/config.php';

function issueAuthCookie($username) {
    $expires = time() + COOKIE_DAYS * 86400;
    $payload = $username . '|' . $expires;
    $signature = hash_hmac('sha256', $payload, COOKIE_SECRET);
    $value = base64_encode($payload) . '.' . $signature;
    $secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    setcookie(COOKIE_NAME, $value, [
        'expires' => $expires,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function clearAuthCookie() {
    setcookie(COOKIE_NAME, '', [
        'expires' => time() - 3600,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

// Retorna o username validado do cookie de sessão atual, ou null se não
// houver sessão válida (cookie ausente, assinatura inválida, expirado, ou
// o usuário não existe mais em data/auth.json).
function getAuthenticatedUsername() {
    if (empty($_COOKIE[COOKIE_NAME])) return null;
    $parts = explode('.', $_COOKIE[COOKIE_NAME], 2);
    if (count($parts) !== 2) return null;
    list($encodedPayload, $signature) = $parts;
    $payload = base64_decode($encodedPayload, true);
    if ($payload === false) return null;
    $expected = hash_hmac('sha256', $payload, COOKIE_SECRET);
    if (!hash_equals($expected, $signature)) return null;
    $payloadParts = explode('|', $payload);
    if (count($payloadParts) !== 2) return null;
    list($user, $expires) = $payloadParts;
    if ((int)$expires < time()) return null;
    $auth = readAuth();
    if (findUserByUsername($auth, $user) === null) return null;
    return $user;
}

function isAuthenticated() {
    return getAuthenticatedUsername() !== null;
}

function requireAuth() {
    if (!isAuthenticated()) {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Não autenticado']);
        exit;
    }
}
