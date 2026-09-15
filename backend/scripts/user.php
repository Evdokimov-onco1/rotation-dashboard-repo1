<?php
// Управление учётными записями из командной строки (то же можно делать в админке).
//   php backend/scripts/user.php list
//   php backend/scripts/user.php add --login=petukhov --password=СЕКРЕТ --name="Петухов Е.А." --role=dispatcher --org=mmcc
//   php backend/scripts/user.php passwd --login=petukhov --password=НОВЫЙ
//   php backend/scripts/user.php disable --login=petukhov
// Роли: admin (учебная часть, всё), dispatcher (распорядитель когорты организации --org).

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit("Только из командной строки.\n");
}
require __DIR__ . '/../api/lib/bootstrap.php';

// getopt() прекращает разбор на первом позиционном аргументе — разбираем сами.
$cmd = 'list';
$opts = [];
foreach (array_slice($argv, 1) as $arg) {
    if (preg_match('/^--([a-z]+)=(.*)$/s', $arg, $m)) {
        $opts[$m[1]] = $m[2];
    } elseif ($arg[0] !== '-') {
        $cmd = $arg;
    }
}
$pdo = db();

switch ($cmd) {
    case 'list':
        foreach ($pdo->query('SELECT id, login, display_name, role, org_id, active FROM users ORDER BY id')->fetchAll() as $u) {
            printf("%-3d %-16s %-30s %-11s %-8s %s\n", $u['id'], $u['login'], $u['display_name'], $u['role'], $u['org_id'] ?? '-', $u['active'] ? 'активен' : 'отключён');
        }
        break;
    case 'add':
        $login = trim((string) ($opts['login'] ?? ''));
        $pass = (string) ($opts['password'] ?? '');
        $role = (string) ($opts['role'] ?? 'dispatcher');
        if ($login === '' || $pass === '' || empty($opts['name'])) {
            exit("Нужны --login, --password, --name (и --role=admin|dispatcher, --org=... для распорядителя).\n");
        }
        if (!in_array($role, ['admin', 'dispatcher'], true)) {
            exit("Роль должна быть admin или dispatcher.\n");
        }
        $org = $role === 'dispatcher' ? ($opts['org'] ?? null) : null;
        if ($role === 'dispatcher' && !$org) {
            exit("Распорядителю нужна организация: --org=mmcc или --org=nmhc.\n");
        }
        $pdo->prepare('INSERT INTO users (login, password_hash, display_name, role, org_id, active) VALUES (?, ?, ?, ?, ?, 1)')
            ->execute([$login, password_hash($pass, PASSWORD_DEFAULT), $opts['name'], $role, $org]);
        echo "Пользователь «{$login}» создан.\n";
        break;
    case 'passwd':
        $st = $pdo->prepare('UPDATE users SET password_hash = ?, active = 1 WHERE login = ?');
        $st->execute([password_hash((string) ($opts['password'] ?? ''), PASSWORD_DEFAULT), $opts['login'] ?? '']);
        echo $st->rowCount() ? "Пароль обновлён.\n" : "Пользователь не найден.\n";
        break;
    case 'disable':
        $st = $pdo->prepare('UPDATE users SET active = 0 WHERE login = ?');
        $st->execute([$opts['login'] ?? '']);
        echo $st->rowCount() ? "Пользователь отключён.\n" : "Пользователь не найден.\n";
        break;
    default:
        exit("Команды: list | add | passwd | disable\n");
}
