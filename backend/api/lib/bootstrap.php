<?php
// Общая инициализация: таймзона, конфиг, PDO, JSON-помощники.

declare(strict_types=1);

date_default_timezone_set('Europe/Moscow');
mb_internal_encoding('UTF-8');

/** Путь к конфигу: ROTATION_CONFIG → над webroot'ом (каталог поддомена, затем домашний) → рядом с backend (dev). */
function config_path(): ?string
{
    $env = getenv('ROTATION_CONFIG');
    if ($env && is_file($env)) {
        return $env;
    }
    $candidates = [];
    if (!empty($_SERVER['DOCUMENT_ROOT'])) {
        $candidates[] = dirname($_SERVER['DOCUMENT_ROOT']) . '/rotation-config.php';     // /home/c/ЛОГИН/поддомен/
        $candidates[] = dirname($_SERVER['DOCUMENT_ROOT'], 2) . '/rotation-config.php';  // /home/c/ЛОГИН/
    }
    // По расположению самого файла: на хостинге lib/ лежит в <webroot>/api/lib
    $candidates[] = dirname(__DIR__, 3) . '/rotation-config.php';   // над webroot'ом (домашний каталог)
    $candidates[] = dirname(__DIR__, 2) . '/rotation-config.php';   // в самом webroot'е (закрыт .htaccess)
    // Домашний каталог пользователя, от имени которого работает PHP
    $home = getenv('HOME') ?: (function_exists('posix_getpwuid') ? (posix_getpwuid(posix_geteuid())['dir'] ?? '') : '');
    if ($home !== '') {
        $candidates[] = rtrim($home, '/') . '/rotation-config.php';
    }
    $candidates[] = dirname(__DIR__, 2) . '/config.php'; // backend/config.php (локальная разработка)
    foreach ($candidates as $p) {
        if (is_file($p)) {
            return $p;
        }
    }
    return null;
}

function config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $path = config_path();
        if ($path === null) {
            api_fail(500, 'Конфигурация не найдена: создайте config.php по образцу backend/config.sample.php.');
        }
        $cfg = require $path;
        if (!is_array($cfg) || empty($cfg['dsn'])) {
            api_fail(500, 'Некорректный config.php: нет параметра dsn.');
        }
    }
    return $cfg;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $cfg = config();
        try {
            $pdo = new PDO($cfg['dsn'], $cfg['db_user'] ?? null, $cfg['db_pass'] ?? null, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);
        } catch (PDOException $e) {
            api_fail(500, 'Не удалось подключиться к базе данных. Проверьте config.php.');
        }
        if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite') {
            $pdo->exec('PRAGMA foreign_keys = ON');
        }
    }
    return $pdo;
}

function db_driver(): string
{
    return db()->getAttribute(PDO::ATTR_DRIVER_NAME);
}

/** Сегодняшняя дата по Москве, YYYY-MM-DD. */
function moscow_today(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('Europe/Moscow')))->format('Y-m-d');
}

function moscow_now(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('Europe/Moscow')))->format('Y-m-d H:i:s');
}

function api_json($data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function api_fail(int $status, string $message): never
{
    api_json(['error' => $message], $status);
}

/** Тело запроса как JSON-массив (пустое тело → []). */
function request_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        api_fail(400, 'Тело запроса должно быть корректным JSON.');
    }
    return $data;
}
