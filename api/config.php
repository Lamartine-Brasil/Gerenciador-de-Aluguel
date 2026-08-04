<?php
// Configuração do backend. Este arquivo roda só no servidor — nunca é enviado ao navegador.

// Usuário e senha padrão usados apenas na primeira execução (quando ainda não
// existe api/../data/auth.json). Depois disso, o usuário pode alterá-los pela
// própria tela de Configurações do site, e esses valores abaixo deixam de ter efeito.
define('DEFAULT_USERNAME', 'admin');
define('DEFAULT_PASSWORD', '12345678');

// Chave usada para assinar o cookie de login. TROQUE por um valor aleatório
// antes de subir para o servidor (ex: gere uma string longa e aleatória).
define('COOKIE_SECRET', 'x7K9pQ2mZ4rL8vN1sT6wA3yB5cD0eF-troque-esta-chave');

define('COOKIE_NAME', 'aluguel_auth');
define('COOKIE_DAYS', 30);

define('DATA_DIR', __DIR__ . '/../data');
define('DATA_FILE', DATA_DIR . '/dados.json');
define('AUTH_FILE', DATA_DIR . '/auth.json');

define('CONTRATOS_DIR', __DIR__ . '/../contratos');
define('ANEXO_TIPOS_PERMITIDOS', ['pdf' => 'application/pdf', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png']);
define('ANEXO_TAMANHO_MAXIMO', 15 * 1024 * 1024); // 15MB

define('LOGIN_ATTEMPTS_FILE', DATA_DIR . '/login_attempts.json');
define('LOGIN_MAX_TENTATIVAS', 5);
define('LOGIN_BLOQUEIO_SEGUNDOS', 15 * 60); // 15 minutos de bloqueio após esgotar as tentativas

function ensureContratosDir() {
    if (!is_dir(CONTRATOS_DIR)) {
        mkdir(CONTRATOS_DIR, 0755, true);
    }
    $htaccess = CONTRATOS_DIR . '/.htaccess';
    if (!file_exists($htaccess)) {
        file_put_contents($htaccess, "<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n    Order deny,allow\n    Deny from all\n</IfModule>\n");
    }
}

// Transforma texto livre em algo seguro para nome de arquivo: minúsculo,
// sem acentos, só letras/números separados por hífen. Usa um mapa explícito
// de acentos em português em vez de iconv//TRANSLIT, cujo resultado varia
// entre sistemas (ex: pode virar "jo-ao" em vez de "joao").
function slugify($text) {
    $text = trim((string)$text);
    $mapaAcentos = [
        'á'=>'a','à'=>'a','ã'=>'a','â'=>'a','ä'=>'a',
        'é'=>'e','è'=>'e','ê'=>'e','ë'=>'e',
        'í'=>'i','ì'=>'i','î'=>'i','ï'=>'i',
        'ó'=>'o','ò'=>'o','õ'=>'o','ô'=>'o','ö'=>'o',
        'ú'=>'u','ù'=>'u','û'=>'u','ü'=>'u',
        'ç'=>'c','ñ'=>'n','ý'=>'y',
        'Á'=>'a','À'=>'a','Ã'=>'a','Â'=>'a','Ä'=>'a',
        'É'=>'e','È'=>'e','Ê'=>'e','Ë'=>'e',
        'Í'=>'i','Ì'=>'i','Î'=>'i','Ï'=>'i',
        'Ó'=>'o','Ò'=>'o','Õ'=>'o','Ô'=>'o','Ö'=>'o',
        'Ú'=>'u','Ù'=>'u','Û'=>'u','Ü'=>'u',
        'Ç'=>'c','Ñ'=>'n','Ý'=>'y',
    ];
    $text = strtr($text, $mapaAcentos);
    $text = strtolower($text);
    $text = preg_replace('/[^a-z0-9]+/', '-', $text);
    $text = trim($text, '-');
    return $text !== '' ? $text : 'arquivo';
}

function ensureDataFile() {
    if (!is_dir(DATA_DIR)) {
        mkdir(DATA_DIR, 0755, true);
    }
    if (!file_exists(DATA_FILE)) {
        $default = [
            'contratos' => [],
            'config' => ['taxaJurosMensal' => 1, 'taxaMultaPercent' => 2],
            'auditoria' => [],
        ];
        file_put_contents(DATA_FILE, json_encode($default, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    }
}

function ensureAuthFile() {
    if (!is_dir(DATA_DIR)) {
        mkdir(DATA_DIR, 0755, true);
    }
    if (!file_exists(AUTH_FILE)) {
        $default = [
            'users' => [
                [
                    'id' => generateUserId(),
                    'username' => DEFAULT_USERNAME,
                    'passwordHash' => password_hash(DEFAULT_PASSWORD, PASSWORD_DEFAULT),
                ],
            ],
        ];
        file_put_contents(AUTH_FILE, json_encode($default, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    }
}

function generateUserId() {
    return 'u_' . bin2hex(random_bytes(6));
}

// Lê data/auth.json. Migra automaticamente o formato antigo (um único
// {username, passwordHash}) para o novo formato com lista de usuários,
// preservando o login existente sem exigir nenhuma ação manual.
function readAuth() {
    ensureAuthFile();
    $data = json_decode(file_get_contents(AUTH_FILE), true);

    if (is_array($data) && !empty($data['username']) && !empty($data['passwordHash']) && empty($data['users'])) {
        $migrated = [
            'users' => [
                [
                    'id' => generateUserId(),
                    'username' => $data['username'],
                    'passwordHash' => $data['passwordHash'],
                ],
            ],
        ];
        writeAuth($migrated);
        return $migrated;
    }

    if (!is_array($data) || empty($data['users']) || !is_array($data['users'])) {
        return [
            'users' => [
                [
                    'id' => generateUserId(),
                    'username' => DEFAULT_USERNAME,
                    'passwordHash' => password_hash(DEFAULT_PASSWORD, PASSWORD_DEFAULT),
                ],
            ],
        ];
    }

    return $data;
}

function writeAuth($auth) {
    $fp = fopen(AUTH_FILE, 'c+');
    if ($fp === false) return false;
    flock($fp, LOCK_EX);
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($auth, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    return true;
}

function findUserByUsername($auth, $username) {
    foreach ($auth['users'] as $user) {
        if (hash_equals($user['username'], $username)) return $user;
    }
    return null;
}

function findUserById($auth, $id) {
    foreach ($auth['users'] as $user) {
        if ($user['id'] === $id) return $user;
    }
    return null;
}

// Limita tentativas de login por IP — sem isso, o login ficava aberto a
// força bruta ilimitada (mais grave ainda com a senha padrão admin/12345678
// antes de trocada). Guarda só um contador + timestamp por IP, sem dados
// sensíveis, em data/login_attempts.json (protegido pelo mesmo .htaccess de
// data/dados.json).
function clienteIp() {
    return (string)($_SERVER['REMOTE_ADDR'] ?? 'desconhecido');
}

function lerTentativasLogin() {
    if (!file_exists(LOGIN_ATTEMPTS_FILE)) return [];
    $data = json_decode((string)file_get_contents(LOGIN_ATTEMPTS_FILE), true);
    return is_array($data) ? $data : [];
}

function salvarTentativasLogin($tentativas) {
    if (!is_dir(DATA_DIR)) mkdir(DATA_DIR, 0755, true);
    $fp = fopen(LOGIN_ATTEMPTS_FILE, 'c+');
    if ($fp === false) return;
    flock($fp, LOCK_EX);
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($tentativas));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
}

// Quantos segundos ainda faltam de bloqueio para este IP (0 = pode tentar).
function segundosBloqueadoLogin($ip) {
    $tentativas = lerTentativasLogin();
    if (!isset($tentativas[$ip]) || $tentativas[$ip]['count'] < LOGIN_MAX_TENTATIVAS) return 0;
    $restante = ($tentativas[$ip]['lastAttempt'] + LOGIN_BLOQUEIO_SEGUNDOS) - time();
    return $restante > 0 ? $restante : 0;
}

function registrarTentativaLoginFalha($ip) {
    $tentativas = lerTentativasLogin();
    $agora = time();
    // limpa entradas velhas pra o arquivo não crescer pra sempre
    foreach ($tentativas as $chave => $t) {
        if ($agora - $t['lastAttempt'] > LOGIN_BLOQUEIO_SEGUNDOS * 4) unset($tentativas[$chave]);
    }
    if (!isset($tentativas[$ip])) $tentativas[$ip] = ['count' => 0, 'lastAttempt' => 0];
    $tentativas[$ip]['count']++;
    $tentativas[$ip]['lastAttempt'] = $agora;
    salvarTentativasLogin($tentativas);
}

function limparTentativasLogin($ip) {
    $tentativas = lerTentativasLogin();
    if (isset($tentativas[$ip])) {
        unset($tentativas[$ip]);
        salvarTentativasLogin($tentativas);
    }
}
