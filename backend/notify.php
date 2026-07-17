<?php
// Рассылка напоминаний кураторам (ТЗ, раздел 6). Запуск по Crontab
// в рабочие дни в 7:00 МСК: php backend/notify.php
//
// Этап 1 — «сухой прогон»: пока в settings не заполнен telegram_bot_token
// и у кураторов нет telegram_chat_id, скрипт только пишет в лог, что
// отправил бы. Включение боевой отправки на этапе 2 — добавление токена
// и привязка chat_id, БЕЗ изменения кода.

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit("Только из командной строки.\n");
}

require __DIR__ . '/api/lib/bootstrap.php';
require __DIR__ . '/api/lib/auth.php';
require __DIR__ . '/api/lib/schedule.php';
require __DIR__ . '/api/lib/windows.php';

$today = $argv[1] ?? moscow_today();   // дату можно передать аргументом — для тестов
$dow = (int) (new DateTimeImmutable($today))->format('N');

$logFile = config()['notify_log'] ?? null;
if (!$logFile) {
    $dir = __DIR__ . '/logs';
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    $logFile = $dir . '/notify.log';
}

function notify_log(string $line): void
{
    global $logFile;
    $stamp = '[' . moscow_now() . '] ' . $line;
    file_put_contents($logFile, $stamp . "\n", FILE_APPEND);
    echo $stamp . "\n";
}

if ($dow > 5) {
    notify_log("({$today}) выходной день — рассылка не выполняется.");
    exit(0);
}

$settingsRows = db()->query('SELECT skey, svalue FROM settings')->fetchAll();
$settings = array_column($settingsRows, 'svalue', 'skey');
$botToken = trim((string) ($settings['telegram_bot_token'] ?? ''));

$chatIds = [];
foreach (db()->query('SELECT id, telegram_chat_id FROM curators')->fetchAll() as $r) {
    $chatIds[$r['id']] = $r['telegram_chat_id'];
}

/** Отправка одного сообщения; без токена/чата — сухой прогон в лог. */
function deliver(string $botToken, ?string $chatId, string $recipient, string $text): void
{
    if ($botToken === '' || $chatId === null || $chatId === '') {
        notify_log("[DRY-RUN] → {$recipient}:\n{$text}");
        return;
    }
    $resp = @file_get_contents(
        'https://api.telegram.org/bot' . $botToken . '/sendMessage',
        false,
        stream_context_create(['http' => [
            'method'  => 'POST',
            'header'  => 'Content-Type: application/json',
            'content' => json_encode(['chat_id' => $chatId, 'text' => $text], JSON_UNESCAPED_UNICODE),
            'timeout' => 15,
        ]])
    );
    $ok = $resp !== false && (json_decode($resp, true)['ok'] ?? false);
    notify_log(($ok ? '[SENT]' : '[FAIL]') . " → {$recipient}:\n{$text}");
}

$ctx = schedule_context();
$isMonday = $dow === 1;
$dayNames = [1 => 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

/* ─── события по кураторам ─── */

$perCurator = []; // id => text[]
$push = static function (string $cid, string $text) use (&$perCurator) {
    $perCurator[$cid][] = $text;
};

foreach ($ctx['blocks'] as $b) {
    $cid = $b['curatorId'];
    if ($cid === null) {
        continue;
    }
    $resident = $ctx['residents'][$b['residentId']]['fio'] ?? $b['residentId'];

    if (is_finishing($ctx, $b, $today)) {
        $push($cid, sprintf(
            "Завершается ротация: %s, недели %d–%d, последний день — %s. " .
            "Доподпишите логбук за все дни посещения. Далее ординатор направляется: %s.",
            $resident, $b['from'], $b['to'], fmt_d(block_end($ctx, $b)), next_dest_text($ctx, $b)
        ));
    }
    if (is_coming_soon($ctx, $b, $today)) {
        $startIso = block_start($ctx, $b);
        $startDow = (int) (new DateTimeImmutable($startIso))->format('N');
        $push($cid, sprintf(
            "%s, %s к вам приходит на ротацию: %s, недели %d–%d (по %s).",
            fmt_d($startIso), $dayNames[$startDow], $resident, $b['from'], $b['to'], fmt_d(block_end($ctx, $b))
        ));
    }
}

if ($isMonday && ($settings['digest_monday'] ?? '1') === '1') {
    $nowByCurator = [];
    foreach ($ctx['blocks'] as $b) {
        if ($b['curatorId'] !== null && block_status($ctx, $b, $today) === 'current') {
            $nowByCurator[$b['curatorId']][] = $ctx['residents'][$b['residentId']]['fio'] ?? $b['residentId'];
        }
    }
    foreach ($nowByCurator as $cid => $fios) {
        $push($cid, 'Сейчас у вас на ротации: ' . implode('; ', $fios) .
            ' — не забывайте о ежедневной подписи логбука.');
    }
}

$sent = 0;
foreach ($perCurator as $cid => $texts) {
    $fio = $ctx['curators'][$cid]['fio'] ?? $cid;
    deliver($botToken, $chatIds[$cid] ?? null, $fio, implode("\n\n", $texts));
    $sent++;
}

/* ─── сводка администратору: manual-блоки без куратора ─── */

$unassigned = array_values(array_filter($ctx['blocks'], static fn($b) => $b['curatorId'] === null));
usort($unassigned, static fn($a, $z) => strcmp(block_start($ctx, $a), block_start($ctx, $z)));

$adminLines = [];
foreach ($unassigned as $b) {
    $dd = diff_days($today, block_start($ctx, $b));
    $line = sprintf('%s — %s, недели %d–%d, старт %s',
        $ctx['residents'][$b['residentId']]['fio'] ?? $b['residentId'],
        $ctx['units'][$b['unitId']]['name'] ?? $b['unitId'],
        $b['from'], $b['to'], fmt_d(block_start($ctx, $b)));
    if ($dd >= 0 && $dd <= 7) {
        $adminLines[] = '❗ СРОЧНО (ближайшие 7 дней): ' . $line;
    } elseif ($isMonday && $dd > 7 && $dd <= 28) {
        $adminLines[] = $line;
    }
}
if ($adminLines) {
    $text = "Требуют назначения куратора:\n" . implode("\n", $adminLines);
    deliver($botToken, $settings['admin_telegram_chat_id'] ?? null, 'администратору', $text);
    $sent++;
}

notify_log("({$today}, {$dayNames[$dow]}) рассылка завершена: сообщений — {$sent}" .
    ($botToken === '' ? ' (режим сухого прогона: токен бота не задан).' : '.'));
