import { describe, expect, it } from 'vitest';
import { netFromGross, sumStrings, vatFromGross, vatRateOn } from '../lib/money.js';

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

  it('ставка берётся по дате: у строк ДС 2026 года она своя, у договора 2025 — своя', () => {
    expect(vatRateOn('2025-11-30')).toBe(20);
    expect(vatRateOn('2026-02-01')).toBe(22);
    // одна и та же сумма даёт разный НДС в зависимости от даты договора или ДС
    expect(vatFromGross('1200000.00', '2025-11-30')).toBe('200000.00');
    expect(vatFromGross('1200000.00', '2026-02-01')).toBe('216393.44');
  });
});
