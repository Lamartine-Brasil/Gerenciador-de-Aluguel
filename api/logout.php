<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

header('Content-Type: application/json; charset=utf-8');
clearAuthCookie();
echo json_encode(['ok' => true]);
