import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  amendments,
  contracts,
  ks2Documents,
  ks2Lines,
  ks6Sections,
  workItems,
} from '../db/schema/index.js';
import { add, dec, sumStrings, vatFromGross } from '../lib/money.js';

export interface PeriodInfo {
  id: string;
  number: string;
  docDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  status: 'draft' | 'approved';
  source: 'manual' | 'import';
  importLabel: string | null;
  totalAmount: string;
}

export interface PeriodCell {
  qty: string;
  amount: string;
}

export interface GridItemRow {
  type: 'item';
  id: string;
  kind: 'kvr' | 'nomenclature';
  sectionId: string;
  kvrItemId: string | null;
  kvrCode: string;
  name: string;
  characteristic: string;
  unit: string;
  contractQty: string;
  unitPrice: string;
  materialUnitCost: string | null;
  workUnitCost: string | null;
  contractTotal: string;
  amendmentId: string | null;
  amendmentNumber: string | null;
  sortOrder: number;
  executedQty: string;
  executedAmount: string;
  remainderQty: string;
  remainderAmount: string;
  byPeriod: Record<string, PeriodCell>;
}

export interface GridSectionRow {
  type: 'section';
  id: string;
  parentId: string | null;
  level: number;
  name: string;
  sortOrder: number;
  amendmentId: string | null;
  amendmentNumber: string | null;
  contractTotal: string;
  executedAmount: string;
  remainderAmount: string;
  byPeriod: Record<string, string>;
}

export type GridRow = GridSectionRow | GridItemRow;

export interface Ks6Grid {
  contract: typeof contracts.$inferSelect | null;
  amendments: (typeof amendments.$inferSelect)[];
  periods: PeriodInfo[];
  rows: GridRow[];
  totals: {
    contractTotal: string;
    executedAmount: string;
    remainderAmount: string;
    vatContract: string;
    vatExecuted: string;
    byPeriod: Record<string, string>;
    catalogAmount: string;
    catalogMismatch: boolean;
  };
}

/** Полный грид КС-6 по договору: строки, помесячные колонки, агрегаты, итоги. */
export async function getKs6Grid(db: Db, objectId: string): Promise<Ks6Grid> {
  const [contract] = await db
    .select()
    .from(contracts)
    .where(and(eq(contracts.objectId, objectId), isNull(contracts.deletedAt)));
  if (!contract) {
    return {
      contract: null,
      amendments: [],
      periods: [],
      rows: [],
      totals: {
        contractTotal: '0.00',
        executedAmount: '0.00',
        remainderAmount: '0.00',
        vatContract: '0.00',
        vatExecuted: '0.00',
        byPeriod: {},
        catalogAmount: '0.00',
        catalogMismatch: false,
      },
    };
  }

  const [amendmentRows, sectionRows, itemRows, docRows] = await Promise.all([
    db
      .select()
      .from(amendments)
      .where(and(eq(amendments.contractId, contract.id), isNull(amendments.deletedAt)))
      .orderBy(asc(amendments.createdAt)),
    db
      .select()
      .from(ks6Sections)
      .where(and(eq(ks6Sections.contractId, contract.id), isNull(ks6Sections.deletedAt)))
      .orderBy(asc(ks6Sections.sortOrder)),
    db
      .select()
      .from(workItems)
      .where(and(eq(workItems.contractId, contract.id), isNull(workItems.deletedAt)))
      .orderBy(asc(workItems.sortOrder)),
    db
      .select()
      .from(ks2Documents)
      .where(and(eq(ks2Documents.contractId, contract.id), isNull(ks2Documents.deletedAt))),
  ]);

  const amendmentNumberById = new Map(amendmentRows.map((a) => [a.id, a.number]));

  // сортировка периодов: по period_from (null — в конец), затем по дате создания
  const docs = [...docRows].sort((a, b) => {
    const pa = a.periodFrom ?? '9999-12-31';
    const pb = b.periodFrom ?? '9999-12-31';
    if (pa !== pb) return pa < pb ? -1 : 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const lines =
    docs.length > 0
      ? await db
          .select()
          .from(ks2Lines)
          .where(
            inArray(
              ks2Lines.ks2DocumentId,
              docs.map((d) => d.id),
            ),
          )
      : [];

  // item -> period -> {qty, amount}
  const cellByItem = new Map<string, Map<string, PeriodCell>>();
  for (const line of lines) {
    let m = cellByItem.get(line.workItemId);
    if (!m) {
      m = new Map();
      cellByItem.set(line.workItemId, m);
    }
    m.set(line.ks2DocumentId, { qty: line.qty, amount: line.amount });
  }

  const approvedIds = new Set(docs.filter((d) => d.status === 'approved').map((d) => d.id));

  // строки работ с выполнением
  const itemGrid = new Map<string, GridItemRow>();
  for (const it of itemRows) {
    const byPeriod: Record<string, PeriodCell> = {};
    let execQty = dec(0);
    let execAmount = dec(0);
    const cells = cellByItem.get(it.id);
    if (cells) {
      for (const [docId, cell] of cells) {
        byPeriod[docId] = cell;
        if (approvedIds.has(docId)) {
          execQty = execQty.add(dec(cell.qty));
          execAmount = execAmount.add(dec(cell.amount));
        }
      }
    }
    itemGrid.set(it.id, {
      type: 'item',
      id: it.id,
      kind: it.kind,
      sectionId: it.sectionId,
      kvrItemId: it.kvrItemId,
      kvrCode: it.kvrCode,
      name: it.name,
      characteristic: it.characteristic,
      unit: it.unit,
      contractQty: it.contractQty,
      unitPrice: it.unitPrice,
      materialUnitCost: it.materialUnitCost,
      workUnitCost: it.workUnitCost,
      contractTotal: it.contractTotal,
      amendmentId: it.amendmentId,
      amendmentNumber: it.amendmentId ? (amendmentNumberById.get(it.amendmentId) ?? null) : null,
      sortOrder: it.sortOrder,
      executedQty: execQty.toFixed(6),
      executedAmount: execAmount.toFixed(2),
      remainderQty: dec(it.contractQty).sub(execQty).toFixed(6),
      remainderAmount: dec(it.contractTotal).sub(execAmount).toFixed(2),
      byPeriod,
    });
  }

  // агрегат КВР = сумма его номенклатур (стоимости; договорные значения — из файла)
  for (const it of itemRows) {
    if (it.kind !== 'kvr') continue;
    const kvr = itemGrid.get(it.id)!;
    const children = itemRows.filter((c) => c.kvrItemId === it.id && c.kind === 'nomenclature');
    let execAmount = dec(0);
    const byPeriod: Record<string, PeriodCell> = {};
    for (const child of children) {
      const row = itemGrid.get(child.id)!;
      execAmount = execAmount.add(dec(row.executedAmount));
      for (const [docId, cell] of Object.entries(row.byPeriod)) {
        const acc = byPeriod[docId] ?? { qty: '', amount: '0.00' };
        acc.amount = add(acc.amount, cell.amount);
        byPeriod[docId] = acc;
      }
    }
    kvr.executedAmount = execAmount.toFixed(2);
    kvr.remainderAmount = dec(kvr.contractTotal).sub(execAmount).toFixed(2);
    kvr.executedQty = '';
    kvr.remainderQty = '';
    kvr.byPeriod = byPeriod;
  }

  // дерево разделов: уровень и агрегаты снизу вверх
  const sectionById = new Map(sectionRows.map((s) => [s.id, s]));
  const levelOf = (id: string): number => {
    let level = 1;
    let cur = sectionById.get(id);
    while (cur?.parentId) {
      level += 1;
      cur = sectionById.get(cur.parentId);
    }
    return level;
  };

  interface SectionAgg {
    contractTotal: ReturnType<typeof dec>;
    executed: ReturnType<typeof dec>;
    byPeriod: Map<string, ReturnType<typeof dec>>;
  }
  const agg = new Map<string, SectionAgg>();
  const ensureAgg = (id: string): SectionAgg => {
    let a = agg.get(id);
    if (!a) {
      a = { contractTotal: dec(0), executed: dec(0), byPeriod: new Map() };
      agg.set(id, a);
    }
    return a;
  };

  // только номенклатуры входят в суммы разделов (КВР — их дубль-агрегат)
  for (const it of itemRows) {
    if (it.kind !== 'nomenclature') continue;
    const row = itemGrid.get(it.id)!;
    let sectionId: string | null = it.sectionId;
    while (sectionId) {
      const a = ensureAgg(sectionId);
      a.contractTotal = a.contractTotal.add(dec(row.contractTotal));
      a.executed = a.executed.add(dec(row.executedAmount));
      for (const [docId, cell] of Object.entries(row.byPeriod)) {
        a.byPeriod.set(docId, (a.byPeriod.get(docId) ?? dec(0)).add(dec(cell.amount)));
      }
      sectionId = sectionById.get(sectionId)?.parentId ?? null;
    }
  }

  const sectionGrid: GridSectionRow[] = sectionRows.map((s) => {
    const a = agg.get(s.id);
    const byPeriod: Record<string, string> = {};
    if (a) for (const [docId, v] of a.byPeriod) byPeriod[docId] = v.toFixed(2);
    return {
      type: 'section',
      id: s.id,
      parentId: s.parentId,
      level: levelOf(s.id),
      name: s.name,
      sortOrder: s.sortOrder,
      amendmentId: s.amendmentId,
      amendmentNumber: s.amendmentId ? (amendmentNumberById.get(s.amendmentId) ?? null) : null,
      contractTotal: (a?.contractTotal ?? dec(0)).toFixed(2),
      executedAmount: (a?.executed ?? dec(0)).toFixed(2),
      remainderAmount: (a?.contractTotal ?? dec(0)).sub(a?.executed ?? dec(0)).toFixed(2),
      byPeriod,
    };
  });

  // порядок строк: сквозной sort_order по договору
  const rows: GridRow[] = [...sectionGrid, ...itemGrid.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  // итоги
  const nomRows = [...itemGrid.values()].filter((r) => r.kind === 'nomenclature');
  const contractTotal = sumStrings(nomRows.map((r) => r.contractTotal));
  const executedAmount = sumStrings(nomRows.map((r) => r.executedAmount));
  const byPeriodTotals: Record<string, string> = {};
  for (const doc of docs) {
    byPeriodTotals[doc.id] = sumStrings(nomRows.map((r) => r.byPeriod[doc.id]?.amount));
  }

  const periods: PeriodInfo[] = docs.map((d) => ({
    id: d.id,
    number: d.number,
    docDate: d.docDate,
    periodFrom: d.periodFrom,
    periodTo: d.periodTo,
    status: d.status,
    source: d.source,
    importLabel: d.importLabel,
    totalAmount: byPeriodTotals[d.id] ?? '0.00',
  }));

  const catalogAmount = add(contract.amount, ...amendmentRows.map((a) => a.amount));

  return {
    contract,
    amendments: amendmentRows,
    periods,
    rows,
    totals: {
      contractTotal,
      executedAmount,
      remainderAmount: dec(contractTotal).sub(dec(executedAmount)).toFixed(2),
      vatContract: vatFromGross(contractTotal),
      vatExecuted: vatFromGross(executedAmount),
      byPeriod: byPeriodTotals,
      catalogAmount,
      catalogMismatch: !dec(catalogAmount).isZero() && !dec(catalogAmount).eq(dec(contractTotal)),
    },
  };
}
