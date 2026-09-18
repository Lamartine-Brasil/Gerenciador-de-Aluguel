<?php
// Configuração do backend. Este arquivo roda só no servidor — nunca é enviado ao navegador.

// Usuário e senha padrão usados apenas na primeira execução (quando ainda não
// existe api/../data/auth.json). Depois disso, o usuário pode alterá-los pela
// própria tela de Configurações do site, e esses valores abaixo deixam de ter efeito.
define('DEFAULT_USERNAME', 'admin');
define('DEFAULT_PASSWORD', '12345678');

// Chave que assina o cookie de login. NÃO precisa mexer aqui: no primeiro
// acesso o sistema gera uma chave aleatória só desta instalação e guarda em
// data/cookie_secret.php (fora do Git). Ver cookieSecret(), mais abaixo.
//
// O valor abaixo é o antigo padrão, que está publicado no repositório — por
// isso ele NUNCA é usado como chave. Só continua aqui para não desconectar
// quem já tinha trocado este valor à mão num servidor: um valor diferente do
// padrão continua valendo enquanto data/cookie_secret.php não existir.
define('COOKIE_SECRET', 'x7K9pQ2mZ4rL8vN1sT6wA3yB5cD0eF-troque-esta-chave');
define('COOKIE_SECRET_PUBLICO', 'x7K9pQ2mZ4rL8vN1sT6wA3yB5cD0eF-troque-esta-chave');

define('COOKIE_NAME', 'aluguel_auth');
define('COOKIE_DAYS', 30);

// As pastas de dados podem vir de variáveis de ambiente — usado só pelos testes,
// para rodar o sistema contra uma cópia isolada e nunca contra os dados reais.
// Sem as variáveis definidas (o caso de qualquer hospedagem), nada muda.
define('DATA_DIR', getenv('ALUGUEL_DATA_DIR') ?: __DIR__ . '/../data');
define('DATA_FILE', DATA_DIR . '/dados.json');
define('AUTH_FILE', DATA_DIR . '/auth.json');
// Um .php que só devolve a chave: mesmo se o .htaccess de data/ falhar, abrir
// este arquivo pelo navegador executa o PHP e não mostra nada.
define('COOKIE_SECRET_FILE', DATA_DIR . '/cookie_secret.php');

define('CONTRATOS_DIR', getenv('ALUGUEL_CONTRATOS_DIR') ?: __DIR__ . '/../contratos');
define('ANEXO_TIPOS_PERMITIDOS', ['pdf' => 'application/pdf', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png']);
define('ANEXO_TAMANHO_MAXIMO', 15 * 1024 * 1024); // 15MB

define('LOGIN_ATTEMPTS_FILE', DATA_DIR . '/login_attempts.json');
// Trava das gravações. É um arquivo à parte (e não o próprio dados.json) porque
// a gravação troca o arquivo de dados inteiro por outro (rename), e uma trava
// presa ao arquivo antigo deixaria de valer no meio do caminho.
define('LOCK_FILE', DATA_DIR . '/dados.lock');
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

function ensureDataDir() {
    if (!is_dir(DATA_DIR)) {
        mkdir(DATA_DIR, 0755, true);
    }
}

// Grava um arquivo de uma vez só: escreve tudo num temporário na mesma pasta e
// troca pelo definitivo com rename(), que é atômico no sistema de arquivos. Quem
// lê no meio de uma gravação pega o arquivo antigo inteiro ou o novo inteiro —
// nunca um pedaço. Truncar e reescrever o próprio arquivo, como era antes,
// deixava leituras simultâneas com o JSON pela metade.
function gravarArquivoAtomico($caminho, $conteudo) {
    $tmp = $caminho . '.tmp-' . bin2hex(random_bytes(6));
    if (file_put_contents($tmp, $conteudo) === false) {
        @unlink($tmp);
        return false;
    }
    @chmod($tmp, 0644);
    if (!@rename($tmp, $caminho)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

// Executa $fn com a trava das gravações: exclusiva para quem vai ler-e-gravar,
// compartilhada para quem só lê. Todo "ler, alterar e gravar" precisa estar
// inteiro dentro de uma trava exclusiva, senão duas requisições ao mesmo tempo
// perdem a alteração uma da outra.
function comTrava($exclusiva, $fn) {
    // Reentrante: quem já está com a trava (ex: atualizarAuth → readAuth →
    // ensureAuthFile) não pede de novo — um segundo flock no mesmo processo
    // esperaria por ele mesmo para sempre.
    static $nivel = 0;
    if ($nivel > 0) return $fn();
    ensureDataDir();
    $fp = fopen(LOCK_FILE, 'c');
    if ($fp === false) {
        throw new RuntimeException('Não foi possível abrir a trava de gravação em ' . LOCK_FILE);
    }
    flock($fp, $exclusiva ? LOCK_EX : LOCK_SH);
    $nivel++;
    try {
        return $fn();
    } finally {
        $nivel--;
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}

function ensureDataFile() {
    ensureDataDir();
    if (file_exists(DATA_FILE)) return;
    comTrava(true, function () {
        if (file_exists(DATA_FILE)) return;
        $default = [
            'contratos' => [],
            'config' => ['taxaJurosMensal' => 1, 'taxaMultaPercent' => 2],
            'auditoria' => [],
            'versao' => 0,
        ];
        gravarArquivoAtomico(DATA_FILE, json_encode($default, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    });
}

function ensureAuthFile() {
    ensureDataDir();
    if (file_exists(AUTH_FILE)) return;
    comTrava(true, function () {
        if (file_exists(AUTH_FILE)) return;
        $default = [
            'users' => [
                [
                    'id' => generateUserId(),
                    'username' => DEFAULT_USERNAME,
                    'passwordHash' => password_hash(DEFAULT_PASSWORD, PASSWORD_DEFAULT),
                ],
            ],
        ];
        gravarArquivoAtomico(AUTH_FILE, json_encode($default, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    });
}

// Chave do cookie de login, nesta ordem:
//   1. data/cookie_secret.php, se existir (gerado aqui ou pelo botão
//      "Desconectar todos os outros acessos");
//   2. o COOKIE_SECRET de config.php, se alguém trocou o valor padrão à mão;
//   3. senão, gera uma chave aleatória agora e grava em data/cookie_secret.php.
function cookieSecret() {
    if (isset($GLOBALS['__cookieSecret'])) return $GLOBALS['__cookieSecret'];
    $chave = lerCookieSecretArquivo();
    if ($chave === null && COOKIE_SECRET !== COOKIE_SECRET_PUBLICO && strlen(COOKIE_SECRET) >= 16) {
        $chave = COOKIE_SECRET;
    }
    if ($chave === null) {
        $chave = comTrava(true, function () {
            $existente = lerCookieSecretArquivo(); // outra requisição pode ter gerado agora
            if ($existente !== null) return $existente;
            $nova = bin2hex(random_bytes(32));
            if (!salvarCookieSecret($nova)) {
                throw new RuntimeException('Não foi possível gravar ' . COOKIE_SECRET_FILE);
            }
            return $nova;
        });
    }
    return $GLOBALS['__cookieSecret'] = $chave;
}

function lerCookieSecretArquivo() {
    if (!is_file(COOKIE_SECRET_FILE)) return null;
    $valor = include COOKIE_SECRET_FILE;
    return (is_string($valor) && strlen($valor) >= 32) ? $valor : null;
}

// A chave é sempre hexadecimal (bin2hex), então não tem como quebrar a string PHP.
function salvarCookieSecret($chave) {
    ensureDataDir();
    $conteudo = "<?php\n// Chave do cookie de login desta instalação. Gerada automaticamente;\n"
        . "// não envie para o Git nem copie para outra instalação.\nreturn '" . $chave . "';\n";
    if (!gravarArquivoAtomico(COOKIE_SECRET_FILE, $conteudo)) return false;
    @chmod(COOKIE_SECRET_FILE, 0600);
    // sem isso o opcache pode continuar servindo a chave antiga por alguns segundos
    if (function_exists('opcache_invalidate')) @opcache_invalidate(COOKIE_SECRET_FILE, true);
    $GLOBALS['__cookieSecret'] = $chave;
    return true;
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

    // Arquivo existente mas ilegível: ninguém entra. Antes isso devolvia o
    // usuário padrão admin/12345678 — um auth.json corrompido virava uma porta
    // aberta com a senha que está no README. Para voltar ao padrão, apague o
    // arquivo (ver README, "Perdi a senha").
    if (!is_array($data) || empty($data['users']) || !is_array($data['users'])) {
        return ['users' => []];
    }

    return $data;
}

// Quem chama deve estar dentro de comTrava(true, ...) quando leu o auth.json
// para alterar — ver atualizarAuth().
function writeAuth($auth) {
    return gravarArquivoAtomico(AUTH_FILE, json_encode($auth, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

// Lê, altera e grava o auth.json sob a trava exclusiva: dois administradores
// adicionando usuários ao mesmo tempo não perdem a alteração um do outro.
// $fn recebe o auth atual e devolve o novo (ou null para não gravar nada).
function atualizarAuth($fn) {
    return comTrava(true, function () use ($fn) {
        $novo = $fn(readAuth());
        if ($novo === null) return true;
        return writeAuth($novo);
    });
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
    ensureDataDir();
    gravarArquivoAtomico(LOGIN_ATTEMPTS_FILE, json_encode($tentativas));
}

// Quantos segundos ainda faltam de bloqueio para este IP (0 = pode tentar).
function segundosBloqueadoLogin($ip) {
    $tentativas = lerTentativasLogin();
    if (!isset($tentativas[$ip]) || $tentativas[$ip]['count'] < LOGIN_MAX_TENTATIVAS) return 0;
    $restante = ($tentativas[$ip]['lastAttempt'] + LOGIN_BLOQUEIO_SEGUNDOS) - time();
    return $restante > 0 ? $restante : 0;
}

function registrarTentativaLoginFalha($ip) {
    comTrava(true, function () use ($ip) {
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
    });
}

function limparTentativasLogin($ip) {
    comTrava(true, function () use ($ip) {
        $tentativas = lerTentativasLogin();
        if (isset($tentativas[$ip])) {
            unset($tentativas[$ip]);
            salvarTentativasLogin($tentativas);
        }
    });
}
