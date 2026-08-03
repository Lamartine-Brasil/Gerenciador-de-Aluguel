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

function isAuthenticated() {
    if (empty($_COOKIE[COOKIE_NAME])) return false;
    $parts = explode('.', $_COOKIE[COOKIE_NAME], 2);
    if (count($parts) !== 2) return false;
    list($encodedPayload, $signature) = $parts;
    $payload = base64_decode($encodedPayload, true);
    if ($payload === false) return false;
    $expected = hash_hmac('sha256', $payload, COOKIE_SECRET);
    if (!hash_equals($expected, $signature)) return false;
    $payloadParts = explode('|', $payload);
    if (count($payloadParts) !== 2) return false;
    list($user, $expires) = $payloadParts;
    if ((int)$expires < time()) return false;
    $auth = readAuth();
    if (!hash_equals($auth['username'], $user)) return false;
    return true;
}

function requireAuth() {
    if (!isAuthenticated()) {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Não autenticado']);
        exit;
    }
}
