import { describe, expect, it } from 'vitest';
import {
  assertPeriodFitsPart,
  partOfPeriod,
  partRate,
  periodFitsPart,
} from '../lib/estimate-parts.js';
import {
  netFromGross,
  netPriceFromGrossRate,
  sumStrings,
  vatFromGross,
  vatFromGrossRate,
  vatRateOn,
} from '../lib/money.js';

/**
 * Правила, на которых стоит режим «без НДС» в гриде КС-6 (ks6.service).
 * НДС выделяется построчно, а итог — сумма построчных: только так «без НДС»
 * по строкам складывается в «без НДС» по документу, и таблица сходится сама с собой.
 */
describe('НДС в гриде КС-6', () => {
  // копеечные суммы: на них построчное выделение расходится с выделением от итога
  const rows = ['0.03', '0.03', '0.03', '0.03', '0.03', '0.03', '0.03'];
  const date = '2026-03-31';

  it('построчное выделение сходится: Σ нетто + Σ НДС = Σ строк', () => {
    const gross = sumStrings(rows);
    const net = sumStrings(rows.map((r) => netFromGross(r, date)));
    const vat = sumStrings(rows.map((r) => vatFromGross(r, date)));
    expect(sumStrings([net, vat])).toBe(gross);
  });

  it('выделение от итога с построчным не совпадает — потому итог и считается снизу вверх', () => {
    const gross = sumStrings(rows);
    expect(sumStrings(rows.map((r) => vatFromGross(r, date)))).not.toBe(vatFromGross(gross, date));
  });

  it('ставка берётся по дате периода: 20 % до 31.12.2025, 22 % с 01.01.2026', () => {
    expect(vatRateOn('2025-11-30')).toBe(20);
    expect(vatRateOn('2026-02-01')).toBe(22);
    // одна и та же сумма даёт разный НДС в зависимости от периода КС-2
    expect(vatFromGross('1200000.00', '2025-11-30')).toBe('200000.00');
    expect(vatFromGross('1200000.00', '2026-02-01')).toBe('216393.44');
  });

  it('без даты берётся действующая ставка — по ней считаются договорные колонки legacy', () => {
    expect(vatRateOn(null)).toBe(vatRateOn(new Date().toISOString().slice(0, 10)));
  });
});

/**
 * Части сметы: при разделении по ставкам дата перестаёт что-либо решать. Реальный
 * случай — смета в ценах 20 %, часть работ которой исполняется в 2026-м и лежит на
 * отдельном листе книги «КС6а ндс22%».
 */
describe('Ставка части сметы', () => {
  it('ставка части главнее даты', () => {
    expect(partRate('vat20')).toBe(20);
    expect(partRate('vat22')).toBe(22);
    // legacy ставки не имеет — там решает дата
    expect(partRate('legacy')).toBeNull();

    // период 2025 года дал бы 20 %, но часть 22 % считается по 22 %
    expect(vatFromGross('1200000.00', '2025-05-10')).toBe('200000.00');
    expect(vatFromGrossRate('1200000.00', partRate('vat22')!)).toBe('216393.44');
  });

  it('цена без НДС считается делением и сохраняет 6 знаков в API', () => {
    // округление до копеек — задача отображения, API отдаёт точное значение
    expect(netPriceFromGrossRate('4146291.47', 22)).toBe('3398599.565574');
    expect(netPriceFromGrossRate('4146291.47', 20)).toBe('3455242.891667');
  });

  it('нулевая ставка ничего не выделяет', () => {
    expect(vatFromGrossRate('1200000.00', 0)).toBe('0.00');
    expect(netPriceFromGrossRate('1234.567890', 0)).toBe('1234.567890');
  });
});

describe('Границы периодов по частям', () => {
  it('часть 20 % не принимает периоды 2026 года', () => {
    expect(() => assertPeriodFitsPart('vat20', '2026-01-01', '2026-01-31')).toThrow(
      /01\.01\.2026|22 %/,
    );
    expect(() => assertPeriodFitsPart('vat20', '2025-12-01', '2025-12-31')).not.toThrow();
  });

  it('часть 22 % не принимает периоды до 2026 года', () => {
    expect(() => assertPeriodFitsPart('vat22', '2025-12-01', '2025-12-31')).toThrow();
    expect(() => assertPeriodFitsPart('vat22', '2026-01-01', '2026-01-31')).not.toThrow();
  });

  it('legacy принимает любой период, но не перевёрнутый', () => {
    expect(() => assertPeriodFitsPart('legacy', '2024-01-01', '2026-12-31')).not.toThrow();
    expect(() => assertPeriodFitsPart('legacy', '2026-05-01', '2026-01-01')).toThrow(/позже/);
  });

  it('период через 31.12.2025 относится к вкладке по дате окончания', () => {
    // «КС2№1 01.12.2025-18.02.2026» у Садовнической: раньше не проходил ни в одну
    // вкладку и молча пропадал при импорте
    expect(periodFitsPart('vat22', '2025-12-01', '2026-02-18')).toBe(true);
    expect(periodFitsPart('vat20', '2025-12-01', '2026-02-18')).toBe(false);
    expect(() => assertPeriodFitsPart('vat22', '2025-12-01', '2026-02-18')).not.toThrow();
  });

  it('плановый график 2026-2028 на листе «по 31.12.2025» вкладкой 20 % не принимается', () => {
    // Сторис.xlsx: 36 колонок вперёд на листе 20 %, те же месяцы есть на листе 22 %
    expect(periodFitsPart('vat20', '2026-05-01', '2026-05-31')).toBe(false);
    expect(periodFitsPart('vat20', '2028-05-01', '2028-05-31')).toBe(false);
  });

  it('период без дат не отвергается — его дозаполняют вручную', () => {
    expect(periodFitsPart('vat20', null, null)).toBe(true);
    expect(periodFitsPart('vat22', null, null)).toBe(true);
  });

  it('колонка книги относится к части по дате начала периода', () => {
    expect(partOfPeriod('2025-12-31')).toBe('vat20');
    expect(partOfPeriod('2026-01-01')).toBe('vat22');
    expect(partOfPeriod(null)).toBe('vat20');
    // конец периода решает и здесь: акт закрывается на последнюю дату
    expect(partOfPeriod('2025-12-01', '2026-02-18')).toBe('vat22');
  });
});
