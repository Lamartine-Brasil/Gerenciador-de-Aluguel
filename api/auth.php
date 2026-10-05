<?php
require_once __DIR__ . '/config.php';

// A assinatura do cookie usa, além da chave da instalação, o id do usuário e o
// hash da senha dele. Assim, trocar a senha derruba na hora todos os outros
// acessos desse usuário (um cookie roubado deixa de valer), e um usuário
// removido e depois recriado com o mesmo nome não "herda" os cookies antigos.
function chaveDoCookie($user) {
    return cookieSecret() . '|' . $user['id'] . '|' . $user['passwordHash'];
}

function issueAuthCookie($user) {
    $expires = time() + COOKIE_DAYS * 86400;
    $payload = $user['username'] . '|' . $expires;
    $signature = hash_hmac('sha256', $payload, chaveDoCookie($user));
    $value = base64_encode($payload) . '.' . $signature;
    setcookie(COOKIE_NAME, $value, [
        'expires' => $expires,
        'path' => '/',
        'secure' => conexaoSegura(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

// HTTPS direto ou atrás de um proxy que avisa (X-Forwarded-Proto) — só confia
// no aviso do proxy quando CONFIAR_X_FORWARDED_FOR está ligado.
function conexaoSegura() {
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') return true;
    return CONFIAR_X_FORWARDED_FOR && strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

function clearAuthCookie() {
    setcookie(COOKIE_NAME, '', [
        'expires' => time() - 3600,
        'path' => '/',
        'secure' => conexaoSegura(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

// Retorna o usuário validado do cookie de sessão atual, ou null se não houver
// sessão válida (cookie ausente, assinatura inválida, expirado, usuário que
// não existe mais em data/auth.json ou que trocou a senha depois do login).
function getAuthenticatedUser() {
    if (empty($_COOKIE[COOKIE_NAME]) || !is_string($_COOKIE[COOKIE_NAME])) return null;
    $parts = explode('.', $_COOKIE[COOKIE_NAME], 2);
    if (count($parts) !== 2) return null;
    list($encodedPayload, $signature) = $parts;
    $payload = base64_decode($encodedPayload, true);
    if ($payload === false) return null;
    // a validade é o que vem depois do ÚLTIMO "|"
    $sep = strrpos($payload, '|');
    if ($sep === false) return null;
    $username = substr($payload, 0, $sep);
    $expires = substr($payload, $sep + 1);
    if (!ctype_digit($expires) || (int)$expires < time()) return null;
    $user = findUserByUsername(readAuth(), $username);
    if ($user === null) return null;
    $expected = hash_hmac('sha256', $payload, chaveDoCookie($user));
    if (!hash_equals($expected, $signature)) return null;
    return $user;
}

function getAuthenticatedUsername() {
    $user = getAuthenticatedUser();
    return $user === null ? null : $user['username'];
}

function isAuthenticated() {
    return getAuthenticatedUser() !== null;
}

// A senha ainda é a padrão (admin/12345678, que está no README)? O navegador
// usa isso para insistir que ela seja trocada.
function usaSenhaPadrao($user) {
    return password_verify(DEFAULT_PASSWORD, $user['passwordHash']);
}

function requireAuth() {
    if (!isAuthenticated()) {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        // `sessaoExpirada` diferencia "precisa entrar de novo" de um 401 por senha
        // atual errada (account.php, users.php) — o navegador pede o login de
        // novo sem recarregar a página.
        echo json_encode(['ok' => false, 'sessaoExpirada' => true, 'error' => 'Sua sessão expirou. Entre de novo para continuar.']);
        exit;
    }
}
