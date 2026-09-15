<?php
// Инициализация БД (схема v2 — ТЗ 1.3): создание таблиц (идемпотентно),
// импорт сида учебного года, создание администратора. Запуск:
//   php backend/scripts/init_db.php --seed=data/private/2026-27.json --current \
//       --admin=uchebnaya:ПАРОЛЬ
//
// Сид описывает ОДИН учебный год: повторный импорт того же года заменяет его
// недели, ординаторов и блоки (справочники подразделений/кураторов обновляются
// без удаления). Другие годы не затрагиваются — так хранится архив.
// --reset       — удалить все таблицы и создать заново (смена схемы; данные теряются).
// --force       — импортировать год, даже если в БД уже есть его блоки.
// --current     — сделать импортируемый год текущим.
// --admin=login:password — создать/обновить пользователя-администратора (учебная часть).

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit("Только из командной строки.\n");
}

require __DIR__ . '/../api/lib/bootstrap.php';
require __DIR__ . '/../api/lib/schema.php';

$opts = getopt('', ['seed::', 'admin::', 'force', 'current', 'reset']);
$seedPath = $opts['seed'] ?? null;

$pdo = db();
$driver = db_driver();
echo "БД: {$driver}\n";

if (isset($opts['reset'])) {
    schema_drop_all($pdo);
    echo "Таблицы удалены.\n";
}
if (schema_is_legacy($pdo)) {
    exit("В БД схема старой версии (без учебных годов). Сделайте копию БД и запустите с --reset.\n");
}
schema_create($pdo);
echo "Таблицы созданы/проверены.\n";

/* ─── настройки по умолчанию (не перетирают существующие) ─── */

$defaults = [
    'window_finish_workdays' => '2',
    'window_incoming_days'   => '3',
    'recent_days'            => '14',
    'digest_monday'          => '1',
    'telegram_bot_token'     => '',
    'capacity_threshold'     => '3',
    'program_json'           => '',   // пусто = программа по умолчанию из generator.php
];
$has = $pdo->prepare('SELECT COUNT(*) c FROM settings WHERE skey = ?');
$ins = $pdo->prepare('INSERT INTO settings (skey, svalue) VALUES (?, ?)');
foreach ($defaults as $k => $v) {
    $has->execute([$k]);
    if ((int) $has->fetch()['c'] === 0) {
        $ins->execute([$k, $v]);
    }
}

/* ─── администратор ─── */

if (!empty($opts['admin'])) {
    [$login, $password] = array_pad(explode(':', (string) $opts['admin'], 2), 2, '');
    $login = trim($login);
    if ($login === '' || $password === '') {
        exit("Формат: --admin=login:password\n");
    }
    $hash = password_hash($password, PASSWORD_DEFAULT);
    $st = $pdo->prepare('SELECT id FROM users WHERE login = ?');
    $st->execute([$login]);
    if ($row = $st->fetch()) {
        $pdo->prepare("UPDATE users SET password_hash = ?, role = 'admin', org_id = NULL, active = 1 WHERE id = ?")
            ->execute([$hash, $row['id']]);
        echo "Пароль администратора «{$login}» обновлён.\n";
    } else {
        $pdo->prepare("INSERT INTO users (login, password_hash, display_name, role, org_id, active) VALUES (?, ?, ?, 'admin', NULL, 1)")
            ->execute([$login, $hash, 'Учебная часть']);
        echo "Администратор «{$login}» создан.\n";
    }
}

/* ─── импорт сида учебного года ─── */

if ($seedPath !== null && $seedPath !== false) {
    if (!is_file($seedPath)) {
        exit("Файл сида не найден: {$seedPath}\n");
    }
    $seed = json_decode(file_get_contents($seedPath), true);
    if (!is_array($seed) || (int) ($seed['meta']['format'] ?? 1) < 2) {
        exit("Сид должен быть формата 2 (meta.format = 2, см. data/seed.example.json).\n");
    }
    $yearId = (string) $seed['meta']['yearId'];

    $st = $pdo->prepare('SELECT COUNT(*) c FROM rotation_blocks WHERE year_id = ?');
    $st->execute([$yearId]);
    $existing = (int) $st->fetch()['c'];
    if ($existing > 0 && !isset($opts['force'])) {
        exit("В БД уже есть {$existing} блоков года {$yearId}. Повторный импорт заменит их — добавьте --force, если уверены.\n");
    }

    $pdo->beginTransaction();
    $stats = schema_import_year($pdo, $seed, isset($opts['current']));
    $pdo->prepare('INSERT INTO audit_log (ts, user_login, year_id, action, block_id, old_value, new_value) VALUES (?, NULL, ?, ?, NULL, NULL, ?)')
        ->execute([moscow_now(), $yearId, 'seed_import', json_encode([
            'file' => basename($seedPath),
            'blocks' => $stats['blocks'],
        ], JSON_UNESCAPED_UNICODE)]);
    $pdo->commit();

    printf("Год %s: недель %d, ординаторов %d, блоков %d; справочники: кураторов %d, подразделений %d, организаций %d.%s\n",
        $yearId, $stats['weeks'], $stats['residents'], $stats['blocks'],
        $stats['curators'], $stats['units'], $stats['organizations'],
        isset($opts['current']) ? ' Год сделан текущим.' : '');
}

echo "Готово.\n";
