<?php
// Единая точка входа REST API (ТЗ 1.3, раздел 7).
// На хостинге лежит в public_html/api/ рядом со статикой фронтенда;
// .htaccess направляет сюда все запросы /api/*.

declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/auth.php';
require __DIR__ . '/lib/schedule.php';
require __DIR__ . '/lib/calendar.php';
require __DIR__ . '/lib/windows.php';
require __DIR__ . '/lib/generator.php';

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
// Префикс /api присутствует на хостинге и отсутствует при `php -S ... index.php` — принимаем оба.
$path = preg_replace('#^/api(/|$)#', '/', $path);
$path = rtrim($path, '/') ?: '/';

// Защита изменяющих запросов от cross-site (в дополнение к SameSite-cookie).
if (!in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        $originHostPort = preg_replace('#^https?://#', '', $origin);
        if ($originHostPort !== ($_SERVER['HTTP_HOST'] ?? '')) {
            api_fail(403, 'Запрос с постороннего сайта отклонён.');
        }
    }
}

try {
    // ── чтение ──
    if ($method === 'GET' && $path === '/schedule') {
        handle_schedule();
    }
    if (preg_match('#^/curators/([\w-]+)/dashboard$#', $path, $m) && $method === 'GET') {
        handle_curator_dashboard($m[1]);
    }
    if ($method === 'GET' && $path === '/audit') {
        handle_audit_list();
    }

    // ── вход ──
    if ($method === 'POST' && $path === '/auth/login') {
        handle_auth_login();
    }
    if ($method === 'POST' && $path === '/auth/logout') {
        handle_auth_logout();
    }
    if ($method === 'GET' && $path === '/auth/status') {
        handle_auth_status();
    }

    // ── блоки ──
    if ($method === 'POST' && $path === '/blocks') {
        handle_block_create();
    }
    if ($method === 'POST' && $path === '/blocks/bulk') {
        handle_blocks_bulk();
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

    // ── генератор ──
    if ($method === 'POST' && $path === '/generate') {
        handle_generate();
    }

    // ── ординаторы ──
    if ($method === 'POST' && $path === '/residents') {
        handle_resident_create();
    }
    if (preg_match('#^/residents/([\w-]+)$#', $path, $m) && $method === 'PUT') {
        handle_resident_update($m[1]);
    }

    // ── календарь и годы (admin) ──
    if (preg_match('#^/years/([\w-]+)/weeks$#', $path, $m) && $method === 'PUT') {
        handle_weeks_update($m[1]);
    }
    if (preg_match('#^/years/([\w-]+)/overrides$#', $path, $m) && $method === 'POST') {
        handle_override_create($m[1]);
    }
    if (preg_match('#^/overrides/(\d+)$#', $path, $m) && $method === 'DELETE') {
        handle_override_delete((int) $m[1]);
    }
    if (preg_match('#^/years/([\w-]+)/current$#', $path, $m) && $method === 'PUT') {
        handle_year_set_current($m[1]);
    }

    // ── пользователи и настройки (admin) ──
    if ($method === 'GET' && $path === '/users') {
        handle_users_list();
    }
    if ($method === 'POST' && $path === '/users') {
        handle_user_create();
    }
    if (preg_match('#^/users/(\d+)$#', $path, $m) && $method === 'PUT') {
        handle_user_update((int) $m[1]);
    }
    if ($method === 'PUT' && $path === '/settings') {
        handle_settings_update();
    }

    api_fail(404, 'Неизвестный маршрут API.');
} catch (PDOException $e) {
    error_log('rotation api: ' . $e->getMessage());
    api_fail(500, 'Ошибка базы данных. Если сайт только что развёрнут — выполните backend/scripts/init_db.php.');
} catch (Throwable $e) {
    // Любая другая ошибка — тоже JSON, чтобы фронтенд показал причину, а не «500».
    error_log('rotation api: ' . get_class($e) . ': ' . $e->getMessage());
    api_fail(500, 'Внутренняя ошибка сервера: ' . $e->getMessage());
}
