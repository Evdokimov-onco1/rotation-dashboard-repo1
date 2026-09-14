<?php
// Окна событий («2 последних дня курации», «3 дня до приёма») —
// ЕДИНАЯ логика для кабинета куратора, кабинета учебной части и рассылки
// notify.php, чтобы экран и сообщения никогда не расходились (ТЗ, раздел 6).
// Даты границ блока считаются по календарю ротации (calendar.php): последний
// день блока — последний день ротации внутри его недель.

declare(strict_types=1);

/** Справочники учебного года одним набором — чтобы не дёргать БД в циклах. */
function schedule_context(?string $yearId = null): array
{
    static $cache = [];
    $yearId ??= current_year_id();
    if ($yearId === null) {
        api_fail(500, 'В базе нет ни одного учебного года.');
    }
    if (!isset($cache[$yearId])) {
        $cache[$yearId] = [
            'yearId'    => $yearId,
            'weeks'     => array_column(fetch_weeks($yearId), null, 'num'),
            'overrides' => fetch_overrides($yearId),
            'units'     => array_column(fetch_units(), null, 'id'),
            'curators'  => array_column(fetch_curators(), null, 'id'),
            'residents' => array_column(fetch_residents($yearId), null, 'id'),
            'blocks'    => fetch_blocks($yearId),
            'windows'   => fetch_settings_windows(),
            'threshold' => capacity_threshold(),
        ];
    }
    return $cache[$yearId];
}

/** Первый день ротации блока (или начало первой недели, если дней ротации нет). */
function block_start(array $ctx, array $b): string
{
    $raw = $ctx['weeks'][$b['from']]['start'];
    return first_rotation_day($ctx, $raw, $ctx['weeks'][$b['to']]['end']) ?? $raw;
}

/** Последний день ротации блока (или конец последней недели). */
function block_end(array $ctx, array $b): string
{
    $raw = $ctx['weeks'][$b['to']]['end'];
    return last_rotation_day($ctx, $ctx['weeks'][$b['from']]['start'], $raw) ?? $raw;
}

function block_status(array $ctx, array $b, string $today): string
{
    if (block_end($ctx, $b) < $today) {
        return 'past';
    }
    if (block_start($ctx, $b) > $today) {
        return 'future';
    }
    return 'current';
}

function diff_days(string $a, string $b): int
{
    return (int) round((strtotime($b) - strtotime($a)) / 86400);
}

/** Сегодня — в последних N днях ротации блока (по умолчанию 2: предпоследний и последний). */
function is_finishing(array $ctx, array $b, string $today): bool
{
    $lastDays = $ctx['windows']['finishWorkdays'];
    return block_status($ctx, $b, $today) === 'current'
        && $today >= sub_rotation_days($ctx, block_end($ctx, $b), $lastDays - 1);
}

/** До старта блока осталось 1..N календарных дней (по умолчанию 3). */
function is_coming_soon(array $ctx, array $b, string $today): bool
{
    $dd = diff_days($today, block_start($ctx, $b));
    return $dd >= 1 && $dd <= $ctx['windows']['incomingDays'];
}

function next_block_for(array $ctx, string $residentId, int $afterWeek): ?array
{
    $next = null;
    foreach ($ctx['blocks'] as $b) {
        if ($b['residentId'] === $residentId && $b['from'] > $afterWeek
            && ($next === null || $b['from'] < $next['from'])) {
            $next = $b;
        }
    }
    return $next;
}

function fmt_d(string $iso): string
{
    return substr($iso, 8, 2) . '.' . substr($iso, 5, 2) . '.' . substr($iso, 2, 2);
}

/** «Куда дальше»: следующее подразделение ординатора после блока $b. */
function next_dest_text(array $ctx, array $b): string
{
    $nb = next_block_for($ctx, $b['residentId'], $b['to']);
    if ($nb === null) {
        return 'ротации по графику завершены';
    }
    $unit = $ctx['units'][$nb['unitId']]['name'];
    $cur = $nb['curatorId']
        ? 'куратор: ' . $ctx['curators'][$nb['curatorId']]['fio']
        : '⚠️ куратор не назначен';
    return sprintf('%s, с %s · %s', $unit, fmt_d(block_start($ctx, $nb)), $cur);
}

function block_brief(array $ctx, array $b): array
{
    return $b + [
        'resident'  => $ctx['residents'][$b['residentId']]['fio'] ?? $b['residentId'],
        'unit'      => $ctx['units'][$b['unitId']]['name'] ?? $b['unitId'],
        'unitShort' => $ctx['units'][$b['unitId']]['short'] ?? $b['unitId'],
        'dateFrom'  => block_start($ctx, $b),
        'dateTo'    => block_end($ctx, $b),
    ];
}

/** Данные кабинета куратора: сейчас / придут / завершились / «возможно ваши». */
function curator_dashboard(string $curatorId, ?string $today = null, ?string $yearId = null): array
{
    $ctx = schedule_context($yearId);
    $today ??= moscow_today();
    if (!isset($ctx['curators'][$curatorId])) {
        api_fail(404, 'Куратор не найден.');
    }

    $current = $incoming = $recent = $maybe = [];
    foreach ($ctx['blocks'] as $b) {
        $res = $ctx['residents'][$b['residentId']] ?? null;
        if ($res && !$res['active']) {
            continue;
        }
        $mine = $b['curatorId'] === $curatorId;
        $candidate = $b['curatorId'] === null
            && in_array($curatorId, $ctx['units'][$b['unitId']]['candidates'] ?? [], true);
        if (!$mine && !$candidate) {
            continue;
        }
        if ($candidate) {
            if (block_status($ctx, $b, $today) !== 'past') {
                $maybe[] = block_brief($ctx, $b);
            }
            continue;
        }
        switch (block_status($ctx, $b, $today)) {
            case 'current':
                $current[] = block_brief($ctx, $b) + [
                    'finishing' => is_finishing($ctx, $b, $today),
                    'nextDest'  => next_dest_text($ctx, $b),
                ];
                break;
            case 'future':
                $incoming[] = block_brief($ctx, $b) + [
                    'comingSoon' => is_coming_soon($ctx, $b, $today),
                    'inDays'     => diff_days($today, block_start($ctx, $b)),
                ];
                break;
            case 'past':
                if (diff_days(block_end($ctx, $b), $today) <= $ctx['windows']['recentDays']) {
                    $recent[] = block_brief($ctx, $b);
                }
                break;
        }
    }
    usort($incoming, static fn($a, $z) => strcmp($a['dateFrom'], $z['dateFrom']));
    usort($recent, static fn($a, $z) => strcmp($z['dateTo'], $a['dateTo']));
    usort($maybe, static fn($a, $z) => strcmp($a['dateFrom'], $z['dateFrom']));

    return [
        'curator'  => $ctx['curators'][$curatorId],
        'year'     => $ctx['yearId'],
        'today'    => $today,
        'current'  => $current,
        'incoming' => $incoming,
        'recent'   => $recent,
        'maybe'    => $maybe,
        'windows'  => $ctx['windows'],
    ];
}

function handle_curator_dashboard(string $curatorId): never
{
    api_json(curator_dashboard($curatorId, null, resolve_year()));
}
