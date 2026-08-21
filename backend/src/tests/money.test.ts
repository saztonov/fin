import { describe, expect, it } from 'vitest';
import {
  add,
  dec,
  isNegative,
  lineAmount,
  netFromGross,
  netPriceFromGross,
  round2,
  round6,
  roundQty,
  sub,
  sumStrings,
  vatFromGross,
  vatRateOn,
} from '../lib/money.js';

describe('money', () => {
  it('round2: half-up как в Excel', () => {
    expect(round2('1.005')).toBe('1.01');
    expect(round2('1.004')).toBe('1.00');
    expect(round2('-1.005')).toBe('-1.01');
    expect(round2(0)).toBe('0.00');
  });

  it('lineAmount: объём × цена без плавающих ошибок', () => {
    expect(lineAmount('0.1', '0.2')).toBe('0.02');
    expect(lineAmount('0.5', '8260.00')).toBe('4130.00');
    expect(lineAmount('67321.96', '1995')).toBe('134307310.20');
    // доля комплекта
    expect(lineAmount('0.3', '350000')).toBe('105000.00');
  });

  it('vatFromGross: ставка берётся по дате периода (20% до 2026, 22% с 01.01.2026)', () => {
    expect(vatFromGross('120', '2025-12-31')).toBe('20.00');
    expect(vatFromGross('3249617599.59', '2025-06-30')).toBe('541602933.27');
    expect(vatFromGross('1432855689.19', '2025-01-01')).toBe('238809281.53');
    // с 01.01.2026 — 22/122
    expect(vatFromGross('122', '2026-01-01')).toBe('22.00');
    expect(vatFromGross('120', '2026-08-20')).toBe('21.64');
  });

  it('vatRateOn: граница смены ставки', () => {
    expect(vatRateOn('2025-12-31')).toBe(20);
    expect(vatRateOn('2026-01-01')).toBe(22);
    expect(vatRateOn('2030-05-05')).toBe(22);
  });

  it('sumStrings/add/sub — точная десятичная арифметика', () => {
    expect(sumStrings(['0.1', '0.2', '0.3'])).toBe('0.60');
    expect(add('1.11', '2.22', null, undefined)).toBe('3.33');
    expect(sub('1.00', '3.00')).toBe('-2.00');
    expect(isNegative(sub('1.00', '3.00'))).toBe(true);
  });

  it('roundQty: до 6 знаков', () => {
    expect(roundQty('0.1234567')).toBe('0.123457');
    expect(dec(roundQty('0.5')).toString()).toBe('0.5');
  });

  it('round6: расценка хранится с 6 знаками', () => {
    expect(round6('1234.5678')).toBe('1234.567800');
    expect(round6('1234.56785')).toBe('1234.567850');
    expect(round6('1234.5678549')).toBe('1234.567855');
  });

  it('netFromGross: «без НДС» + НДС всегда дают исходную сумму до копейки', () => {
    for (const [amount, date] of [
      ['120', '2025-12-31'],
      ['122', '2026-01-01'],
      ['0.01', '2026-01-01'],
      ['3249617599.59', '2025-06-30'],
      ['1432855689.19', '2026-08-20'],
    ] as const) {
      expect(add(netFromGross(amount, date), vatFromGross(amount, date))).toBe(round2(amount));
    }
    expect(netFromGross('120', '2025-12-31')).toBe('100.00');
    expect(netFromGross('122', '2026-01-01')).toBe('100.00');
  });

  it('netPriceFromGross: цена без НДС — делением, чтобы не потерять знаки', () => {
    expect(netPriceFromGross('120', '2025-12-31')).toBe('100.000000');
    expect(netPriceFromGross('122', '2026-01-01')).toBe('100.000000');
    // копеечная цена: вычитание round2-НДС дало бы 0.01, деление — точную долю
    expect(netPriceFromGross('0.01', '2026-01-01')).toBe('0.008197');
  });
});
