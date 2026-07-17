<?php
// Окна событий («2 последних рабочих дня курации», «3 дня до приёма») —
// ЕДИНАЯ логика для кабинета куратора, кабинета учебной части и рассылки
// notify.php, чтобы экран и сообщения никогда не расходились (ТЗ, раздел 6).

declare(strict_types=1);

/** Справочники одним набором — чтобы не дёргать БД в циклах. */
function schedule_context(): array
{
    static $ctx = null;
    if ($ctx === null) {
        $ctx = [
            'weeks'     => array_column(fetch_weeks(), null, 'num'),
            'units'     => array_column(fetch_units(), null, 'id'),
            'curators'  => array_column(fetch_curators(), null, 'id'),
            'residents' => array_column(fetch_residents(), null, 'id'),
            'blocks'    => fetch_blocks(),
            'windows'   => fetch_settings_windows(),
        ];
    }
    return $ctx;
}

function block_start(array $ctx, array $b): string
{
    return $ctx['weeks'][$b['from']]['start'];
}

function block_end(array $ctx, array $b): string
{
    return $ctx['weeks'][$b['to']]['end'];
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

function is_workday(DateTimeImmutable $d): bool
{
    $wd = (int) $d->format('N');
    return $wd >= 1 && $wd <= 5;
}

/** N рабочих дней назад от даты (не включая её саму). */
function sub_workdays(string $iso, int $n): string
{
    $d = new DateTimeImmutable($iso);
    while ($n > 0) {
        $d = $d->sub(new DateInterval('P1D'));
        if (is_workday($d)) {
            $n--;
        }
    }
    return $d->format('Y-m-d');
}

function diff_days(string $a, string $b): int
{
    return (int) round((strtotime($b) - strtotime($a)) / 86400);
}

/** Сегодня — в последних N рабочих днях блока (по умолчанию 2: предпоследний и последний). */
function is_finishing(array $ctx, array $b, string $today): bool
{
    $lastDays = $ctx['windows']['finishWorkdays'];
    return block_status($ctx, $b, $today) === 'current'
        && $today >= sub_workdays(block_end($ctx, $b), $lastDays - 1);
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
function curator_dashboard(string $curatorId, ?string $today = null): array
{
    $ctx = schedule_context();
    $today ??= moscow_today();
    if (!isset($ctx['curators'][$curatorId])) {
        api_fail(404, 'Куратор не найден.');
    }

    $current = $incoming = $recent = $maybe = [];
    foreach ($ctx['blocks'] as $b) {
        $mine = $b['curatorId'] === $curatorId;
        $candidate = $b['curatorId'] === null
            && in_array($curatorId, $ctx['units'][$b['unitId']]['candidates'] ?? [], true);
        if (!$mine && !$candidate) {
            continue;
        }
        if ($candidate) {
            $maybe[] = block_brief($ctx, $b);
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
    api_json(curator_dashboard($curatorId));
}
