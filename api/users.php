<?php
// Gerenciamento de outros usuários administradores (adicionar/remover/listar).
// Trocar o próprio usuário/senha continua em account.php.
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

header('Content-Type: application/json; charset=utf-8');
requireAuth();

$currentUsername = getAuthenticatedUsername();
$method = $_SERVER['REQUEST_METHOD'];

function publicUser($u) {
    return ['id' => $u['id'], 'username' => $u['username']];
}

if ($method === 'GET') {
    $auth = readAuth();
    echo json_encode(['ok' => true, 'users' => array_map('publicUser', $auth['users'])]);
    exit;
}

if ($method !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Método não permitido']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
$action = (string)($input['action'] ?? '');

// Adicionar ou remover outro administrador é uma ação de alto impacto (pode
// criar uma porta dos fundos permanente, ou tirar o acesso de outra pessoa)
// — por isso exige reconfirmar a própria senha, igual à troca de senha em
// account.php e à geração de nova chave em regenerate_secret.php. Sem isso,
// uma sessão sequestrada (cookie roubado, notebook destravado) conseguiria
// fazer as duas coisas sem nenhuma verificação extra.
if ($action === 'add' || $action === 'remove') {
    $currentPassword = (string)($input['currentPassword'] ?? '');
    $authCheck = readAuth();
    $actingUser = findUserByUsername($authCheck, $currentUsername);
    if ($actingUser === null || !password_verify($currentPassword, $actingUser['passwordHash'])) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Senha atual incorreta.']);
        exit;
    }
}

function responderErro($erro) {
    http_response_code($erro[0]);
    echo json_encode(['ok' => false, 'error' => $erro[1]]);
    exit;
}

if ($action === 'add') {
    $username = trim((string)($input['username'] ?? ''));
    $password = (string)($input['password'] ?? '');

    if ($username === '') responderErro([400, 'Informe um nome de usuário.']);
    if (strlen($password) < 8) responderErro([400, 'A senha deve ter pelo menos 8 caracteres.']);

    $newUser = [
        'id' => generateUserId(),
        'username' => $username,
        'passwordHash' => password_hash($password, PASSWORD_DEFAULT),
    ];
    $erro = null;
    $gravou = atualizarAuth(function ($auth) use ($username, $newUser, &$erro) {
        foreach ($auth['users'] as $u) {
            if (strcasecmp($u['username'], $username) === 0) {
                $erro = [400, 'Já existe um usuário com esse nome.'];
                return null;
            }
        }
        $auth['users'][] = $newUser;
        return $auth;
    });
    if ($erro !== null) responderErro($erro);
    if (!$gravou) responderErro([500, 'Não foi possível salvar o novo usuário.']);

    echo json_encode(['ok' => true, 'user' => publicUser($newUser)]);
    exit;
}

if ($action === 'remove') {
    $id = (string)($input['id'] ?? '');
    $erro = null;
    $gravou = atualizarAuth(function ($auth) use ($id, $currentUsername, &$erro) {
        if (count($auth['users']) <= 1) {
            $erro = [400, 'Não é possível remover o único usuário existente.'];
            return null;
        }
        $target = findUserById($auth, $id);
        if ($target === null) {
            $erro = [404, 'Usuário não encontrado.'];
            return null;
        }
        if (hash_equals($target['username'], $currentUsername)) {
            $erro = [400, 'Você não pode remover o próprio usuário enquanto está logado com ele.'];
            return null;
        }
        $auth['users'] = array_values(array_filter($auth['users'], function ($u) use ($id) {
            return $u['id'] !== $id;
        }));
        return $auth;
    });
    if ($erro !== null) responderErro($erro);
    if (!$gravou) responderErro([500, 'Não foi possível remover o usuário.']);

    echo json_encode(['ok' => true]);
    exit;
}

http_response_code(400);
echo json_encode(['ok' => false, 'error' => 'Ação inválida.']);
