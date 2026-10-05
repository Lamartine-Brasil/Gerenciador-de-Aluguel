<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$user = getAuthenticatedUser();

echo json_encode([
    'authenticated' => $user !== null,
    'username' => $user === null ? null : $user['username'],
    'senhaPadrao' => $user !== null && usaSenhaPadrao($user),
]);
