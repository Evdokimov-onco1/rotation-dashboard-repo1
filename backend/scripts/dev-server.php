<?php
// Локальный сервер «всё в одном» для разработки и проверки:
//   php -S 127.0.0.1:8090 -t frontend/dist backend/scripts/dev-server.php
// /api/* уходит в backend/api/index.php, остальное — статика собранного
// фронтенда (frontend/dist, перед запуском выполните npm run build).

$root = dirname(__DIR__, 2);
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';

if (preg_match('#^/api(/|$)#', $path)) {
    require $root . '/backend/api/index.php';
    exit;
}

$doc = $root . '/frontend/dist';
$file = realpath($doc . $path);
if ($file !== false && is_file($file)) {
    return false; // отдаст встроенный сервер PHP
}

// SPA-fallback: всё остальное — index.html
header('Content-Type: text/html; charset=utf-8');
readfile($doc . '/index.html');
