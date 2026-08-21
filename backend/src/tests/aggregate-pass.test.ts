import { describe, expect, it } from 'vitest';
import { detectAggregates } from '../worker/parse-child/aggregate-pass.js';
import type { ParsedItem } from '../worker/parse-child/parsed-schema.js';

function item(partial: Partial<ParsedItem> & { tmpId: string }): ParsedItem {
  return {
    sectionTmpId: 's1',
    kind: 'nomenclature',
    kvrTmpId: 'kvr0',
    kvrCode: '',
    name: partial.tmpId,
    characteristic: '',
    unit: 'м3',
    contractQty: '1',
    unitPrice: '0.00',
    materialUnitCost: null,
    workUnitCost: null,
    contractTotal: '0.00',
    fileExecutedTotal: null,
    budgetArticle: '',
    rowNumber: 1,
    ...partial,
  };
}

describe('detectAggregates', () => {
  it('строка, равная сумме следующих (>=2), становится КВР, части привязываются к ней', () => {
    const items: ParsedItem[] = [
      item({ tmpId: 'head', contractTotal: '100.00' }),
      item({ tmpId: 'a', contractTotal: '60.00' }),
      item({ tmpId: 'b', contractTotal: '40.00' }),
      item({ tmpId: 'tail', contractTotal: '5.00' }),
    ];
    const warnings: string[] = [];
    detectAggregates(items, warnings);
    expect(items[0]!.kind).toBe('kvr');
    expect(items[1]!.kvrTmpId).toBe('head');
    expect(items[2]!.kvrTmpId).toBe('head');
    expect(items[3]!.kind).toBe('nomenclature');
    expect(items[3]!.kvrTmpId).toBe('kvr0');
    expect(warnings).toHaveLength(1);
  });

  it('строку с явной пометкой в колонке «Вид» эвристика не трогает', () => {
    const items: ParsedItem[] = [
      item({ tmpId: 'head', contractTotal: '100.00' }),
      item({ tmpId: 'a', contractTotal: '60.00' }),
      item({ tmpId: 'b', contractTotal: '40.00' }),
    ];
    const warnings: string[] = [];
    detectAggregates(items, warnings, new Set(['head']));
    expect(items[0]!.kind).toBe('nomenclature');
    expect(warnings).toHaveLength(0);
  });

  it('совпадение с одной строкой — не агрегат (минимум две)', () => {
    const items: ParsedItem[] = [
      item({ tmpId: 'x', contractTotal: '50.00' }),
      item({ tmpId: 'y', contractTotal: '50.00' }),
    ];
    detectAggregates(items, []);
    expect(items[0]!.kind).toBe('nomenclature');
  });

  it('не пересекает границу раздела', () => {
    const items: ParsedItem[] = [
      item({ tmpId: 'h', contractTotal: '100.00' }),
      item({ tmpId: 'a', contractTotal: '60.00' }),
      item({ tmpId: 'b', contractTotal: '40.00', sectionTmpId: 's2' }),
    ];
    detectAggregates(items, []);
    expect(items[0]!.kind).toBe('nomenclature');
  });
});
