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

if ($action === 'add') {
    $username = trim((string)($input['username'] ?? ''));
    $password = (string)($input['password'] ?? '');

    if ($username === '') {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Informe um nome de usuário.']);
        exit;
    }
    if (strlen($password) < 4) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'A senha deve ter pelo menos 4 caracteres.']);
        exit;
    }

    $auth = readAuth();
    foreach ($auth['users'] as $u) {
        if (strcasecmp($u['username'], $username) === 0) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Já existe um usuário com esse nome.']);
            exit;
        }
    }

    $newUser = [
        'id' => generateUserId(),
        'username' => $username,
        'passwordHash' => password_hash($password, PASSWORD_DEFAULT),
    ];
    $auth['users'][] = $newUser;

    if (!writeAuth($auth)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Não foi possível salvar o novo usuário.']);
        exit;
    }

    echo json_encode(['ok' => true, 'user' => publicUser($newUser)]);
    exit;
}

if ($action === 'remove') {
    $id = (string)($input['id'] ?? '');
    $auth = readAuth();

    if (count($auth['users']) <= 1) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Não é possível remover o único usuário existente.']);
        exit;
    }

    $target = findUserById($auth, $id);
    if ($target === null) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'error' => 'Usuário não encontrado.']);
        exit;
    }
    if (hash_equals($target['username'], $currentUsername)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Você não pode remover o próprio usuário enquanto está logado com ele.']);
        exit;
    }

    $auth['users'] = array_values(array_filter($auth['users'], function ($u) use ($id) {
        return $u['id'] !== $id;
    }));

    if (!writeAuth($auth)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Não foi possível remover o usuário.']);
        exit;
    }

    echo json_encode(['ok' => true]);
    exit;
}

http_response_code(400);
echo json_encode(['ok' => false, 'error' => 'Ação inválida.']);
