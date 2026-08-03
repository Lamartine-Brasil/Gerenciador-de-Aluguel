<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

header('Content-Type: application/json; charset=utf-8');

$authenticated = isAuthenticated();
$username = null;
if ($authenticated) {
    $auth = readAuth();
    $username = $auth['username'];
}

echo json_encode(['authenticated' => $authenticated, 'username' => $username]);
