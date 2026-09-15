<?php
// Генератор ротации (ТЗ 1.3, раздел 5.6). Строит блоки для ординаторов в
// режиме «ротация» по программе года: обязательный ЦАОП, 2 длинных блока
// (ХТ ДС / ЛТ / ООПЛТ), 4 онкологических отделения, при остатке недель —
// короткий блок ЛД/иУЗИ или удлинение последнего. Приоритет ординатора
// задаёт первый блок и профиль ЦАОП; правило организации (НМХЦ) — первый
// блок в одном из ЦАОП, каждому свой. Подразделения выбираются так, чтобы
// загрузка была ровной; превышение порога — предупреждение, не запрет.

declare(strict_types=1);

function default_program(): array
{
    return [
        'caop'  => ['units' => ['caop_gmu', 'caop_obsh'], 'len' => 6],
        'long'  => ['units' => ['ht_ds', 'lt', 'ooplt'], 'len' => 6, 'pick' => 2],
        'oo'    => ['units' => ['oo1', 'oo2', 'oo3', 'oo4', 'oo5'], 'len' => 4, 'pick' => 4],
        'short' => ['units' => ['ld', 'iuzi'], 'len' => 2],
        'orgRules' => [
            'nmhc' => ['firstCaop' => ['caop_gmu', 'caop_obsh', 'ht_ds_a22']],
        ],
    ];
}

function program(): array
{
    $json = setting('program_json', '');
    if ($json !== '') {
        $p = json_decode($json, true);
        if (is_array($p)) {
            return array_replace_recursive(default_program(), $p);
        }
    }
    return default_program();
}

/** Правило по тексту приоритета из анкеты: первые блоки и профиль ЦАОП. */
function priority_rule(?string $text): array
{
    $t = mb_strtolower(trim((string) $text));
    $t = str_replace('ё', 'е', $t);
    $none = ['first' => [], 'caop' => null];
    if ($t === '' || str_contains($t, 'не извест') || str_contains($t, 'неизвест')) {
        return $none;
    }
    if (str_contains($t, 'мамм')) {
        return ['first' => ['oo1'], 'caop' => 'caop_gmu'];
    }
    if (str_contains($t, 'абдом')) {
        return ['first' => ['oo2'], 'caop' => 'caop_obsh'];
    }
    if (str_contains($t, 'нэо') || str_contains($t, 'нейроэндокрин')) {
        return ['first' => ['ht_ds'], 'caop' => 'caop_obsh'];
    }
    if (str_contains($t, 'хирург')) {
        return ['first' => ['oo2'], 'caop' => 'caop_obsh'];
    }
    $ht = preg_match('/(^|[^а-я])хт([^а-я]|$)/u', $t) || str_contains($t, 'химио');
    $lt = preg_match('/(^|[^а-я])лт([^а-я]|$)/u', $t) || str_contains($t, 'лучев');
    if ($ht && $lt) {
        return ['first' => ['ht_ds', 'lt'], 'caop' => 'caop_obsh'];
    }
    if ($ht) {
        return ['first' => ['ht_ds'], 'caop' => 'caop_obsh'];
    }
    if ($lt) {
        return ['first' => ['lt'], 'caop' => 'caop_obsh'];
    }
    return $none;
}

/** Категория и длина блока для подразделения по программе. */
function unit_category(array $prog, string $unitId): ?array
{
    foreach (['caop', 'long', 'oo', 'short'] as $cat) {
        if (in_array($unitId, $prog[$cat]['units'], true)) {
            return ['cat' => $cat, 'len' => (int) $prog[$cat]['len']];
        }
    }
    foreach ($prog['orgRules'] as $rule) {
        if (in_array($unitId, $rule['firstCaop'] ?? [], true)) {
            return ['cat' => 'caop', 'len' => (int) $prog['caop']['len']];
        }
    }
    return null;
}

/**
 * Построить ротацию. $opts: yearId, orgId?, residentIds?, fromWeek (1), seed?.
 * Возвращает ['blocks' => [...], 'warnings' => [...], 'overloads' => [...], 'seed' => int].
 */
function generate_rotation(array $opts): array
{
    $ctx = schedule_context($opts['yearId'] ?? null);
    $prog = program();
    $threshold = $ctx['threshold'];
    $fromWeek = max(1, (int) ($opts['fromWeek'] ?? 1));
    $seed = isset($opts['seed']) ? (int) $opts['seed'] : random_int(1, 999999);
    mt_srand($seed);

    // Недели ротации по порядку (позиции 0..K-1).
    $rw = [];
    foreach ($ctx['weeks'] as $w) {
        if ($w['isRotation']) {
            $rw[] = $w['num'];
        }
    }
    $K = count($rw);
    if ($K === 0) {
        api_fail(422, 'В календаре года нет ни одной недели ротации.');
    }
    $posOf = static function (int $weekNum) use ($rw): int { // позиция первой недели ротации >= num
        foreach ($rw as $i => $n) {
            if ($n >= $weekNum) {
                return $i;
            }
        }
        return count($rw);
    };
    $startPos = $posOf($fromWeek);

    // Кого генерируем.
    $targets = [];
    foreach ($ctx['residents'] as $r) {
        if (!$r['active'] || $r['mode'] !== 'rotation') {
            continue;
        }
        if (!empty($opts['orgId']) && $r['orgId'] !== $opts['orgId']) {
            continue;
        }
        if (!empty($opts['residentIds']) && !in_array($r['id'], $opts['residentIds'], true)) {
            continue;
        }
        $targets[$r['id']] = $r;
    }
    if (!$targets) {
        api_fail(422, 'Нет ординаторов в режиме «ротация» для генерации.');
    }

    // Загрузка: блоки других ординаторов + сохраняемые (до fromWeek) блоки целевых.
    $load = []; // unit => weekNum => count
    $kept = []; // residentId => kept blocks
    foreach ($ctx['blocks'] as $b) {
        $isTarget = isset($targets[$b['residentId']]);
        if ($isTarget && $b['from'] >= $fromWeek) {
            continue; // будет заменён
        }
        if (isset($ctx['residents'][$b['residentId']]) && !$ctx['residents'][$b['residentId']]['active']) {
            continue;
        }
        for ($w = $b['from']; $w <= $b['to']; $w++) {
            $load[$b['unitId']][$w] = ($load[$b['unitId']][$w] ?? 0) + 1;
        }
        if ($isTarget) {
            $kept[$b['residentId']][] = $b;
        }
    }

    // Распределение «первого ЦАОП» по правилу организации: каждому свой, по кругу со случайного старта.
    $orgCaopCursor = [];
    $warnings = [];

    $state = []; // residentId => cursor, done units, queue
    foreach ($targets as $rid => $r) {
        $done = [];
        $cursor = $startPos;
        foreach ($kept[$rid] ?? [] as $kb) {
            $done[$kb['unitId']] = true;
            $cursor = max($cursor, $posOf($kb['to'] + 1));
        }
        $rule = priority_rule($r['priority']);
        $forced = [];
        $orgRule = $prog['orgRules'][$r['orgId']] ?? null;
        if ($orgRule && !empty($orgRule['firstCaop']) && empty($kept[$rid])) {
            $pool = $orgRule['firstCaop'];
            if (!isset($orgCaopCursor[$r['orgId']])) {
                $orgCaopCursor[$r['orgId']] = mt_rand(0, count($pool) - 1);
            }
            $unit = $pool[$orgCaopCursor[$r['orgId']] % count($pool)];
            $orgCaopCursor[$r['orgId']]++;
            $forced[] = $unit;
        }
        foreach ($rule['first'] as $u) {
            if (!isset($done[$u]) && !in_array($u, $forced, true)) {
                $forced[] = $u;
            }
        }
        foreach ($forced as $i => $u) {
            if (!isset($ctx['units'][$u])) {
                $warnings[] = sprintf('%s: подразделение «%s» из правил не найдено в справочнике — пропущено.', $r['fio'], $u);
                unset($forced[$i]);
            }
        }
        $forced = array_values($forced);
        $state[$rid] = [
            'cursor'    => $cursor,
            'done'      => $done,
            'forced'    => $forced,
            'caopPref'  => $rule['caop'],
            'seq'       => [],   // порядок категорий после принудительных блоков
            'placed'    => [],   // блоки, поставленные в этом прогоне
            'finished'  => false,
        ];
    }

    // Порядок категорий: базовый шаблон, сдвинутый для каждого ординатора, —
    // чтобы в любой момент в длинных блоках была примерно треть потока, а не все сразу.
    $basePattern = ['oo', 'long', 'oo', 'caop', 'oo', 'long', 'oo'];
    $order = array_keys($state);
    shuffle($order);
    foreach ($order as $k => $rid) {
        $st = &$state[$rid];
        $needCnt = ['caop' => 1, 'long' => (int) $prog['long']['pick'], 'oo' => (int) $prog['oo']['pick']];
        foreach (array_merge(array_keys($st['done']), $st['forced']) as $u) {
            $c = unit_category($prog, $u);
            if ($c && isset($needCnt[$c['cat']])) {
                $needCnt[$c['cat']]--;
            }
        }
        $off = $k % count($basePattern);
        $pattern = array_merge(array_slice($basePattern, $off), array_slice($basePattern, 0, $off));
        $seq = [];
        foreach ($pattern as $cat) {
            if ($needCnt[$cat] > 0) {
                $seq[] = $cat;
                $needCnt[$cat]--;
            }
        }
        foreach ($needCnt as $cat => $n) { // на всякий случай — если шаблон короче потребности
            for ($i = 0; $i < $n; $i++) {
                $seq[] = $cat;
            }
        }
        $st['seq'] = $seq;
        unset($st);
    }

    $newBlocks = [];

    // Целевая загрузка «человек на подразделение в неделю» по категориям:
    // (ординаторов × блоков × длина) / недель / подразделений в категории.
    // Стоимость варианта — загрузка относительно цели, чтобы редкие
    // категории (3 длинных подразделения) не откладывались на конец года.
    $nT = count($targets);
    $ideal = [];
    foreach (['caop', 'long', 'oo', 'short'] as $cat) {
        $pick = (float) ($prog[$cat]['pick'] ?? 1);
        $unitsN = max(1, count($prog[$cat]['units']));
        $ideal[$cat] = max(0.5, $nT * $pick * (int) $prog[$cat]['len'] / max(1, $K) / $unitsN);
    }
    $spanCost = static function (string $unit, int $pos, int $len) use (&$load, $rw, $K, $threshold, $prog, $ideal): float {
        $cat = unit_category($prog, $unit)['cat'] ?? 'oo';
        $cost = 0.0;
        for ($i = $pos; $i < min($K, $pos + $len); $i++) {
            $c = ($load[$unit][$rw[$i]] ?? 0) + 1;
            $cost += $c / $ideal[$cat] + ($c > $threshold ? 3.0 : 0.0);
        }
        return $cost / max(1, $len);
    };
    $place = static function (string $rid, string $unit, int $len) use (&$state, &$load, &$newBlocks, $rw, $K, $ctx): void {
        $pos = $state[$rid]['cursor'];
        $endPos = min($K - 1, $pos + $len - 1);
        $u = $ctx['units'][$unit] ?? null;
        $b = [
            'residentId' => $rid,
            'unitId'     => $unit,
            'from'       => $rw[$pos],
            'to'         => $rw[$endPos],
            'curatorId'  => ($u && $u['rule'] === 'auto') ? ($u['candidates'][0] ?? null) : null,
            'comment'    => null,
        ];
        for ($i = $pos; $i <= $endPos; $i++) {
            $load[$unit][$rw[$i]] = ($load[$unit][$rw[$i]] ?? 0) + 1;
        }
        $newBlocks[] = $b;
        $state[$rid]['placed'][] = count($newBlocks) - 1;
        $state[$rid]['done'][$unit] = true;
        $state[$rid]['cursor'] = $endPos + 1;
    };

    $guard = 0;
    while ($guard++ < 2000) {
        // Ординатор с наименьшим курсором среди незавершённых.
        $rid = null;
        $order = array_keys($state);
        shuffle($order);
        foreach ($order as $id) {
            if ($state[$id]['finished']) {
                continue;
            }
            if ($rid === null || $state[$id]['cursor'] < $state[$rid]['cursor']) {
                $rid = $id;
            }
        }
        if ($rid === null) {
            break;
        }
        $st = &$state[$rid];
        if ($st['cursor'] >= $K) {
            $st['finished'] = true;
            $left = count($st['seq']) + count($st['forced']);
            if ($left > 0) {
                $warnings[] = sprintf('%s: не хватило недель на %d блок(а) программы.', $targets[$rid]['fio'], $left);
            }
            unset($st);
            continue;
        }

        // 1) принудительные первые блоки
        if ($st['forced']) {
            $unit = array_shift($st['forced']);
            $cat = unit_category($prog, $unit);
            $place($rid, $unit, $cat['len'] ?? 4);
            unset($st);
            continue;
        }

        // 2) следующая категория по последовательности; подразделение — по загрузке
        $options = [];
        while ($st['seq'] && !$options) {
            $cat = array_shift($st['seq']);
            if ($cat === 'caop') {
                $pool = $st['caopPref'] ? [$st['caopPref']] : $prog['caop']['units'];
            } else {
                $pool = $prog[$cat]['units'];
            }
            foreach ($pool as $u) {
                if (!isset($st['done'][$u]) && isset($ctx['units'][$u])) {
                    $options[] = [$u, (int) $prog[$cat]['len']];
                }
            }
        }

        if (!$options) {
            // 3) программа выполнена — добираем остаток недель
            $rest = $K - $st['cursor'];
            $shortLen = (int) $prog['short']['len'];
            $shortPool = array_values(array_filter($prog['short']['units'], static fn($u) => !isset($st['done'][$u]) && isset($ctx['units'][$u])));
            if ($rest >= $shortLen && $shortPool && $rest > 2) {
                $best = null;
                foreach ($shortPool as $u) {
                    $c = $spanCost($u, $st['cursor'], $shortLen);
                    if ($best === null || $c < $best[1]) {
                        $best = [$u, $c];
                    }
                }
                $place($rid, $best[0], $shortLen);
            } elseif ($st['placed']) {
                // удлиняем последний поставленный блок
                $idx = end($st['placed']);
                $b = &$newBlocks[$idx];
                $newEnd = $rw[$K - 1];
                for ($i = $st['cursor']; $i < $K; $i++) {
                    $load[$b['unitId']][$rw[$i]] = ($load[$b['unitId']][$rw[$i]] ?? 0) + 1;
                }
                $b['to'] = $newEnd;
                unset($b);
                $st['cursor'] = $K;
            } else {
                $st['finished'] = true;
            }
            unset($st);
            continue;
        }

        // Лучший вариант по загрузке; при равенстве — случайный.
        $scored = [];
        foreach ($options as [$u, $len]) {
            $scored[] = [$spanCost($u, $st['cursor'], $len) + mt_rand(0, 1000) / 4000, $u, $len];
        }
        usort($scored, static fn($a, $z) => $a[0] <=> $z[0]);
        [, $unit, $len] = $scored[0];
        $place($rid, $unit, $len);
        unset($st);
    }

    // Перегрузки после размещения (по всем блокам года).
    $overloads = [];
    foreach ($load as $unit => $byWeek) {
        ksort($byWeek);
        $run = null;
        foreach ($byWeek as $w => $c) {
            if ($c > $threshold) {
                if ($run && $run['to'] === $w - 1 && $run['count'] === $c) {
                    $run['to'] = $w;
                } else {
                    if ($run) {
                        $overloads[] = $run;
                    }
                    $run = ['unitId' => $unit, 'from' => $w, 'to' => $w, 'count' => $c];
                }
            }
        }
        if ($run) {
            $overloads[] = $run;
        }
    }
    usort($overloads, static fn($a, $z) => [$a['unitId'], $a['from']] <=> [$z['unitId'], $z['from']]);
    foreach ($overloads as $o) {
        $warnings[] = sprintf('%s: недели %d–%d — %d чел. (порог %d).',
            $ctx['units'][$o['unitId']]['short'] ?? $o['unitId'], $o['from'], $o['to'], $o['count'], $threshold);
    }

    $excess = 0;
    foreach ($overloads as $o) {
        $excess += ($o['count'] - $threshold) * ($o['to'] - $o['from'] + 1);
    }

    return [
        'excess'      => $excess,   // сумма превышений порога по всем неделям и подразделениям
        'yearId'      => $ctx['yearId'],
        'fromWeek'    => $fromWeek,
        'residentIds' => array_keys($targets),
        'blocks'      => $newBlocks,
        'warnings'    => $warnings,
        'overloads'   => $overloads,
        'threshold'   => $threshold,
        'seed'        => $seed,
    ];
}

/**
 * Применить результат генерации: блоки перечисленных ординаторов с недели
 * $fromWeek заменяются присланными (одна транзакция, та же валидация, что у
 * одиночных блоков). Используется и API (/blocks/bulk), и консолью generate.php.
 */
function apply_generated(string $yearId, array $residentIds, int $fromWeek, array $blocks, array $user, ?int $seed = null): int
{
    $residentIds = array_values(array_unique(array_map('strval', $residentIds)));
    if (!$residentIds || !is_array($blocks)) {
        api_fail(422, 'Укажите ординаторов и блоки.');
    }
    foreach ($residentIds as $rid) {
        $r = fetch_resident($rid);
        if (!$r || $r['yearId'] !== $yearId) {
            api_fail(422, 'Ординатор не найден в этом учебном году.');
        }
        require_org_access($user, $r['orgId']);
    }
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $del = $pdo->prepare('DELETE FROM rotation_blocks WHERE year_id = ? AND resident_id = ? AND week_from >= ?');
        $removed = 0;
        foreach ($residentIds as $rid) {
            $del->execute([$yearId, $rid, $fromWeek]);
            $removed += $del->rowCount();
        }
        $n = 0;
        foreach ($blocks as $b) {
            if (!in_array((string) ($b['residentId'] ?? ''), $residentIds, true)) {
                api_fail(422, 'В списке есть блок ординатора, не входящего в пересобираемый набор.');
            }
            if ((int) ($b['from'] ?? 0) < $fromWeek) {
                api_fail(422, 'Блоки раньше недели пересборки менять нельзя.');
            }
            insert_block($yearId, validate_block_input($b, null, $yearId, $user));
            $n++;
        }
        audit('generate_apply', null, ['removed' => $removed],
            ['residents' => $residentIds, 'fromWeek' => $fromWeek, 'blocks' => $n, 'seed' => $seed], $user, $yearId);
        $pdo->commit();
        return $n;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

function handle_generate(): never
{
    $user = require_auth();
    $b = request_body();
    $yearId = resolve_year($b['yearId'] ?? null);
    $orgId = $b['orgId'] ?? null;
    if ($user['role'] === 'dispatcher') {
        $orgId = $user['orgId']; // распорядитель генерирует только свою когорту
    }
    $res = generate_rotation([
        'yearId'      => $yearId,
        'orgId'       => $orgId ?: null,
        'residentIds' => isset($b['residentIds']) && is_array($b['residentIds']) ? array_map('strval', $b['residentIds']) : null,
        'fromWeek'    => $b['fromWeek'] ?? 1,
        'seed'        => $b['seed'] ?? null,
    ]);
    api_json($res);
}
