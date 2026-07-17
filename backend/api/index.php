<?php
// Единая точка входа REST API (ТЗ, раздел 7).
// На хостинге лежит в public_html/api/ рядом со статикой фронтенда;
// .htaccess направляет сюда все запросы /api/*.

declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/auth.php';
require __DIR__ . '/lib/schedule.php';
require __DIR__ . '/lib/windows.php';

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
// Префикс /api присутствует на хостинге и отсутствует при `php -S ... index.php` — принимаем оба.
$path = preg_replace('#^/api(/|$)#', '/', $path);
$path = rtrim($path, '/') ?: '/';

// Защита изменяющих запросов от cross-site (в дополнение к SameSite-cookie).
if (!in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && parse_url($origin, PHP_URL_HOST) !== ($_SERVER['HTTP_HOST'] ?? '')) {
        // HTTP_HOST может содержать порт — сравниваем целиком host[:port].
        $originHostPort = preg_replace('#^https?://#', '', $origin);
        if ($originHostPort !== ($_SERVER['HTTP_HOST'] ?? '')) {
            api_fail(403, 'Запрос с постороннего сайта отклонён.');
        }
    }
}

try {
    if ($method === 'GET' && $path === '/schedule') {
        handle_schedule();
    }
    if (preg_match('#^/curators/([\w-]+)/dashboard$#', $path, $m) && $method === 'GET') {
        handle_curator_dashboard($m[1]);
    }
    if ($method === 'POST' && $path === '/auth/pin') {
        handle_auth_pin();
    }
    if ($method === 'POST' && $path === '/auth/logout') {
        handle_auth_logout();
    }
    if ($method === 'GET' && $path === '/auth/status') {
        handle_auth_status();
    }
    if ($method === 'POST' && $path === '/blocks') {
        handle_block_create();
    }
    if (preg_match('#^/blocks/([\w-]+)/curator$#', $path, $m) && $method === 'PUT') {
        handle_block_assign_curator($m[1]);
    }
    if (preg_match('#^/blocks/([\w-]+)$#', $path, $m)) {
        if ($method === 'PUT') {
            handle_block_update($m[1]);
        }
        if ($method === 'DELETE') {
            handle_block_delete($m[1]);
        }
    }
    if ($method === 'GET' && $path === '/audit') {
        handle_audit_list();
    }
    api_fail(404, 'Неизвестный маршрут API.');
} catch (PDOException $e) {
    error_log('rotation api: ' . $e->getMessage());
    api_fail(500, 'Ошибка базы данных. Если сайт только что развёрнут — выполните backend/scripts/init_db.php.');
}
