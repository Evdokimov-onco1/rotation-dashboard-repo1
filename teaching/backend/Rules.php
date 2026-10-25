<?php

declare(strict_types=1);

namespace Teaching;

use InvalidArgumentException;

/**
 * Правила расчёта учебной нагрузки.
 *
 * Нагрузка хранится и возвращается в целых сотых долях академического часа.
 * Вся арифметика — целочисленная, без float.
 */
final class Rules
{
    /**
     * coefficient_cent — сотые доли часа за единицу количества.
     * integer_quantity — количество должно быть целым.
     * daily_limited — вид участвует в дневном лимите (проверяется сервисом).
     */
    private const TYPES = [
        'lecture' => [
            'label' => 'Лекции',
            'unit' => 'академических часов',
            'coefficient_cent' => 100,
            'integer_quantity' => false,
            'daily_limited' => false,
        ],
        'seminar' => [
            'label' => 'Семинары',
            'unit' => 'академических часов',
            'coefficient_cent' => 100,
            'integer_quantity' => false,
            'daily_limited' => false,
        ],
        'practical' => [
            'label' => 'Практические занятия',
            'unit' => 'академических часов',
            'coefficient_cent' => 100,
            'integer_quantity' => false,
            'daily_limited' => false,
        ],
        'consultation' => [
            'label' => 'Консультации',
            'unit' => 'академических часов',
            'coefficient_cent' => 100,
            'integer_quantity' => false,
            'daily_limited' => false,
        ],
        'preexam' => [
            'label' => 'Консультации перед экзаменом',
            'unit' => 'групп',
            'coefficient_cent' => 200,
            'integer_quantity' => true,
            'daily_limited' => false,
        ],
        'control' => [
            'label' => 'Контроль СР',
            'unit' => 'работ',
            'coefficient_cent' => 50,
            'integer_quantity' => true,
            'daily_limited' => false,
        ],
        'pass' => [
            'label' => 'Зачёт',
            'unit' => 'обучающихся',
            'coefficient_cent' => 20,
            'integer_quantity' => true,
            'daily_limited' => true,
        ],
        'graded_pass' => [
            'label' => 'Зачёт с оценкой',
            'unit' => 'обучающихся',
            'coefficient_cent' => 30,
            'integer_quantity' => true,
            'daily_limited' => true,
        ],
        'exam' => [
            'label' => 'Экзамен',
            'unit' => 'обучающихся',
            'coefficient_cent' => 40,
            'integer_quantity' => true,
            'daily_limited' => true,
        ],
        'state_exam' => [
            'label' => 'Государственный экзамен',
            'unit' => 'обучающихся',
            'coefficient_cent' => 50,
            'integer_quantity' => true,
            'daily_limited' => true,
        ],
        'practice' => [
            'label' => 'Руководство практикой',
            'unit' => 'обучающихся-недель',
            'coefficient_cent' => 100,
            'integer_quantity' => false,
            'daily_limited' => false,
        ],
    ];

    /** Максимальное количество единиц за одну запись. */
    private const MAX_QUANTITY = 100000;

    /** Шкала количества: 4 знака после запятой. */
    private const QTY_SCALE = 10000;

    /**
     * Рассчитывает нагрузку на одного участвующего преподавателя.
     *
     * @param array{type?: mixed, quantity?: mixed} $input
     * @return array{
     *     type: string,
     *     quantity: string,
     *     hours_cent: int,
     *     coefficient_cent: int,
     *     unit: string,
     *     formula: string,
     *     daily_limited: bool
     * }
     */
    public static function calculate(array $input): array
    {
        $type = $input['type'] ?? null;
        if (!is_string($type) || !isset(self::TYPES[$type])) {
            throw new InvalidArgumentException(
                'Неизвестный вид нагрузки. Ожидается один из кодов: ' .
                implode(', ', array_keys(self::TYPES)) . '.'
            );
        }
        $def = self::TYPES[$type];

        if (!array_key_exists('quantity', $input)) {
            throw new InvalidArgumentException('Не указано количество (quantity).');
        }

        [$qtyScaled, $normalized] = self::parseQuantity($input['quantity'], $def['integer_quantity']);

        // Произведение: (количество * 10^4) * (часы * 10^2) = часы * 10^6.
        $product = $qtyScaled * $def['coefficient_cent'];
        // Одно округление half-up до сотых долей часа точной целочисленной арифметикой.
        $hoursCent = intdiv($product + 5000, 10000);

        $coefText = self::format($def['coefficient_cent']);
        $hoursText = self::format($hoursCent);
        $formula = "{$normalized} {$def['unit']} × {$coefText} ч = {$hoursText} ч";

        return [
            'type' => $type,
            'quantity' => $normalized,
            'hours_cent' => $hoursCent,
            'coefficient_cent' => $def['coefficient_cent'],
            'unit' => $def['unit'],
            'formula' => $formula,
            'daily_limited' => $def['daily_limited'],
        ];
    }

    /**
     * Справочник видов нагрузки.
     *
     * @return list<array{id: string, label: string, unit: string,
     *     coefficient_cent: int, daily_limited: bool, integer_quantity: bool}>
     */
    public static function types(): array
    {
        $list = [];
        foreach (self::TYPES as $id => $def) {
            $list[] = [
                'id' => $id,
                'label' => $def['label'],
                'unit' => $def['unit'],
                'coefficient_cent' => $def['coefficient_cent'],
                'daily_limited' => $def['daily_limited'],
                'integer_quantity' => $def['integer_quantity'],
            ];
        }
        return $list;
    }

    /**
     * Форматирует сотые доли часа как десятичную строку с запятой.
     * format(1234) === '12,34'; format(1200) === '12'; format(1210) === '12,1'.
     */
    public static function format(int $hundredths): string
    {
        if ($hundredths < 0) {
            throw new InvalidArgumentException('Значение для форматирования не может быть отрицательным.');
        }
        $whole = intdiv($hundredths, 100);
        $frac = $hundredths % 100;
        if ($frac === 0) {
            return (string) $whole;
        }
        $fracText = rtrim(str_pad((string) $frac, 2, '0', STR_PAD_LEFT), '0');
        return $whole . ',' . $fracText;
    }

    /**
     * Разбирает quantity в целое число десятитысячных долей и каноническую строку.
     *
     * @return array{0: int, 1: string}
     */
    private static function parseQuantity(mixed $quantity, bool $integerOnly): array
    {
        if (is_int($quantity)) {
            $raw = (string) $quantity;
        } elseif (is_string($quantity)) {
            $raw = trim($quantity);
        } else {
            throw new InvalidArgumentException(
                'Количество должно быть целым числом или строкой с десятичным числом.'
            );
        }

        if ($raw === '') {
            throw new InvalidArgumentException('Количество не должно быть пустым.');
        }

        // Единственная десятичная запятая нормализуется в точку.
        if (str_contains($raw, ',') && str_contains($raw, '.')) {
            throw new InvalidArgumentException(
                'Некорректное количество: нельзя одновременно использовать точку и запятую.'
            );
        }
        if (substr_count($raw, ',') > 1) {
            throw new InvalidArgumentException('Некорректное количество: больше одной запятой.');
        }
        $raw = str_replace(',', '.', $raw);

        if (!preg_match('/^\d+(\.\d{1,4})?$/', $raw)) {
            throw new InvalidArgumentException(
                'Некорректное количество: допустимо неотрицательное число ' .
                'не более чем с 4 знаками после запятой, без экспоненты и знаков.'
            );
        }

        [$intPart, $fracPart] = array_pad(explode('.', $raw, 2), 2, '');

        if ($integerOnly && $fracPart !== '' && rtrim($fracPart, '0') !== '') {
            throw new InvalidArgumentException(
                'Для этого вида нагрузки количество должно быть целым числом.'
            );
        }

        $intDigits = ltrim($intPart, '0');
        if (strlen($intDigits) > 9) {
            throw new InvalidArgumentException('Количество слишком велико.');
        }

        $scaled = (int) $intPart * self::QTY_SCALE
            + (int) str_pad($fracPart, 4, '0');

        if ($scaled > self::MAX_QUANTITY * self::QTY_SCALE) {
            throw new InvalidArgumentException(
                'Количество не должно превышать ' . self::MAX_QUANTITY . '.'
            );
        }

        // Каноническая запись: без ведущих нулей и хвостовых нулей дроби.
        $normInt = $intDigits === '' ? '0' : $intDigits;
        $normFrac = rtrim($fracPart, '0');
        $normalized = $normFrac === '' ? $normInt : $normInt . '.' . $normFrac;

        return [$scaled, $normalized];
    }
}
