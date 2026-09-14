<?php
// Чтение графика учебного года и CRUD блоков ротации: серверная валидация
// (та же логика, что в интерфейсе), права по организации и запись каждого
// изменения в audit_log.

declare(strict_types=1);

/* ─────────────────────────── учебные годы ─────────────────────────── */

function fetch_years(): array
{
    $rows = db()->query('SELECT id, label, date_start, date_end, is_current, note FROM academic_years ORDER BY date_start')->fetchAll();
    return array_map(static fn($y) => [
        'id'        => $y['id'],
        'label'     => $y['label'],
        'dateStart' => $y['date_start'],
        'dateEnd'   => $y['date_end'],
        'isCurrent' => (bool) $y['is_current'],
        'note'      => $y['note'],
    ], $rows);
}

function current_year_id(): ?string
{
    $row = db()->query('SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1')->fetch();
    if ($row) {
        return $row['id'];
    }
    $row = db()->query('SELECT id FROM academic_years ORDER BY date_start DESC LIMIT 1')->fetch();
    return $row ? $row['id'] : null;
}

/** Год из ?year=… или текущий; 404, если такого года нет. */
function resolve_year(?string $requested = null): string
{
    $requested ??= $_GET['year'] ?? null;
    if ($requested !== null && $requested !== '') {
        $st = db()->prepare('SELECT id FROM academic_years WHERE id = ?');
        $st->execute([(string) $requested]);
        if (!$st->fetch()) {
            api_fail(404, 'Учебный год не найден.');
        }
        return (string) $requested;
    }
    $id = current_year_id();
    if ($id === null) {
        api_fail(500, 'В базе нет ни одного учебного года. Импортируйте сид: backend/scripts/init_db.php --seed=…');
    }
    return $id;
}

/* ─────────────────────────── чтение справочников ─────────────────────────── */

function fetch_weeks(string $yearId): array
{
    $st = db()->prepare('SELECT num, date_start, date_end, is_rotation, note FROM weeks WHERE year_id = ? ORDER BY num');
    $st->execute([$yearId]);
    return array_map(static fn($w) => [
        'num'        => (int) $w['num'],
        'start'      => $w['date_start'],
        'end'        => $w['date_end'],
        'label'      => week_label($w['date_start'], $w['date_end']),
        'isRotation' => (bool) $w['is_rotation'],
        'note'       => $w['note'],
    ], $st->fetchAll());
}

function week_label(string $start, string $end): string
{
    $f = static fn(string $iso) => substr($iso, 8, 2) . '.' . substr($iso, 5, 2);
    return $f($start) . '–' . $f($end);
}

function fetch_overrides(string $yearId): array
{
    $st = db()->prepare('SELECT id, date_from, date_to, kind, note FROM calendar_overrides WHERE year_id = ? ORDER BY date_from');
    $st->execute([$yearId]);
    return array_map(static fn($o) => [
        'id'       => (int) $o['id'],
        'dateFrom' => $o['date_from'],
        'dateTo'   => $o['date_to'],
        'kind'     => $o['kind'],
        'note'     => $o['note'],
    ], $st->fetchAll());
}

function fetch_organizations(): array
{
    $rows = db()->query('SELECT id, name_short, name_full FROM organizations ORDER BY id')->fetchAll();
    return array_map(static fn($o) => ['id' => $o['id'], 'short' => $o['name_short'], 'name' => $o['name_full']], $rows);
}

function fetch_units(): array
{
    $units = db()->query('SELECT id, name_short, name_official, territory, curator_rule, color FROM units ORDER BY id')->fetchAll();
    $links = db()->query('SELECT unit_id, curator_id FROM unit_curators ORDER BY pos, curator_id')->fetchAll();
    $cand = [];
    foreach ($links as $l) {
        $cand[$l['unit_id']][] = $l['curator_id'];
    }
    return array_map(static fn($u) => [
        'id'         => $u['id'],
        'short'      => $u['name_short'],
        'name'       => $u['name_official'],
        'territory'  => $u['territory'],
        'rule'       => $u['curator_rule'],
        'color'      => $u['color'],
        'candidates' => $cand[$u['id']] ?? [],
    ], $units);
}

function fetch_curators(): array
{
    $rows = db()->query('SELECT id, fio, profile FROM curators ORDER BY fio')->fetchAll();
    return array_map(static fn($c) => [
        'id'   => $c['id'],
        'fio'  => $c['fio'],
        'note' => $c['profile'],
    ], $rows);
}

function resident_to_api(array $r): array
{
    return [
        'id'       => $r['id'],
        'fio'      => $r['fio'],
        'year'     => (int) $r['year'],
        'orgId'    => $r['org_id'],
        'mode'     => $r['mode'],
        'priority' => $r['priority'],
        'active'   => (bool) $r['active'],
    ];
}

function fetch_residents(string $yearId): array
{
    $st = db()->prepare('SELECT id, fio, year, org_id, mode, priority, active FROM residents WHERE year_id = ? ORDER BY org_id, year, fio');
    $st->execute([$yearId]);
    return array_map('resident_to_api', $st->fetchAll());
}

function fetch_resident(string $id): ?array
{
    $st = db()->prepare('SELECT id, year_id, fio, year, org_id, mode, priority, active FROM residents WHERE id = ?');
    $st->execute([$id]);
    $r = $st->fetch();
    return $r ? resident_to_api($r) + ['yearId' => $r['year_id']] : null;
}

function fetch_blocks(string $yearId): array
{
    $st = db()->prepare('SELECT id, resident_id, unit_id, week_from, week_to, assigned_curator_id, comment FROM rotation_blocks WHERE year_id = ? ORDER BY resident_id, week_from');
    $st->execute([$yearId]);
    return array_map('block_to_api', $st->fetchAll());
}

function block_to_api(array $row): array
{
    return [
        'id'         => $row['id'],
        'residentId' => $row['resident_id'],
        'unitId'     => $row['unit_id'],
        'from'       => (int) $row['week_from'],
        'to'         => (int) $row['week_to'],
        'curatorId'  => $row['assigned_curator_id'],
        'comment'    => $row['comment'],
    ];
}

function fetch_block(string $id): ?array
{
    $st = db()->prepare('SELECT id, year_id, resident_id, unit_id, week_from, week_to, assigned_curator_id, comment FROM rotation_blocks WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    return $row ? block_to_api($row) + ['yearId' => $row['year_id']] : null;
}

function setting(string $key, string $default = ''): string
{
    $st = db()->prepare('SELECT svalue FROM settings WHERE skey = ?');
    $st->execute([$key]);
    $row = $st->fetch();
    return $row && $row['svalue'] !== null ? (string) $row['svalue'] : $default;
}

function fetch_settings_windows(): array
{
    return [
        'finishWorkdays' => (int) setting('window_finish_workdays', '2'),
        'incomingDays'   => (int) setting('window_incoming_days', '3'),
        'recentDays'     => (int) setting('recent_days', '14'),
    ];
}

function capacity_threshold(): int
{
    return max(1, (int) setting('capacity_threshold', '3'));
}

function handle_schedule(): never
{
    $yearId = resolve_year();
    api_json([
        'today'             => moscow_today(),
        'year'              => $yearId,
        'years'             => fetch_years(),
        'weeks'             => fetch_weeks($yearId),
        'overrides'         => fetch_overrides($yearId),
        'organizations'     => fetch_organizations(),
        'units'             => fetch_units(),
        'curators'          => fetch_curators(),
        'residents'         => fetch_residents($yearId),
        'blocks'            => fetch_blocks($yearId),
        'windows'           => fetch_settings_windows(),
        'capacityThreshold' => capacity_threshold(),
        'authorized'        => is_authorized(),
        'user'              => current_user(),
    ]);
}

/* ─────────────────────────── журнал ─────────────────────────── */

function audit(string $action, ?string $blockId, ?array $old, ?array $new, ?array $user = null, ?string $yearId = null): void
{
    $user ??= current_user();
    db()->prepare('INSERT INTO audit_log (ts, user_login, year_id, action, block_id, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([
            moscow_now(),
            $user['login'] ?? null,
            $yearId,
            $action,
            $blockId,
            $old === null ? null : json_encode($old, JSON_UNESCAPED_UNICODE),
            $new === null ? null : json_encode($new, JSON_UNESCAPED_UNICODE),
        ]);
}

function handle_audit_list(): never
{
    $user = require_auth();
    $yearId = resolve_year();
    $st = db()->prepare('SELECT id, ts, user_login, action, block_id, old_value, new_value FROM audit_log WHERE year_id = ? OR year_id IS NULL ORDER BY id DESC LIMIT 500');
    $st->execute([$yearId]);
    $rows = array_map(static fn($r) => [
        'id'      => (int) $r['id'],
        'ts'      => $r['ts'],
        'user'    => $r['user_login'],
        'action'  => $r['action'],
        'blockId' => $r['block_id'],
        'old'     => $r['old_value'] === null ? null : json_decode($r['old_value'], true),
        'new'     => $r['new_value'] === null ? null : json_decode($r['new_value'], true),
    ], $st->fetchAll());

    // Распорядитель видит только правки по ординаторам своей организации;
    // записи о пользователях, настройках и календаре — только учебной части.
    if ($user['role'] !== 'admin') {
        $st = db()->prepare('SELECT id FROM residents WHERE year_id = ? AND org_id = ?');
        $st->execute([$yearId, (string) $user['orgId']]);
        $mine = array_fill_keys(array_column($st->fetchAll(), 'id'), true);
        $rows = array_values(array_filter($rows, static function (array $e) use ($mine, $user): bool {
            $v = $e['new'] ?? $e['old'] ?? [];
            switch ($e['action']) {
                case 'block_create': case 'block_update': case 'block_delete': case 'curator_assign':
                    return isset($mine[$v['residentId'] ?? '']);
                case 'resident_create': case 'resident_update':
                    return ($v['orgId'] ?? null) === $user['orgId'];
                case 'generate_apply':
                    foreach ($v['residents'] ?? [] as $rid) {
                        if (!isset($mine[$rid])) {
                            return false;
                        }
                    }
                    return !empty($v['residents']);
                default:
                    return false;
            }
        }));
    }
    api_json(['entries' => $rows]);
}

/* ─────────────────────────── валидация и запись блоков ─────────────────────────── */

/**
 * Проверяет поля блока; возвращает нормализованный набор для записи.
 * $user — кто правит (проверка прав по организации ординатора).
 * При нарушении отвечает 422 с понятным русским сообщением.
 */
function validate_block_input(array $body, ?string $excludeBlockId, string $yearId, array $user): array
{
    $residentId = (string) ($body['residentId'] ?? '');
    $unitId     = (string) ($body['unitId'] ?? '');
    $from       = $body['from'] ?? $body['weekFrom'] ?? null;
    $to         = $body['to'] ?? $body['weekTo'] ?? null;
    $curatorId  = $body['curatorId'] ?? $body['assignedCuratorId'] ?? null;
    $comment    = isset($body['comment']) ? trim((string) $body['comment']) : null;
    if ($comment === '') {
        $comment = null;
    }

    if (!is_numeric($from) || !is_numeric($to)) {
        api_fail(422, 'Укажите недели начала и окончания блока.');
    }
    $from = (int) $from;
    $to   = (int) $to;

    $resident = fetch_resident($residentId);
    if (!$resident || $resident['yearId'] !== $yearId) {
        api_fail(422, 'Ординатор не найден в этом учебном году.');
    }
    require_org_access($user, $resident['orgId']);

    $st = db()->prepare('SELECT curator_rule FROM units WHERE id = ?');
    $st->execute([$unitId]);
    $unit = $st->fetch();
    if (!$unit) {
        api_fail(422, 'Подразделение не найдено.');
    }

    $st = db()->prepare('SELECT COUNT(*) AS c FROM weeks WHERE year_id = ? AND num IN (?, ?)');
    $st->execute([$yearId, $from, $to]);
    $weekCount = (int) $st->fetch()['c'];
    if (($from === $to && $weekCount !== 1) || ($from !== $to && $weekCount !== 2)) {
        api_fail(422, 'Недели должны существовать в календаре учебного года.');
    }
    if ($from > $to) {
        api_fail(422, 'Неделя начала позже недели окончания.');
    }

    // Куратор: auto — всегда единственный кандидат; manual — из кандидатов или null.
    $st = db()->prepare('SELECT curator_id FROM unit_curators WHERE unit_id = ? ORDER BY pos, curator_id');
    $st->execute([$unitId]);
    $candidates = array_column($st->fetchAll(), 'curator_id');

    if ($unit['curator_rule'] === 'auto') {
        if (!$candidates) {
            api_fail(422, 'У подразделения не задан куратор — обратитесь к администратору данных.');
        }
        $curatorId = $candidates[0];
    } else {
        if ($curatorId !== null && $curatorId !== '' && !in_array($curatorId, $candidates, true)) {
            api_fail(422, 'Выбранный куратор не входит в кандидаты этого подразделения.');
        }
        if ($curatorId === '') {
            $curatorId = null;
        }
    }

    // Пересечения с другими блоками того же ординатора.
    $sql = 'SELECT b.id, b.week_from, b.week_to, u.name_short
              FROM rotation_blocks b JOIN units u ON u.id = b.unit_id
             WHERE b.resident_id = ? AND NOT (b.week_to < ? OR b.week_from > ?)';
    $params = [$residentId, $from, $to];
    if ($excludeBlockId !== null) {
        $sql .= ' AND b.id <> ?';
        $params[] = $excludeBlockId;
    }
    $st = db()->prepare($sql);
    $st->execute($params);
    if ($clash = $st->fetch()) {
        api_fail(422, sprintf(
            'Пересекается с другим блоком этого ординатора: %s, недели %d–%d. Сохранение отклонено.',
            $clash['name_short'], (int) $clash['week_from'], (int) $clash['week_to']
        ));
    }

    return [
        'resident_id'         => $residentId,
        'unit_id'             => $unitId,
        'week_from'           => $from,
        'week_to'             => $to,
        'assigned_curator_id' => $curatorId,
        'comment'             => $comment,
    ];
}

function new_block_id(): string
{
    return 'b' . substr(bin2hex(random_bytes(6)), 0, 8);
}

function insert_block(string $yearId, array $v, ?string $id = null): string
{
    $id ??= new_block_id();
    db()->prepare('INSERT INTO rotation_blocks (id, year_id, resident_id, unit_id, week_from, week_to, assigned_curator_id, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$id, $yearId, $v['resident_id'], $v['unit_id'], $v['week_from'], $v['week_to'], $v['assigned_curator_id'], $v['comment']]);
    return $id;
}

function handle_block_create(): never
{
    $user = require_auth();
    $body = request_body();
    $yearId = resolve_year($body['yearId'] ?? null);
    $v = validate_block_input($body, null, $yearId, $user);
    $id = insert_block($yearId, $v);
    $block = fetch_block($id);
    audit('block_create', $id, null, $block, $user, $yearId);
    api_json(['block' => $block], 201);
}

function handle_block_update(string $id): never
{
    $user = require_auth();
    $old = fetch_block($id);
    if (!$old) {
        api_fail(404, 'Блок не найден.');
    }
    $oldRes = fetch_resident($old['residentId']);
    require_org_access($user, $oldRes['orgId']);
    $v = validate_block_input(request_body(), $id, $old['yearId'], $user);
    db()->prepare('UPDATE rotation_blocks SET resident_id = ?, unit_id = ?, week_from = ?, week_to = ?, assigned_curator_id = ?, comment = ? WHERE id = ?')
        ->execute([$v['resident_id'], $v['unit_id'], $v['week_from'], $v['week_to'], $v['assigned_curator_id'], $v['comment'], $id]);
    $new = fetch_block($id);
    audit('block_update', $id, $old, $new, $user, $old['yearId']);
    api_json(['block' => $new]);
}

function handle_block_delete(string $id): never
{
    $user = require_auth();
    $old = fetch_block($id);
    if (!$old) {
        api_fail(404, 'Блок не найден.');
    }
    $res = fetch_resident($old['residentId']);
    require_org_access($user, $res['orgId']);
    db()->prepare('DELETE FROM rotation_blocks WHERE id = ?')->execute([$id]);
    audit('block_delete', $id, $old, null, $user, $old['yearId']);
    api_json(['ok' => true]);
}

function handle_block_assign_curator(string $id): never
{
    $user = require_auth();
    $old = fetch_block($id);
    if (!$old) {
        api_fail(404, 'Блок не найден.');
    }
    $res = fetch_resident($old['residentId']);
    require_org_access($user, $res['orgId']);
    $body = request_body();
    $curatorId = $body['curatorId'] ?? null;
    if ($curatorId === '') {
        $curatorId = null;
    }
    if ($curatorId !== null) {
        $st = db()->prepare('SELECT COUNT(*) c FROM unit_curators WHERE unit_id = ? AND curator_id = ?');
        $st->execute([$old['unitId'], $curatorId]);
        if ((int) $st->fetch()['c'] === 0) {
            api_fail(422, 'Выбранный куратор не входит в кандидаты этого подразделения.');
        }
    }
    db()->prepare('UPDATE rotation_blocks SET assigned_curator_id = ? WHERE id = ?')->execute([$curatorId, $id]);
    $new = fetch_block($id);
    audit('curator_assign', $id, $old, $new, $user, $old['yearId']);
    api_json(['block' => $new]);
}

/** Массовая запись результата генератора — см. apply_generated() в generator.php. */
function handle_blocks_bulk(): never
{
    $user = require_auth();
    $body = request_body();
    $yearId = resolve_year($body['yearId'] ?? null);
    apply_generated($yearId, (array) ($body['residentIds'] ?? []), (int) ($body['fromWeek'] ?? 1),
        is_array($body['blocks'] ?? null) ? $body['blocks'] : [], $user, isset($body['seed']) ? (int) $body['seed'] : null);
    api_json(['ok' => true, 'blocks' => fetch_blocks($yearId)]);
}

/* ─────────────────────────── ординаторы ─────────────────────────── */

function validate_resident_input(array $b, array $user): array
{
    $fio = trim((string) ($b['fio'] ?? ''));
    $orgId = (string) ($b['orgId'] ?? '');
    $year = (int) ($b['year'] ?? 1);
    $mode = (string) ($b['mode'] ?? 'rotation');
    $priority = isset($b['priority']) ? trim((string) $b['priority']) : null;
    if ($priority === '') {
        $priority = null;
    }
    if (mb_strlen($fio) < 3) {
        api_fail(422, 'Укажите ФИО ординатора.');
    }
    $st = db()->prepare('SELECT COUNT(*) c FROM organizations WHERE id = ?');
    $st->execute([$orgId]);
    if ((int) $st->fetch()['c'] === 0) {
        api_fail(422, 'Организация не найдена.');
    }
    require_org_access($user, $orgId);
    if ($year < 1 || $year > 3) {
        api_fail(422, 'Год обучения: 1, 2 или 3.');
    }
    if (!in_array($mode, ['rotation', 'fixed'], true)) {
        api_fail(422, 'Режим: rotation (ротация по графику) или fixed (закреплён за отделением).');
    }
    return [$fio, $orgId, $year, $mode, $priority, isset($b['active']) ? ((bool) $b['active'] ? 1 : 0) : 1];
}

function handle_resident_create(): never
{
    $user = require_auth();
    $body = request_body();
    $yearId = resolve_year($body['yearId'] ?? null);
    [$fio, $orgId, $year, $mode, $priority, $active] = validate_resident_input($body, $user);
    $id = 'r' . substr(bin2hex(random_bytes(6)), 0, 8);
    db()->prepare('INSERT INTO residents (id, year_id, org_id, fio, year, mode, priority, email, phone, active) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)')
        ->execute([$id, $yearId, $orgId, $fio, $year, $mode, $priority, $active]);
    $r = fetch_resident($id);
    audit('resident_create', null, null, $r, $user, $yearId);
    api_json(['resident' => $r], 201);
}

function handle_resident_update(string $id): never
{
    $user = require_auth();
    $old = fetch_resident($id);
    if (!$old) {
        api_fail(404, 'Ординатор не найден.');
    }
    require_org_access($user, $old['orgId']);
    [$fio, $orgId, $year, $mode, $priority, $active] = validate_resident_input(request_body(), $user);
    db()->prepare('UPDATE residents SET fio = ?, org_id = ?, year = ?, mode = ?, priority = ?, active = ? WHERE id = ?')
        ->execute([$fio, $orgId, $year, $mode, $priority, $active, $id]);
    $new = fetch_resident($id);
    audit('resident_update', null, $old, $new, $user, $old['yearId']);
    api_json(['resident' => $new]);
}
