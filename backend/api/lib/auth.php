<?php
// PIN-авторизация: единая привилегированная сессия (админка + учебная часть).
// PIN хранится в settings как password_hash; сессия — httpOnly-cookie;
// перебор ограничен: не более 5 неудачных попыток за 15 минут с одного IP.

declare(strict_types=1);

const PIN_MAX_ATTEMPTS = 5;
const PIN_WINDOW_MIN   = 15;

function session_boot(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    session_name('ROTSESS');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure'   => (($_SERVER['HTTPS'] ?? '') !== '' && $_SERVER['HTTPS'] !== 'off'),
    ]);
    session_start();
}

function is_authorized(): bool
{
    session_boot();
    return !empty($_SESSION['admin']);
}

function require_auth(): void
{
    if (!is_authorized()) {
        api_fail(401, 'Требуется авторизация: введите PIN-код.');
    }
}

function client_ip(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
}

function pin_attempts_recent(string $ip): int
{
    $st = db()->prepare('SELECT COUNT(*) AS c FROM pin_attempts WHERE ip = ? AND attempted_at >= ?');
    $since = (new DateTimeImmutable('now', new DateTimeZone('Europe/Moscow')))
        ->sub(new DateInterval('PT' . PIN_WINDOW_MIN . 'M'))->format('Y-m-d H:i:s');
    $st->execute([$ip, $since]);
    return (int) $st->fetch()['c'];
}

function handle_auth_pin(): never
{
    session_boot();
    $body = request_body();
    $pin = trim((string) ($body['pin'] ?? ''));
    if ($pin === '') {
        api_fail(400, 'Укажите PIN-код.');
    }

    $ip = client_ip();
    if (pin_attempts_recent($ip) >= PIN_MAX_ATTEMPTS) {
        api_fail(429, 'Слишком много попыток. Подождите 15 минут и попробуйте снова.');
    }

    $st = db()->prepare('SELECT svalue FROM settings WHERE skey = ?');
    $st->execute(['pin_hash']);
    $row = $st->fetch();
    if (!$row) {
        api_fail(500, 'PIN не установлен. Выполните backend/scripts/init_db.php --pin ...');
    }

    if (!password_verify($pin, $row['svalue'])) {
        db()->prepare('INSERT INTO pin_attempts (ip, attempted_at) VALUES (?, ?)')
            ->execute([$ip, moscow_now()]);
        api_fail(401, 'Неверный PIN.');
    }

    // Успех: чистим счётчик попыток и открываем сессию.
    db()->prepare('DELETE FROM pin_attempts WHERE ip = ?')->execute([$ip]);
    session_regenerate_id(true);
    $_SESSION['admin'] = true;
    api_json(['ok' => true]);
}

function handle_auth_logout(): never
{
    session_boot();
    $_SESSION = [];
    session_destroy();
    api_json(['ok' => true]);
}

function handle_auth_status(): never
{
    api_json(['authorized' => is_authorized()]);
}
