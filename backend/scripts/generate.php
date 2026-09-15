<?php
// Генерация ротации из командной строки (то же, что кнопка в админке).
//   php backend/scripts/generate.php --year=2026-27 [--org=mmcc] [--from=1] [--seed=42] [--apply]
// Без --apply — только показывает результат и предупреждения.

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit("Только из командной строки.\n");
}
require __DIR__ . '/../api/lib/bootstrap.php';
require __DIR__ . '/../api/lib/auth.php';
require __DIR__ . '/../api/lib/schedule.php';
require __DIR__ . '/../api/lib/calendar.php';
require __DIR__ . '/../api/lib/windows.php';
require __DIR__ . '/../api/lib/generator.php';

$opts = getopt('', ['year::', 'org::', 'from::', 'seed::', 'apply']);
$yearId = $opts['year'] ?? current_year_id();
$cli = ['id' => 0, 'login' => 'cli', 'name' => 'консоль', 'role' => 'admin', 'orgId' => null];

$res = generate_rotation([
    'yearId'   => $yearId,
    'orgId'    => $opts['org'] ?? null,
    'fromWeek' => (int) ($opts['from'] ?? 1),
    'seed'     => isset($opts['seed']) ? (int) $opts['seed'] : null,
]);
$ctx = schedule_context($yearId);

printf("Год %s, seed %d, ординаторов %d, блоков %d, превышение порога (человеко-недель) %d\n", $yearId, $res['seed'], count($res['residentIds']), count($res['blocks']), $res['excess']);
$byRes = [];
foreach ($res['blocks'] as $b) {
    $byRes[$b['residentId']][] = $b;
}
foreach ($byRes as $rid => $bs) {
    $parts = array_map(static fn($b) => sprintf('%d–%d %s', $b['from'], $b['to'], $ctx['units'][$b['unitId']]['short']), $bs);
    printf("  %-34s %s\n", $ctx['residents'][$rid]['fio'], implode(' · ', $parts));
}
foreach ($res['warnings'] as $w) {
    echo "  ⚠ {$w}\n";
}

if (isset($opts['apply'])) {
    apply_generated($yearId, $res['residentIds'], $res['fromWeek'], $res['blocks'], $cli, $res['seed']);
    echo "Записано в БД.\n";
}
