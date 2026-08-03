<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

header('Content-Type: application/json; charset=utf-8');

$username = getAuthenticatedUsername();

echo json_encode(['authenticated' => $username !== null, 'username' => $username]);
