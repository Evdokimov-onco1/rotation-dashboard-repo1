<?php
// Схема БД v2 (ТЗ 1.3) и импорт сида учебного года. Совместимо с MySQL и SQLite.
// Используется init_db.php; API схему не меняет.

declare(strict_types=1);

const SCHEMA_TABLES = [
    'login_attempts', 'audit_log', 'rotation_blocks', 'calendar_overrides', 'weeks',
    'residents', 'unit_curators', 'units', 'curators', 'organizations', 'academic_years',
    'users', 'settings', 'pin_attempts',
];

function schema_drop_all(PDO $pdo): void
{
    foreach (SCHEMA_TABLES as $t) {
        $pdo->exec("DROP TABLE IF EXISTS {$t}");
    }
}

/** Старая схема (этап 1): таблица weeks есть, но без year_id. */
function schema_is_legacy(PDO $pdo): bool
{
    try {
        $pdo->query('SELECT year_id FROM weeks LIMIT 1');
        return false;
    } catch (PDOException $e) {
        try {
            $pdo->query('SELECT num FROM weeks LIMIT 1');
            return true;   // таблица есть, колонки нет
        } catch (PDOException $e2) {
            return false;  // таблицы нет — чистая БД
        }
    }
}

function schema_create(PDO $pdo): void
{
    $driver = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
    $idPk   = 'VARCHAR(32) NOT NULL PRIMARY KEY';
    $autoPk = $driver === 'sqlite'
        ? 'INTEGER PRIMARY KEY AUTOINCREMENT'
        : 'INT NOT NULL AUTO_INCREMENT PRIMARY KEY';
    $suffix = $driver === 'sqlite' ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    $tables = [
        "CREATE TABLE IF NOT EXISTS academic_years (
            id VARCHAR(16) NOT NULL PRIMARY KEY,
            label VARCHAR(32) NOT NULL,
            date_start DATE NOT NULL,
            date_end DATE NOT NULL,
            is_current TINYINT NOT NULL DEFAULT 0,
            note VARCHAR(500) NULL
        ){$suffix}",
        "CREATE TABLE IF NOT EXISTS organizations (
            id {$idPk},
            name_short VARCHAR(64) NOT NULL,
            name_full VARCHAR(255) NOT NULL
        ){$suffix}",
        "CREATE TABLE IF NOT EXISTS residents (
            id {$idPk},
            year_id VARCHAR(16) NOT NULL,
            org_id VARCHAR(32) NOT NULL,
            fio VARCHAR(255) NOT NULL,
            year INT NOT NULL DEFAULT 1,
            mode VARCHAR(16) NOT NULL DEFAULT 'rotation',
            priority VARCHAR(64) NULL,
            email VARCHAR(255) NULL,
            phone VARCHAR(64) NULL,
            active TINYINT NOT NULL DEFAULT 1,
            FOREIGN KEY (year_id) REFERENCES academic_years(id),
            FOREIGN KEY (org_id) REFERENCES organizations(id)
        ){$suffix}",
        "CREATE TABLE IF NOT EXISTS weeks (
            year_id VARCHAR(16) NOT NULL,
            num INT NOT NULL,
            date_start DATE NOT NULL,
            date_end DATE NOT NULL,
            is_rotation TINYINT NOT NULL DEFAULT 1,
            note VARCHAR(255) NULL,
            PRIMARY KEY (year_id, num),
            FOREIGN KEY (year_id) REFERENCES academic_years(id)
        ){$suffix}",
        "CREATE TABLE IF NOT EXISTS calendar_overrides (
            id {$autoPk},
            year_id VARCHAR(16) NOT NULL,
            date_from DATE NOT NULL,
            date_to DATE NOT NULL,
            kind VARCHAR(8) NOT NULL,
            note VARCHAR(255) NULL,
            FOREIGN KEY (year_id) REFERENCES academic_years(id)
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
            year_id VARCHAR(16) NOT NULL,
            resident_id VARCHAR(32) NOT NULL,
            unit_id VARCHAR(32) NOT NULL,
            week_from INT NOT NULL,
            week_to INT NOT NULL,
            assigned_curator_id VARCHAR(32) NULL,
            comment VARCHAR(500) NULL,
            FOREIGN KEY (year_id) REFERENCES academic_years(id),
            FOREIGN KEY (resident_id) REFERENCES residents(id),
            FOREIGN KEY (unit_id) REFERENCES units(id),
            FOREIGN KEY (assigned_curator_id) REFERENCES curators(id)
        ){$suffix}",
        "CREATE TABLE IF NOT EXISTS users (
            id {$autoPk},
            login VARCHAR(64) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            display_name VARCHAR(255) NOT NULL,
            role VARCHAR(16) NOT NULL,
            org_id VARCHAR(32) NULL,
            active TINYINT NOT NULL DEFAULT 1
        ){$suffix}",
        "CREATE TABLE IF NOT EXISTS audit_log (
            id {$autoPk},
            ts DATETIME NOT NULL,
            user_login VARCHAR(64) NULL,
            year_id VARCHAR(16) NULL,
            action VARCHAR(32) NOT NULL,
            block_id VARCHAR(32) NULL,
            old_value TEXT NULL,
            new_value TEXT NULL
        ){$suffix}",
        "CREATE TABLE IF NOT EXISTS settings (
            skey VARCHAR(64) NOT NULL PRIMARY KEY,
            svalue TEXT NULL
        ){$suffix}",
        "CREATE TABLE IF NOT EXISTS login_attempts (
            id {$autoPk},
            ip VARCHAR(64) NOT NULL,
            attempted_at DATETIME NOT NULL
        ){$suffix}",
    ];
    foreach ($tables as $ddl) {
        $pdo->exec($ddl);
    }
}

/**
 * Импорт сида одного учебного года (формат 2). Справочники (организации,
 * кураторы, подразделения) обновляются «upsert»; недели, календарные
 * исключения, ординаторы и блоки года заменяются целиком.
 */
function schema_import_year(PDO $pdo, array $seed, bool $makeCurrent): array
{
    $m = $seed['meta'];
    $yearId = (string) $m['yearId'];

    // Год
    $st = $pdo->prepare('SELECT id FROM academic_years WHERE id = ?');
    $st->execute([$yearId]);
    if ($st->fetch()) {
        $pdo->prepare('UPDATE academic_years SET label = ?, date_start = ?, date_end = ?, note = ? WHERE id = ?')
            ->execute([$m['yearLabel'], $m['dateStart'], $m['dateEnd'], $m['note'] ?? null, $yearId]);
    } else {
        $pdo->prepare('INSERT INTO academic_years (id, label, date_start, date_end, is_current, note) VALUES (?, ?, ?, ?, 0, ?)')
            ->execute([$yearId, $m['yearLabel'], $m['dateStart'], $m['dateEnd'], $m['note'] ?? null]);
    }
    $cnt = (int) $pdo->query('SELECT COUNT(*) c FROM academic_years')->fetch()['c'];
    if ($makeCurrent || $cnt === 1) {
        $pdo->exec('UPDATE academic_years SET is_current = 0');
        $pdo->prepare('UPDATE academic_years SET is_current = 1 WHERE id = ?')->execute([$yearId]);
    }

    // Организации
    foreach ($seed['organizations'] ?? [] as $o) {
        upsert($pdo, 'organizations', ['id' => $o['id']],
            ['name_short' => $o['short'], 'name_full' => $o['name']]);
    }
    // Кураторы
    foreach ($seed['curators'] ?? [] as $c) {
        upsert($pdo, 'curators', ['id' => $c['id']], [
            'fio' => $c['fio'], 'profile' => $c['note'] ?? null,
            'telegram_chat_id' => $c['telegramChatId'] ?? null, 'email' => $c['email'] ?? null,
        ]);
    }
    // Подразделения и кандидаты
    $rules = [];
    foreach ($seed['units'] ?? [] as $u) {
        upsert($pdo, 'units', ['id' => $u['id']], [
            'name_short' => $u['short'], 'name_official' => $u['name'],
            'territory' => $u['territory'] ?? null, 'curator_rule' => $u['curatorRule'], 'color' => $u['color'],
        ]);
        $pdo->prepare('DELETE FROM unit_curators WHERE unit_id = ?')->execute([$u['id']]);
        $stL = $pdo->prepare('INSERT INTO unit_curators (unit_id, curator_id, pos) VALUES (?, ?, ?)');
        foreach ($u['candidateCuratorIds'] as $i => $cid) {
            $stL->execute([$u['id'], $cid, $i]);
        }
        $rules[$u['id']] = [$u['curatorRule'], $u['candidateCuratorIds']];
    }
    if (!$rules) { // сид без справочника подразделений — берём из БД
        foreach ($pdo->query('SELECT id, curator_rule FROM units')->fetchAll() as $u) {
            $st = $pdo->prepare('SELECT curator_id FROM unit_curators WHERE unit_id = ? ORDER BY pos');
            $st->execute([$u['id']]);
            $rules[$u['id']] = [$u['curator_rule'], array_column($st->fetchAll(), 'curator_id')];
        }
    }

    // Данные года — заменяем целиком
    foreach (['rotation_blocks', 'residents', 'calendar_overrides', 'weeks'] as $t) {
        $pdo->prepare("DELETE FROM {$t} WHERE year_id = ?")->execute([$yearId]);
    }
    $st = $pdo->prepare('INSERT INTO weeks (year_id, num, date_start, date_end, is_rotation, note) VALUES (?, ?, ?, ?, ?, ?)');
    foreach ($seed['weeks'] as $w) {
        $st->execute([$yearId, (int) $w['num'], $w['start'], $w['end'],
            (isset($w['isRotation']) && !$w['isRotation']) ? 0 : 1, $w['note'] ?? null]);
    }
    $st = $pdo->prepare('INSERT INTO calendar_overrides (year_id, date_from, date_to, kind, note) VALUES (?, ?, ?, ?, ?)');
    foreach ($seed['calendarOverrides'] ?? [] as $o) {
        $st->execute([$yearId, $o['dateFrom'], $o['dateTo'], $o['kind'], $o['note'] ?? null]);
    }
    $st = $pdo->prepare('INSERT INTO residents (id, year_id, org_id, fio, year, mode, priority, email, phone, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)');
    foreach ($seed['residents'] as $r) {
        $st->execute([$r['id'], $yearId, $r['orgId'], $r['fio'], (int) ($r['year'] ?? 1),
            $r['mode'] ?? 'rotation', $r['priority'] ?? null, $r['email'] ?? null, $r['phone'] ?? null]);
    }
    $st = $pdo->prepare('INSERT INTO rotation_blocks (id, year_id, resident_id, unit_id, week_from, week_to, assigned_curator_id, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    foreach ($seed['rotationBlocks'] ?? [] as $b) {
        [$rule, $cands] = $rules[$b['unitId']] ?? ['manual', []];
        $curator = $b['assignedCuratorId'] ?? null;
        if ($rule === 'auto' && $curator === null) {
            $curator = $cands[0] ?? null;
        }
        $st->execute([$b['id'], $yearId, $b['residentId'], $b['unitId'], (int) $b['weekFrom'], (int) $b['weekTo'], $curator, $b['comment'] ?? null]);
    }

    return [
        'weeks' => count($seed['weeks']),
        'residents' => count($seed['residents']),
        'blocks' => count($seed['rotationBlocks'] ?? []),
        'curators' => count($seed['curators'] ?? []),
        'units' => count($seed['units'] ?? []),
        'organizations' => count($seed['organizations'] ?? []),
    ];
}

function upsert(PDO $pdo, string $table, array $key, array $values): void
{
    $kCol = array_key_first($key);
    $st = $pdo->prepare("SELECT COUNT(*) c FROM {$table} WHERE {$kCol} = ?");
    $st->execute([$key[$kCol]]);
    if ((int) $st->fetch()['c'] > 0) {
        $set = implode(', ', array_map(static fn($c) => "{$c} = ?", array_keys($values)));
        $pdo->prepare("UPDATE {$table} SET {$set} WHERE {$kCol} = ?")
            ->execute([...array_values($values), $key[$kCol]]);
    } else {
        $cols = array_merge(array_keys($key), array_keys($values));
        $ph = implode(', ', array_fill(0, count($cols), '?'));
        $pdo->prepare("INSERT INTO {$table} (" . implode(', ', $cols) . ") VALUES ({$ph})")
            ->execute([...array_values($key), ...array_values($values)]);
    }
}
