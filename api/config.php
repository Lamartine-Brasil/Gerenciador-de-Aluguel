<?php
// Configuração do backend. Este arquivo roda só no servidor — nunca é enviado ao navegador.

// Usuário e senha padrão usados apenas na primeira execução (quando ainda não
// existe api/../data/auth.json). Depois disso, o usuário pode alterá-los pela
// própria tela de Configurações do site, e esses valores abaixo deixam de ter efeito.
define('DEFAULT_USERNAME', 'admin');
define('DEFAULT_PASSWORD', '123456');

// Chave usada para assinar o cookie de login. TROQUE por um valor aleatório
// antes de subir para o servidor (ex: gere uma string longa e aleatória).
define('COOKIE_SECRET', 'x7K9pQ2mZ4rL8vN1sT6wA3yB5cD0eF-troque-esta-chave');

define('COOKIE_NAME', 'aluguel_auth');
define('COOKIE_DAYS', 30);

define('DATA_DIR', __DIR__ . '/../data');
define('DATA_FILE', DATA_DIR . '/dados.json');
define('AUTH_FILE', DATA_DIR . '/auth.json');

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
