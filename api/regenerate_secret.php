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

$configPath = __DIR__ . '/config.php';
$original = file_get_contents($configPath);
if ($original === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Não foi possível ler api/config.php.']);
    exit;
}

// A nova chave é sempre hexadecimal (bin2hex), então nunca pode conter aspas,
// barras ou qualquer caractere que quebre a string PHP — a substituição é
// estruturalmente segura. Mesmo assim só grava se o padrão exato for
// encontrado, para nunca deixar api/config.php num estado inesperado.
$novaChave = bin2hex(random_bytes(32));
$padrao = "/define\\('COOKIE_SECRET',\\s*'(?:[^'\\\\]|\\\\.)*'\\);/";
if (!preg_match($padrao, $original)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Não foi possível localizar COOKIE_SECRET em api/config.php — nada foi alterado.']);
    exit;
}
$atualizado = preg_replace($padrao, "define('COOKIE_SECRET', '{$novaChave}');", $original, 1);
if ($atualizado === null || $atualizado === $original) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Falha ao gerar a nova configuração — nada foi alterado.']);
    exit;
}

// Escreve num arquivo temporário e só substitui via rename() (atômico no
// sistema de arquivos) — nunca deixa api/config.php pela metade se algo falhar.
$tmpPath = $configPath . '.tmp';
if (file_put_contents($tmpPath, $atualizado, LOCK_EX) === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Não foi possível escrever o arquivo temporário.']);
    exit;
}
if (!rename($tmpPath, $configPath)) {
    @unlink($tmpPath);
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Não foi possível substituir api/config.php.']);
    exit;
}

// Reemitir o cookie do usuário atual já assinado com a chave nova — sem isso
// o próprio administrador que gerou a chave seria deslogado imediatamente.
$expires = time() + COOKIE_DAYS * 86400;
$payload = $currentUsername . '|' . $expires;
$signature = hash_hmac('sha256', $payload, $novaChave);
$value = base64_encode($payload) . '.' . $signature;
$secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
setcookie(COOKIE_NAME, $value, [
    'expires' => $expires,
    'path' => '/',
    'secure' => $secure,
    'httponly' => true,
    'samesite' => 'Lax',
]);

echo json_encode(['ok' => true]);
