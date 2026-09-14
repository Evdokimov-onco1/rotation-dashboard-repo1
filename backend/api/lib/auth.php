<?php
// Авторизация по логину и паролю (ТЗ 1.3, раздел 8). Роли:
//   admin      — учебная часть: всё (график, календарь, пользователи, настройки);
//   dispatcher — распорядитель когорты: график и ординаторы своей организации.
// Сессия — httpOnly-cookie; перебор ограничен: не более 5 неудачных попыток
// за 15 минут с одного IP.

declare(strict_types=1);

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MIN   = 15;

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

/** Текущий пользователь сессии или null. */
function current_user(): ?array
{
    session_boot();
    static $cached = false;
    if ($cached !== false) {
        return $cached;
    }
    $id = $_SESSION['user_id'] ?? null;
    if (!$id) {
        return $cached = null;
    }
    $st = db()->prepare('SELECT id, login, display_name, role, org_id FROM users WHERE id = ? AND active = 1');
    $st->execute([$id]);
    $u = $st->fetch();
    if (!$u) {
        return $cached = null;
    }
    return $cached = [
        'id'    => (int) $u['id'],
        'login' => $u['login'],
        'name'  => $u['display_name'],
        'role'  => $u['role'],
        'orgId' => $u['org_id'],
    ];
}

function is_authorized(): bool
{
    return current_user() !== null;
}

function require_auth(): array
{
    $u = current_user();
    if ($u === null) {
        api_fail(401, 'Требуется авторизация: войдите с логином и паролем.');
    }
    return $u;
}

function require_admin(): array
{
    $u = require_auth();
    if ($u['role'] !== 'admin') {
        api_fail(403, 'Это действие доступно только учебной части (администратору).');
    }
    return $u;
}

/** Пользователь вправе менять данные ординатора этой организации? */
function can_manage_org(array $user, string $orgId): bool
{
    return $user['role'] === 'admin' || ($user['role'] === 'dispatcher' && $user['orgId'] === $orgId);
}

function require_org_access(array $user, string $orgId): void
{
    if (!can_manage_org($user, $orgId)) {
        api_fail(403, 'Вы можете менять график только ординаторов своей организации.');
    }
}

function client_ip(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
}

function login_attempts_recent(string $ip): int
{
    $st = db()->prepare('SELECT COUNT(*) AS c FROM login_attempts WHERE ip = ? AND attempted_at >= ?');
    $since = (new DateTimeImmutable('now', new DateTimeZone('Europe/Moscow')))
        ->sub(new DateInterval('PT' . LOGIN_WINDOW_MIN . 'M'))->format('Y-m-d H:i:s');
    $st->execute([$ip, $since]);
    return (int) $st->fetch()['c'];
}

function handle_auth_login(): never
{
    session_boot();
    $body = request_body();
    $login = trim((string) ($body['login'] ?? ''));
    $password = (string) ($body['password'] ?? '');
    if ($login === '' || $password === '') {
        api_fail(400, 'Укажите логин и пароль.');
    }

    $ip = client_ip();
    if (login_attempts_recent($ip) >= LOGIN_MAX_ATTEMPTS) {
        api_fail(429, 'Слишком много попыток. Подождите 15 минут и попробуйте снова.');
    }

    $st = db()->prepare('SELECT id, password_hash FROM users WHERE login = ? AND active = 1');
    $st->execute([$login]);
    $row = $st->fetch();
    if (!$row || !password_verify($password, $row['password_hash'])) {
        db()->prepare('INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)')
            ->execute([$ip, moscow_now()]);
        api_fail(401, 'Неверный логин или пароль.');
    }

    db()->prepare('DELETE FROM login_attempts WHERE ip = ?')->execute([$ip]);
    session_regenerate_id(true);
    $_SESSION['user_id'] = (int) $row['id'];
    api_json(['ok' => true, 'user' => current_user()]);
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
    $u = current_user();
    api_json(['authorized' => $u !== null, 'user' => $u]);
}

/* ─────────────────────────── пользователи (только admin) ─────────────────────────── */

function fetch_users(): array
{
    $rows = db()->query('SELECT id, login, display_name, role, org_id, active FROM users ORDER BY role, login')->fetchAll();
    return array_map(static fn($u) => [
        'id' => (int) $u['id'], 'login' => $u['login'], 'name' => $u['display_name'],
        'role' => $u['role'], 'orgId' => $u['org_id'], 'active' => (bool) $u['active'],
    ], $rows);
}

function handle_users_list(): never
{
    require_admin();
    api_json(['users' => fetch_users()]);
}

function validate_user_input(array $b, bool $isNew): array
{
    $login = trim((string) ($b['login'] ?? ''));
    $name = trim((string) ($b['name'] ?? ''));
    $role = (string) ($b['role'] ?? 'dispatcher');
    $orgId = $b['orgId'] ?? null;
    $password = (string) ($b['password'] ?? '');
    if ($isNew && !preg_match('/^[a-z0-9_.-]{3,64}$/i', $login)) {
        api_fail(422, 'Логин: 3–64 символа, латиница, цифры, точка, дефис, подчёркивание.');
    }
    if ($name === '') {
        api_fail(422, 'Укажите имя пользователя (как показывать в журнале).');
    }
    if (!in_array($role, ['admin', 'dispatcher'], true)) {
        api_fail(422, 'Роль должна быть admin или dispatcher.');
    }
    if ($role === 'dispatcher') {
        $st = db()->prepare('SELECT COUNT(*) c FROM organizations WHERE id = ?');
        $st->execute([(string) $orgId]);
        if (!$orgId || (int) $st->fetch()['c'] === 0) {
            api_fail(422, 'Распорядителю нужно указать организацию.');
        }
    } else {
        $orgId = null;
    }
    if (($isNew || $password !== '') && mb_strlen($password) < 6) {
        api_fail(422, 'Пароль не короче 6 символов.');
    }
    return [$login, $name, $role, $orgId, $password];
}

function handle_user_create(): never
{
    $me = require_admin();
    [$login, $name, $role, $orgId, $password] = validate_user_input(request_body(), true);
    $st = db()->prepare('SELECT COUNT(*) c FROM users WHERE login = ?');
    $st->execute([$login]);
    if ((int) $st->fetch()['c'] > 0) {
        api_fail(422, 'Такой логин уже есть.');
    }
    db()->prepare('INSERT INTO users (login, password_hash, display_name, role, org_id, active) VALUES (?, ?, ?, ?, ?, 1)')
        ->execute([$login, password_hash($password, PASSWORD_DEFAULT), $name, $role, $orgId]);
    audit('user_create', null, null, ['login' => $login, 'role' => $role, 'orgId' => $orgId], $me);
    api_json(['users' => fetch_users()], 201);
}

function handle_user_update(int $id): never
{
    $me = require_admin();
    $st = db()->prepare('SELECT id, login, display_name, role, org_id, active FROM users WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        api_fail(404, 'Пользователь не найден.');
    }
    // Непереданные поля не меняются.
    $b = request_body() + ['login' => $row['login'], 'name' => $row['display_name'], 'role' => $row['role'], 'orgId' => $row['org_id'], 'active' => (bool) $row['active']];
    [, $name, $role, $orgId, $password] = validate_user_input($b, false);
    $active = (bool) $b['active'] ? 1 : 0;
    if ($id === $me['id'] && ($role !== 'admin' || !$active)) {
        api_fail(422, 'Нельзя понизить или отключить собственную учётную запись.');
    }
    db()->prepare('UPDATE users SET display_name = ?, role = ?, org_id = ?, active = ? WHERE id = ?')
        ->execute([$name, $role, $orgId, $active, $id]);
    if ($password !== '') {
        db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
            ->execute([password_hash($password, PASSWORD_DEFAULT), $id]);
    }
    audit('user_update', null, null, ['login' => $row['login'], 'role' => $role, 'orgId' => $orgId, 'active' => (bool) $active, 'passwordChanged' => $password !== ''], $me);
    api_json(['users' => fetch_users()]);
}
