<?php

declare(strict_types=1);

require __DIR__ . '/../backend/Rules.php';

use Teaching\Rules;

$tests = 0;
$failures = [];

function check(string $name, bool $cond): void
{
    global $tests, $failures;
    $tests++;
    if (!$cond) {
        $failures[] = $name;
        fwrite(STDERR, "FAIL: {$name}\n");
    }
}

function eq(string $name, mixed $expected, mixed $actual): void
{
    check($name . ' (ожидалось ' . var_export($expected, true) .
        ', получено ' . var_export($actual, true) . ')', $expected === $actual);
}

function throws(string $name, callable $fn): void
{
    global $tests, $failures;
    $tests++;
    try {
        $fn();
    } catch (InvalidArgumentException) {
        return;
    } catch (Throwable $e) {
        $failures[] = $name . ' (брошено ' . get_class($e) . ')';
        fwrite(STDERR, "FAIL: {$name} — неверный тип исключения " . get_class($e) . "\n");
        return;
    }
    $failures[] = $name . ' (исключение не брошено)';
    fwrite(STDERR, "FAIL: {$name} — исключение не брошено\n");
}

// --- Справочник видов -------------------------------------------------------

$types = Rules::types();
eq('types(): 11 видов', 11, count($types));
$byId = [];
foreach ($types as $t) {
    $byId[$t['id']] = $t;
    eq("types(): ключи {$t['id']}",
        ['id', 'label', 'unit', 'coefficient_cent', 'daily_limited', 'integer_quantity'],
        array_keys($t));
}

$expectedCoef = [
    'lecture' => 100, 'seminar' => 100, 'practical' => 100, 'consultation' => 100,
    'preexam' => 200, 'control' => 50, 'pass' => 20, 'graded_pass' => 30,
    'exam' => 40, 'state_exam' => 50, 'practice' => 100,
];
foreach ($expectedCoef as $id => $coef) {
    eq("coefficient {$id}", $coef, $byId[$id]['coefficient_cent'] ?? null);
}

foreach (['pass', 'graded_pass', 'exam', 'state_exam'] as $id) {
    eq("daily_limited {$id}", true, $byId[$id]['daily_limited']);
    eq("integer {$id}", true, $byId[$id]['integer_quantity']);
}
eq('daily_limited lecture', false, $byId['lecture']['daily_limited']);
eq('integer preexam', true, $byId['preexam']['integer_quantity']);
eq('integer control', true, $byId['control']['integer_quantity']);
eq('label exam', 'Экзамен', $byId['exam']['label']);
eq('unit practice', 'обучающихся-недель', $byId['practice']['unit']);
eq('unit lecture', 'академических часов', $byId['lecture']['unit']);
eq('unit preexam', 'групп', $byId['preexam']['unit']);
eq('unit control', 'работ', $byId['control']['unit']);
eq('unit exam', 'обучающихся', $byId['exam']['unit']);

// --- Базовые расчёты --------------------------------------------------------

$r = Rules::calculate(['type' => 'lecture', 'quantity' => '2']);
eq('лекция 2 ч', 200, $r['hours_cent']);
eq('quantity нормализована', '2', $r['quantity']);
eq('type', 'lecture', $r['type']);
eq('unit', 'академических часов', $r['unit']);
eq('formula', '2 академических часов × 1 ч = 2 ч', $r['formula']);

// Комиссионный пример: 10 обучающихся × 0,5 = 5 ч на одного преподавателя,
// без умножения на состав комиссии.
$r = Rules::calculate(['type' => 'state_exam', 'quantity' => 10]);
eq('госэкзамен 10 × 0,5 = 500', 500, $r['hours_cent']);
eq('госэкзамен daily_limited', true, $r['daily_limited']);
eq('госэкзамен formula', '10 обучающихся × 0,5 ч = 5 ч', $r['formula']);

$r = Rules::calculate(['type' => 'preexam', 'quantity' => '3']);
eq('предэкзам 3 × 2 = 600', 600, $r['hours_cent']);
eq('предэкзам unit', 'групп', $r['unit']);

// --- Точное округление half-up ----------------------------------------------

// 0,005 ч × коэфф. 1 = 0,005 → ровно половина сотой → вверх до 0,01.
eq('half-up 0.005 → 1', 1, Rules::calculate(['type' => 'lecture', 'quantity' => '0.005'])['hours_cent']);
eq('half-down 0.004 → 0', 0, Rules::calculate(['type' => 'lecture', 'quantity' => '0.004'])['hours_cent']);
// 0,015 × 1 = 0,015 ч → 1,5 сотых → 2.
eq('half-up 0.015 → 2', 2, Rules::calculate(['type' => 'lecture', 'quantity' => '0.015'])['hours_cent']);
// 0,025 × 0,5 (control) — целое количество запрещено, возьмём тип с дробным.
// practice коэфф. 1: 0,125 → 12,5 сотых → 13.
eq('half-up 0.125 → 13', 13, Rules::calculate(['type' => 'practice', 'quantity' => '0.125'])['hours_cent']);
// Дробные величины, недостижимые в float точно, считаются точно:
// 2,675 × 1 = 2,675 ч → 267,5 сотых → 268 (float round(267.5) надёжно, но 1.005*100
// в float = 100.49999... — проверяем именно целочисленность).
eq('точное 1.005 → 101', 101, Rules::calculate(['type' => 'seminar', 'quantity' => '1.005'])['hours_cent']);

// --- Запятая как разделитель -------------------------------------------------

eq('запятая', 150, Rules::calculate(['type' => 'practical', 'quantity' => '1,5'])['hours_cent']);
eq('запятая нормализация', '1.5', Rules::calculate(['type' => 'practical', 'quantity' => '1,5'])['quantity']);
eq('запятая в целом типе', 40, Rules::calculate(['type' => 'exam', 'quantity' => '1,0'])['hours_cent']);

// --- Ограничение целочисленности --------------------------------------------

throws('exam 1.5', fn() => Rules::calculate(['type' => 'exam', 'quantity' => '1.5']));
throws('pass 0.5', fn() => Rules::calculate(['type' => 'pass', 'quantity' => '0.5']));
throws('preexam 2,25', fn() => Rules::calculate(['type' => 'preexam', 'quantity' => '2,25']));
eq('exam целое ок', 80, Rules::calculate(['type' => 'exam', 'quantity' => 2])['hours_cent']);
eq('exam "2.0" ок', 80, Rules::calculate(['type' => 'exam', 'quantity' => '2.0'])['hours_cent']);

// --- Валидация входа ---------------------------------------------------------

throws('нет type', fn() => Rules::calculate(['quantity' => '1']));
throws('нет quantity', fn() => Rules::calculate(['type' => 'lecture']));
throws('type не строка', fn() => Rules::calculate(['type' => 5, 'quantity' => '1']));
throws('type null', fn() => Rules::calculate(['type' => null, 'quantity' => '1']));
throws('неизвестный type', fn() => Rules::calculate(['type' => 'lecture2', 'quantity' => '1']));
throws('пустая строка', fn() => Rules::calculate(['type' => 'lecture', 'quantity' => '']));
throws('пробелы', fn() => Rules::calculate(['type' => 'lecture', 'quantity' => '   ']));
throws('научная нотация', fn() => Rules::calculate(['type' => 'lecture', 'quantity' => '1e3']));
throws('NaN', fn() => Rules::calculate(['type' => 'lecture', 'quantity' => 'NaN']));
throws('INF', fn() => Rules::calculate(['type' => 'lecture', 'quantity' => 'INF']));
throws('отрицательное', fn() => Rules::calculate(['type' => 'lecture', 'quantity' => '-1']));
throws('отрицательное int', fn() => Rules::calculate(['type' => 'lecture', 'quantity' => -5]));
throws('bool true', fn() => Rules::calculate(['type' => 'lecture', 'quantity' => true]));
throws('bool false', fn() => Rules::calculate(['type' => 'lecture', 'quantity' => false]));
throws('float', fn() => Rules::calculate(['type' => 'lecture', 'quantity' => 1.5]));
throws('массив', fn() => Rules::calculate(['type' => 'lecture', 'quantity' => [1]]));
throws('мусор', fn() => Rules::calculate(['type' => 'lecture', 'quantity' => 'abc']));
throws('две точки', fn() => Rules::calculate(['type' => 'lecture', 'quantity' => '1.2.3']));
throws('точка и запятая', fn() => Rules::calculate(['type' => 'lecture', 'quantity' => '1.2,3']));
throws('плюс', fn() => Rules::calculate(['type' => 'lecture', 'quantity' => '+1']));
throws('больше 4 знаков', fn() => Rules::calculate(['type' => 'lecture', 'quantity' => '0.00001']));

// --- Границы диапазона --------------------------------------------------------

eq('ноль допустим', 0, Rules::calculate(['type' => 'lecture', 'quantity' => '0'])['hours_cent']);
eq('ноль строка', '0', Rules::calculate(['type' => 'lecture', 'quantity' => '0,0000'])['quantity']);
eq('верхняя граница', 10000000, Rules::calculate(['type' => 'lecture', 'quantity' => '100000'])['hours_cent']);
eq('граница с дробью', 10000000,
    Rules::calculate(['type' => 'lecture', 'quantity' => '100000.0000'])['hours_cent']);
throws('выше границы', fn() => Rules::calculate(['type' => 'lecture', 'quantity' => '100000.0001']));
throws('выше границы int', fn() => Rules::calculate(['type' => 'lecture', 'quantity' => 100001]));
throws('огромное число', fn() => Rules::calculate(['type' => 'lecture', 'quantity' => '999999999999999999999']));

// Ведущие нули и хвостовые нули нормализуются.
eq('ведущие нули', '7', Rules::calculate(['type' => 'lecture', 'quantity' => '007'])['quantity']);
eq('хвостовые нули', '1.5', Rules::calculate(['type' => 'lecture', 'quantity' => '1.5000'])['quantity']);

// --- Инвариант: результат — целые сотые --------------------------------------

foreach ($expectedCoef as $id => $coef) {
    $q = $byId[$id]['integer_quantity'] ? '4' : '4.321';
    $res = Rules::calculate(['type' => $id, 'quantity' => $q]);
    check("инвариант int {$id}", is_int($res['hours_cent']) && $res['hours_cent'] >= 0);
}

// --- format() -----------------------------------------------------------------

eq('format 1234', '12,34', Rules::format(1234));
eq('format 1200', '12', Rules::format(1200));
eq('format 1210', '12,1', Rules::format(1210));
eq('format 0', '0', Rules::format(0));
eq('format 5', '0,05', Rules::format(5));
eq('format 50', '0,5', Rules::format(50));
eq('format 10000000', '100000', Rules::format(10000000));
throws('format отрицательное', fn() => Rules::format(-1));

// --- Итог ---------------------------------------------------------------------

if ($failures) {
    fwrite(STDERR, "\n" . count($failures) . " из {$tests} тестов не прошли\n");
    exit(1);
}
echo "{$tests} тестов пройдено\n";
exit(0);
