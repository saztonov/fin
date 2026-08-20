import { useMemo } from 'react';
import type { Ks6Grid } from '../../../api/types';

export interface Ks6TableRow {
  key: string;
  rowType: 'section' | 'kvr' | 'nom' | 'grandTotal';
  /** уровень раздела (для строк работ — уровень родительского раздела) */
  level: number;
  sectionId: string | null;
  itemId?: string;
  itemNo?: number;
  name: string;
  kvrCode?: string;
  unit?: string;
  characteristic?: string;
  amendmentNumber?: string | null;
  contractQty?: string;
  unitPrice?: string;
  contractTotal?: string;
  executedQty?: string;
  executedAmount?: string;
  remainderQty?: string;
  remainderAmount?: string;
  byPeriodQty: Record<string, string>;
  byPeriodAmount: Record<string, string>;
  collapsed?: boolean;
}

/** Плоские строки таблицы: иерархия → уровни, свёрнутые разделы скрыты, общий итог в конце. */
export function useKs6Rows(grid: Ks6Grid | undefined, collapsed: Set<string>): Ks6TableRow[] {
  return useMemo(() => {
    if (!grid) return [];
    const rows: Ks6TableRow[] = [];
    // стек текущих разделов: [id, level]
    const stack: { id: string; level: number }[] = [];
    let itemNo = 0;

    const isHidden = () => stack.some((s) => collapsed.has(s.id));

    for (const row of grid.rows) {
      if (row.type === 'section') {
        while (stack.length > 0 && stack[stack.length - 1]!.level >= row.level) stack.pop();
        const hidden = isHidden();
        stack.push({ id: row.id, level: row.level });
        if (hidden) continue;
        rows.push({
          key: row.id,
          rowType: 'section',
          level: row.level,
          sectionId: row.id,
          name: row.name,
          amendmentNumber: row.amendmentNumber,
          contractTotal: row.contractTotal,
          executedAmount: row.executedAmount,
          remainderAmount: row.remainderAmount,
          byPeriodQty: {},
          byPeriodAmount: row.byPeriod,
          collapsed: collapsed.has(row.id),
        });
        continue;
      }
      itemNo += 1;
      if (isHidden() || collapsed.has(row.sectionId)) continue;
      const parentLevel = stack.length > 0 ? stack[stack.length - 1]!.level : 0;
      const byPeriodQty: Record<string, string> = {};
      const byPeriodAmount: Record<string, string> = {};
      for (const [docId, cell] of Object.entries(row.byPeriod)) {
        byPeriodQty[docId] = cell.qty;
        byPeriodAmount[docId] = cell.amount;
      }
      rows.push({
        key: row.id,
        rowType: row.kind === 'kvr' ? 'kvr' : 'nom',
        level: parentLevel,
        sectionId: row.sectionId,
        itemId: row.id,
        itemNo,
        name: row.name,
        kvrCode: row.kvrCode,
        unit: row.unit,
        characteristic: row.characteristic,
        amendmentNumber: row.amendmentNumber,
        contractQty: row.contractQty,
        unitPrice: row.unitPrice,
        contractTotal: row.contractTotal,
        executedQty: row.executedQty,
        executedAmount: row.executedAmount,
        remainderQty: row.remainderQty,
        remainderAmount: row.remainderAmount,
        byPeriodQty,
        byPeriodAmount,
      });
    }

    rows.push({
      key: '__grand_total__',
      rowType: 'grandTotal',
      level: 0,
      sectionId: null,
      name: 'Итого, руб., в т.ч. НДС',
      contractTotal: grid.totals.contractTotal,
      executedAmount: grid.totals.executedAmount,
      remainderAmount: grid.totals.remainderAmount,
      byPeriodQty: {},
      byPeriodAmount: grid.totals.byPeriod,
    });
    return rows;
  }, [grid, collapsed]);
}
