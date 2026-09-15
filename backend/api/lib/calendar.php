<?php
// Календарь учебного года (ТЗ 1.3, раздел 3.1): недели «ротация идёт / не идёт»
// и исключения по дням. Единая функция is_rotation_day() используется окнами
// напоминаний, кабинетами и генератором.

declare(strict_types=1);

/**
 * День ротации? Правила по убыванию приоритета:
 *   1) исключение по дням: kind=off → нет, kind=on → да;
 *   2) суббота/воскресенье → нет;
 *   3) дата внутри учебной недели с is_rotation=1 → да; иначе нет.
 * $ctx — schedule_context(): нужны 'weeks' (по num) и 'overrides'.
 */
function is_rotation_day(array $ctx, string $iso): bool
{
    foreach ($ctx['overrides'] as $o) {
        if ($o['dateFrom'] <= $iso && $iso <= $o['dateTo']) {
            return $o['kind'] === 'on';
        }
    }
    $wd = (int) (new DateTimeImmutable($iso))->format('N');
    if ($wd > 5) {
        return false;
    }
    foreach ($ctx['weeks'] as $w) {
        if ($w['start'] <= $iso && $iso <= $w['end']) {
            return $w['isRotation'];
        }
    }
    return false;
}

function iso_add_days(string $iso, int $n): string
{
    return (new DateTimeImmutable($iso))->modify(($n >= 0 ? '+' : '') . $n . ' days')->format('Y-m-d');
}

/** Первый день ротации в интервале дат или null. */
function first_rotation_day(array $ctx, string $from, string $to): ?string
{
    for ($d = $from; $d <= $to; $d = iso_add_days($d, 1)) {
        if (is_rotation_day($ctx, $d)) {
            return $d;
        }
    }
    return null;
}

/** Последний день ротации в интервале дат или null. */
function last_rotation_day(array $ctx, string $from, string $to): ?string
{
    for ($d = $to; $d >= $from; $d = iso_add_days($d, -1)) {
        if (is_rotation_day($ctx, $d)) {
            return $d;
        }
    }
    return null;
}

/** N дней ротации назад от даты (саму дату не считая). */
function sub_rotation_days(array $ctx, string $iso, int $n): string
{
    $d = $iso;
    $guard = 0;
    while ($n > 0 && $guard++ < 400) {
        $d = iso_add_days($d, -1);
        if (is_rotation_day($ctx, $d)) {
            $n--;
        }
    }
    return $d;
}

/* ─────────────────────────── правка календаря (только admin) ─────────────────────────── */

function handle_weeks_update(string $yearId): never
{
    $user = require_admin();
    resolve_year($yearId);
    $body = request_body();
    $weeks = $body['weeks'] ?? null;
    if (!is_array($weeks) || !$weeks) {
        api_fail(422, 'Передайте список недель.');
    }
    $old = fetch_weeks($yearId);
    $st = db()->prepare('UPDATE weeks SET is_rotation = ?, note = ? WHERE year_id = ? AND num = ?');
    $pdo = db();
    $pdo->beginTransaction();
    foreach ($weeks as $w) {
        $num = (int) ($w['num'] ?? 0);
        $note = isset($w['note']) ? trim((string) $w['note']) : null;
        if ($note === '') {
            $note = null;
        }
        $st->execute([!empty($w['isRotation']) ? 1 : 0, $note, $yearId, $num]);
    }
    $pdo->commit();
    $new = fetch_weeks($yearId);
    $changed = [];
    foreach ($new as $i => $w) {
        if ($w['isRotation'] !== $old[$i]['isRotation'] || $w['note'] !== $old[$i]['note']) {
            $changed[] = ['num' => $w['num'], 'isRotation' => $w['isRotation'], 'note' => $w['note']];
        }
    }
    if ($changed) {
        audit('calendar_weeks', null, null, ['changed' => $changed], $user, $yearId);
    }
    api_json(['weeks' => $new]);
}

function handle_override_create(string $yearId): never
{
    $user = require_admin();
    resolve_year($yearId);
    $b = request_body();
    $from = (string) ($b['dateFrom'] ?? '');
    $to = (string) ($b['dateTo'] ?? $from);
    $kind = (string) ($b['kind'] ?? 'off');
    $note = isset($b['note']) ? trim((string) $b['note']) : null;
    if ($note === '') {
        $note = null;
    }
    $re = '/^\d{4}-\d{2}-\d{2}$/';
    if (!preg_match($re, $from) || !preg_match($re, $to) || $from > $to) {
        api_fail(422, 'Укажите даты в формате ГГГГ-ММ-ДД, начало не позже конца.');
    }
    if (!in_array($kind, ['off', 'on'], true)) {
        api_fail(422, 'Тип исключения: off (ротации нет) или on (ротация идёт).');
    }
    db()->prepare('INSERT INTO calendar_overrides (year_id, date_from, date_to, kind, note) VALUES (?, ?, ?, ?, ?)')
        ->execute([$yearId, $from, $to, $kind, $note]);
    audit('calendar_override_add', null, null, ['dateFrom' => $from, 'dateTo' => $to, 'kind' => $kind, 'note' => $note], $user, $yearId);
    api_json(['overrides' => fetch_overrides($yearId)], 201);
}

function handle_override_delete(int $id): never
{
    $user = require_admin();
    $st = db()->prepare('SELECT id, year_id, date_from, date_to, kind, note FROM calendar_overrides WHERE id = ?');
    $st->execute([$id]);
    $o = $st->fetch();
    if (!$o) {
        api_fail(404, 'Исключение не найдено.');
    }
    db()->prepare('DELETE FROM calendar_overrides WHERE id = ?')->execute([$id]);
    audit('calendar_override_del', null, ['dateFrom' => $o['date_from'], 'dateTo' => $o['date_to'], 'kind' => $o['kind'], 'note' => $o['note']], null, $user, $o['year_id']);
    api_json(['overrides' => fetch_overrides($o['year_id'])]);
}

function handle_year_set_current(string $yearId): never
{
    $user = require_admin();
    resolve_year($yearId);
    db()->exec('UPDATE academic_years SET is_current = 0');
    db()->prepare('UPDATE academic_years SET is_current = 1 WHERE id = ?')->execute([$yearId]);
    audit('year_current', null, null, ['year' => $yearId], $user, $yearId);
    api_json(['years' => fetch_years()]);
}

function handle_settings_update(): never
{
    $user = require_admin();
    $b = request_body();
    $allowed = ['capacity_threshold' => 'capacityThreshold', 'window_finish_workdays' => 'finishWorkdays',
        'window_incoming_days' => 'incomingDays', 'recent_days' => 'recentDays'];
    $changed = [];
    $st = db()->prepare('UPDATE settings SET svalue = ? WHERE skey = ?');
    foreach ($allowed as $key => $field) {
        if (!array_key_exists($field, $b)) {
            continue;
        }
        $v = (int) $b[$field];
        if ($v < 1 || $v > 60) {
            api_fail(422, 'Значение настройки должно быть от 1 до 60.');
        }
        $st->execute([(string) $v, $key]);
        $changed[$field] = $v;
    }
    if ($changed) {
        audit('settings_update', null, null, $changed, $user, null);
    }
    api_json(['windows' => fetch_settings_windows(), 'capacityThreshold' => capacity_threshold()]);
}
