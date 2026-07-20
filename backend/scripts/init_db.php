<?php
// Инициализация БД: создание таблиц (идемпотентно), импорт data/seed.json,
// установка PIN и параметров окон. Запуск:
//   php backend/scripts/init_db.php --seed data/seed.json --pin 0000
// Повторный запуск с --seed ПЕРЕЗАПИШЕТ справочники и блоки (нужно для
// первого наполнения и смены учебного года); без --seed данные не трогаются.

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit("Только из командной строки.\n");
}

require __DIR__ . '/../api/lib/bootstrap.php';

$opts = getopt('', ['seed::', 'pin::', 'force']);
$seedPath = $opts['seed'] ?? null;
$pin = $opts['pin'] ?? null;

$pdo = db();
$driver = db_driver();
echo "БД: {$driver}\n";

/* ─── DDL (совместимо MySQL / SQLite) ─── */

$idPk   = 'VARCHAR(32) NOT NULL PRIMARY KEY';
$autoPk = $driver === 'sqlite'
    ? 'INTEGER PRIMARY KEY AUTOINCREMENT'
    : 'INT NOT NULL AUTO_INCREMENT PRIMARY KEY';
$suffix = $driver === 'sqlite' ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

$tables = [
    "CREATE TABLE IF NOT EXISTS residents (
        id {$idPk},
        fio VARCHAR(255) NOT NULL,
        year INT NOT NULL DEFAULT 1,
        active TINYINT NOT NULL DEFAULT 1
    ){$suffix}",
    "CREATE TABLE IF NOT EXISTS weeks (
        num INT NOT NULL PRIMARY KEY,
        date_start DATE NOT NULL,
        date_end DATE NOT NULL,
        note VARCHAR(255) NULL
    ){$suffix}",
    "CREATE TABLE IF NOT EXISTS curators (
        id {$idPk},
        fio VARCHAR(255) NOT NULL,
        profile VARCHAR(255) NULL,
        telegram_chat_id VARCHAR(64) NULL,
        email VARCHAR(255) NULL
    ){$suffix}",
    "CREATE TABLE IF NOT EXISTS units (
        id {$idPk},
        name_short VARCHAR(64) NOT NULL,
        name_official VARCHAR(255) NOT NULL,
        territory VARCHAR(64) NULL,
        curator_rule VARCHAR(8) NOT NULL DEFAULT 'auto',
        color VARCHAR(16) NOT NULL DEFAULT '#888888'
    ){$suffix}",
    "CREATE TABLE IF NOT EXISTS unit_curators (
        unit_id VARCHAR(32) NOT NULL,
        curator_id VARCHAR(32) NOT NULL,
        pos INT NOT NULL DEFAULT 0,
        PRIMARY KEY (unit_id, curator_id),
        FOREIGN KEY (unit_id) REFERENCES units(id),
        FOREIGN KEY (curator_id) REFERENCES curators(id)
    ){$suffix}",
    "CREATE TABLE IF NOT EXISTS rotation_blocks (
        id {$idPk},
        resident_id VARCHAR(32) NOT NULL,
        unit_id VARCHAR(32) NOT NULL,
        week_from INT NOT NULL,
        week_to INT NOT NULL,
        assigned_curator_id VARCHAR(32) NULL,
        comment VARCHAR(500) NULL,
        FOREIGN KEY (resident_id) REFERENCES residents(id),
        FOREIGN KEY (unit_id) REFERENCES units(id),
        FOREIGN KEY (assigned_curator_id) REFERENCES curators(id)
    ){$suffix}",
    "CREATE TABLE IF NOT EXISTS audit_log (
        id {$autoPk},
        ts DATETIME NOT NULL,
        action VARCHAR(32) NOT NULL,
        block_id VARCHAR(32) NULL,
        old_value TEXT NULL,
        new_value TEXT NULL
    ){$suffix}",
    "CREATE TABLE IF NOT EXISTS settings (
        skey VARCHAR(64) NOT NULL PRIMARY KEY,
        svalue TEXT NULL
    ){$suffix}",
    "CREATE TABLE IF NOT EXISTS pin_attempts (
        id {$autoPk},
        ip VARCHAR(64) NOT NULL,
        attempted_at DATETIME NOT NULL
    ){$suffix}",
];
foreach ($tables as $ddl) {
    $pdo->exec($ddl);
}
echo "Таблицы созданы/проверены.\n";

/* ─── настройки по умолчанию (не перетирают существующие) ─── */

$defaults = [
    'window_finish_workdays' => '2',
    'window_incoming_days'   => '3',
    'recent_days'            => '14',
    'digest_monday'          => '1',
    'telegram_bot_token'     => '',
];
$has = $pdo->prepare('SELECT COUNT(*) c FROM settings WHERE skey = ?');
$ins = $pdo->prepare('INSERT INTO settings (skey, svalue) VALUES (?, ?)');
foreach ($defaults as $k => $v) {
    $has->execute([$k]);
    if ((int) $has->fetch()['c'] === 0) {
        $ins->execute([$k, $v]);
    }
}

/* ─── PIN ─── */

if ($pin !== null && $pin !== false && $pin !== '') {
    $hash = password_hash((string) $pin, PASSWORD_DEFAULT);
    $pdo->prepare('DELETE FROM settings WHERE skey = ?')->execute(['pin_hash']);
    $ins->execute(['pin_hash', $hash]);
    echo "PIN установлен.\n";
}

/* ─── импорт сида ─── */

if ($seedPath !== null && $seedPath !== false) {
    if (!is_file($seedPath)) {
        exit("Файл сида не найден: {$seedPath}\n");
    }
    $seed = json_decode(file_get_contents($seedPath), true);
    if (!is_array($seed)) {
        exit("Сид не является корректным JSON.\n");
    }

    $existing = (int) $pdo->query('SELECT COUNT(*) c FROM rotation_blocks')->fetch()['c'];
    if ($existing > 0 && !isset($opts['force'])) {
        exit("В БД уже есть {$existing} блоков. Повторный импорт затрёт данные — добавьте --force, если уверены.\n");
    }

    $pdo->beginTransaction();
    foreach (['rotation_blocks', 'unit_curators', 'units', 'curators', 'residents', 'weeks'] as $t) {
        $pdo->exec("DELETE FROM {$t}");
    }

    $st = $pdo->prepare('INSERT INTO weeks (num, date_start, date_end, note) VALUES (?, ?, ?, ?)');
    foreach ($seed['weeks'] as $w) {
        $st->execute([(int) $w['num'], $w['start'], $w['end'], $w['note'] ?? null]);
    }
    $st = $pdo->prepare('INSERT INTO curators (id, fio, profile, telegram_chat_id, email) VALUES (?, ?, ?, ?, ?)');
    foreach ($seed['curators'] as $c) {
        $st->execute([$c['id'], $c['fio'], $c['note'] ?? null, $c['telegramChatId'] ?? null, $c['email'] ?? null]);
    }
    $st = $pdo->prepare('INSERT INTO residents (id, fio, year, active) VALUES (?, ?, ?, 1)');
    foreach ($seed['residents'] as $r) {
        $st->execute([$r['id'], $r['fio'], (int) ($seed['meta']['residentsYear'] ?? 1)]);
    }
    $stU = $pdo->prepare('INSERT INTO units (id, name_short, name_official, territory, curator_rule, color) VALUES (?, ?, ?, ?, ?, ?)');
    $stL = $pdo->prepare('INSERT INTO unit_curators (unit_id, curator_id, pos) VALUES (?, ?, ?)');
    foreach ($seed['units'] as $u) {
        $stU->execute([$u['id'], $u['short'], $u['name'], $u['territory'] ?? null, $u['curatorRule'], $u['color']]);
        foreach ($u['candidateCuratorIds'] as $i => $cid) {
            $stL->execute([$u['id'], $cid, $i]);
        }
    }

    $rules = [];
    foreach ($seed['units'] as $u) {
        $rules[$u['id']] = [$u['curatorRule'], $u['candidateCuratorIds']];
    }
    $st = $pdo->prepare('INSERT INTO rotation_blocks (id, resident_id, unit_id, week_from, week_to, assigned_curator_id, comment) VALUES (?, ?, ?, ?, ?, ?, ?)');
    foreach ($seed['rotationBlocks'] as $b) {
        [$rule, $cands] = $rules[$b['unitId']];
        $curator = $b['assignedCuratorId'] ?? null;
        if ($rule === 'auto' && $curator === null) {
            $curator = $cands[0] ?? null; // auto-подразделение: куратор проставляется автоматически
        }
        $st->execute([$b['id'], $b['residentId'], $b['unitId'], (int) $b['weekFrom'], (int) $b['weekTo'], $curator, $b['comment'] ?? null]);
    }

    $pdo->prepare('INSERT INTO audit_log (ts, action, block_id, old_value, new_value) VALUES (?, ?, NULL, NULL, ?)')
        ->execute([moscow_now(), 'seed_import', json_encode([
            'file' => basename($seedPath),
            'blocks' => count($seed['rotationBlocks']),
        ], JSON_UNESCAPED_UNICODE)]);
    $pdo->commit();

    printf("Импортировано: недель %d, кураторов %d, подразделений %d, ординаторов %d, блоков %d.\n",
        count($seed['weeks']), count($seed['curators']), count($seed['units']),
        count($seed['residents']), count($seed['rotationBlocks']));
}

echo "Готово.\n";
