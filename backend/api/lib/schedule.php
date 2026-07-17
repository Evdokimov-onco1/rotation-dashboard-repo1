<?php
// Чтение графика и CRUD блоков ротации: серверная валидация (та же логика,
// что в интерфейсе) и запись каждого изменения в audit_log.

declare(strict_types=1);

/* ─────────────────────────── чтение справочников ─────────────────────────── */

function fetch_weeks(): array
{
    $rows = db()->query('SELECT num, date_start, date_end, note FROM weeks ORDER BY num')->fetchAll();
    return array_map(static fn($w) => [
        'num'   => (int) $w['num'],
        'start' => $w['date_start'],
        'end'   => $w['date_end'],
        'label' => week_label($w['date_start'], $w['date_end']),
        'note'  => $w['note'],
    ], $rows);
}

function week_label(string $start, string $end): string
{
    $f = static fn(string $iso) => substr($iso, 8, 2) . '.' . substr($iso, 5, 2);
    return $f($start) . '–' . $f($end);
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

function fetch_residents(): array
{
    $rows = db()->query('SELECT id, fio FROM residents WHERE active = 1 ORDER BY fio')->fetchAll();
    return array_map(static fn($r) => ['id' => $r['id'], 'fio' => $r['fio']], $rows);
}

function fetch_blocks(): array
{
    $rows = db()->query('SELECT id, resident_id, unit_id, week_from, week_to, assigned_curator_id, comment FROM rotation_blocks ORDER BY resident_id, week_from')->fetchAll();
    return array_map('block_to_api', $rows);
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
    $st = db()->prepare('SELECT id, resident_id, unit_id, week_from, week_to, assigned_curator_id, comment FROM rotation_blocks WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    return $row ? block_to_api($row) : null;
}

function fetch_settings_windows(): array
{
    $rows = db()->query("SELECT skey, svalue FROM settings WHERE skey IN ('window_finish_workdays','window_incoming_days','recent_days')")->fetchAll();
    $s = array_column($rows, 'svalue', 'skey');
    return [
        'finishWorkdays' => (int) ($s['window_finish_workdays'] ?? 2),
        'incomingDays'   => (int) ($s['window_incoming_days'] ?? 3),
        'recentDays'     => (int) ($s['recent_days'] ?? 14),
    ];
}

function handle_schedule(): never
{
    api_json([
        'today'       => moscow_today(),
        'weeks'       => fetch_weeks(),
        'units'       => fetch_units(),
        'curators'    => fetch_curators(),
        'residents'   => fetch_residents(),
        'blocks'      => fetch_blocks(),
        'windows'     => fetch_settings_windows(),
        'authorized'  => is_authorized(),
    ]);
}

/* ─────────────────────────── валидация и запись ─────────────────────────── */

function audit(string $action, ?string $blockId, ?array $old, ?array $new): void
{
    db()->prepare('INSERT INTO audit_log (ts, action, block_id, old_value, new_value) VALUES (?, ?, ?, ?, ?)')
        ->execute([
            moscow_now(),
            $action,
            $blockId,
            $old === null ? null : json_encode($old, JSON_UNESCAPED_UNICODE),
            $new === null ? null : json_encode($new, JSON_UNESCAPED_UNICODE),
        ]);
}

/**
 * Проверяет поля блока; возвращает нормализованный набор
 * [resident_id, unit_id, week_from, week_to, assigned_curator_id, comment].
 * При нарушении отвечает 422 с понятным русским сообщением.
 */
function validate_block_input(array $body, ?string $excludeBlockId): array
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

    $st = db()->prepare('SELECT id FROM residents WHERE id = ? AND active = 1');
    $st->execute([$residentId]);
    if (!$st->fetch()) {
        api_fail(422, 'Ординатор не найден.');
    }

    $st = db()->prepare('SELECT curator_rule FROM units WHERE id = ?');
    $st->execute([$unitId]);
    $unit = $st->fetch();
    if (!$unit) {
        api_fail(422, 'Подразделение не найдено.');
    }

    $st = db()->prepare('SELECT COUNT(*) AS c FROM weeks WHERE num IN (?, ?)');
    $st->execute([$from, $to]);
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

function handle_block_create(): never
{
    require_auth();
    $v = validate_block_input(request_body(), null);
    $id = new_block_id();
    db()->prepare('INSERT INTO rotation_blocks (id, resident_id, unit_id, week_from, week_to, assigned_curator_id, comment) VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([$id, $v['resident_id'], $v['unit_id'], $v['week_from'], $v['week_to'], $v['assigned_curator_id'], $v['comment']]);
    $block = fetch_block($id);
    audit('block_create', $id, null, $block);
    api_json(['block' => $block], 201);
}

function handle_block_update(string $id): never
{
    require_auth();
    $old = fetch_block($id);
    if (!$old) {
        api_fail(404, 'Блок не найден.');
    }
    $v = validate_block_input(request_body(), $id);
    db()->prepare('UPDATE rotation_blocks SET resident_id = ?, unit_id = ?, week_from = ?, week_to = ?, assigned_curator_id = ?, comment = ? WHERE id = ?')
        ->execute([$v['resident_id'], $v['unit_id'], $v['week_from'], $v['week_to'], $v['assigned_curator_id'], $v['comment'], $id]);
    $block = fetch_block($id);
    audit('block_update', $id, $old, $block);
    api_json(['block' => $block]);
}

function handle_block_delete(string $id): never
{
    require_auth();
    $old = fetch_block($id);
    if (!$old) {
        api_fail(404, 'Блок не найден.');
    }
    db()->prepare('DELETE FROM rotation_blocks WHERE id = ?')->execute([$id]);
    audit('block_delete', $id, $old, null);
    api_json(['ok' => true]);
}

function handle_block_assign_curator(string $id): never
{
    require_auth();
    $old = fetch_block($id);
    if (!$old) {
        api_fail(404, 'Блок не найден.');
    }
    $body = request_body();
    $curatorId = $body['curatorId'] ?? null;
    if ($curatorId === '') {
        $curatorId = null;
    }

    $st = db()->prepare('SELECT curator_id FROM unit_curators WHERE unit_id = ? ORDER BY pos, curator_id');
    $st->execute([$old['unitId']]);
    $candidates = array_column($st->fetchAll(), 'curator_id');
    if ($curatorId !== null && !in_array($curatorId, $candidates, true)) {
        api_fail(422, 'Выбранный куратор не входит в кандидаты этого подразделения.');
    }

    db()->prepare('UPDATE rotation_blocks SET assigned_curator_id = ? WHERE id = ?')->execute([$curatorId, $id]);
    $block = fetch_block($id);
    audit('curator_assign', $id, $old, $block);
    api_json(['block' => $block]);
}

function handle_audit_list(): never
{
    require_auth();
    $rows = db()->query('SELECT id, ts, action, block_id, old_value, new_value FROM audit_log ORDER BY id DESC LIMIT 300')->fetchAll();
    api_json(['entries' => array_map(static fn($r) => [
        'id'      => (int) $r['id'],
        'ts'      => $r['ts'],
        'action'  => $r['action'],
        'blockId' => $r['block_id'],
        'old'     => $r['old_value'] === null ? null : json_decode($r['old_value'], true),
        'new'     => $r['new_value'] === null ? null : json_decode($r['new_value'], true),
    ], $rows)]);
}
