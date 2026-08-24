import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  importFiles,
  ks2Documents,
  ks2Lines,
  ks6Sections,
  workItems,
} from '../db/schema/index.js';
import type { PartCode } from '../lib/estimate-parts.js';
import {
  add,
  dec,
  lineAmount,
  netFromGrossRate,
  netPriceFromGrossRate,
  sub,
  sumStrings,
  vatFromGrossRate,
  vatRateOn,
} from '../lib/money.js';
import { listParts, resolvePart, type PartInfo } from './parts.service.js';

/** Режим отображения сумм: gross — как в смете (с НДС), net — без НДС. */
export type VatView = 'gross' | 'net';

export interface PeriodInfo {
  id: string;
  number: string;
  docDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  status: 'draft' | 'approved';
  source: 'manual' | 'import';
  importLabel: string | null;
  /** сумма документа с НДС — независимо от режима отображения таблицы */
  totalAmount: string;
  /** ставка на дату периода: 20% до 31.12.2025, 22% с 01.01.2026 */
  vatRate: number;
  vatAmount: string;
  netAmount: string;
}

export interface PeriodCell {
  qty: string;
  amount: string;
}

export interface GridItemRow {
  type: 'item';
  id: string;
  kind: 'kvr' | 'nomenclature' | 'subline';
  sectionId: string;
  kvrItemId: string | null;
  kvrCode: string;
  name: string;
  characteristic: string;
  unit: string;
  contractQty: string;
  unitPrice: string;
  /** цена как в смете (с НДС) — по ней грид считает предпросмотр правки объёма */
  unitPriceGross: string;
  materialUnitCost: string | null;
  workUnitCost: string | null;
  contractTotal: string;
  sortOrder: number;
  executedQty: string;
  executedAmount: string;
  remainderQty: string;
  remainderAmount: string;
  byPeriod: Record<string, PeriodCell>;
  /**
   * Расхождения с исходным Excel — грид подсвечивает их красной обводкой.
   * null означает «сверить не с чем» либо «сходится до копейки».
   */
  totalMismatch: string | null;
  fileExecutedTotal: string | null;
  executedMismatch: string | null;
}

export interface GridSectionRow {
  type: 'section';
  id: string;
  parentId: string | null;
  level: number;
  name: string;
  sortOrder: number;
  contractTotal: string;
  executedAmount: string;
  remainderAmount: string;
  byPeriod: Record<string, string>;
}

export type GridRow = GridSectionRow | GridItemRow;

export interface Ks6Grid {
  /** вкладки: одна legacy — вкладки не показываются, vat20+vat22 — показываются */
  availableParts: PartInfo[];
  activePart: PartInfo | null;
  periods: PeriodInfo[];
  rows: GridRow[];
  totals: {
    contractTotal: string;
    executedAmount: string;
    remainderAmount: string;
    /** режим отображения, в котором посчитаны суммы выше */
    vatView: VatView;
    vatContract: string;
    vatExecuted: string;
    /** ставка договорных колонок; по периодам ставка своя — см. PeriodInfo.vatRate */
    vatRateContract: number;
    byPeriod: Record<string, string>;
    /** контрольные суммы последнего применённого импорта и расхождения с ними */
    fileContractTotal: string | null;
    contractMismatch: string | null;
    fileExecutedTotal: string | null;
    executedMismatch: string | null;
    fileTotalsSource: { fileName: string; appliedAt: string } | null;
  };
}

/** Ненулевая разница строкой; ноль и «не с чем сверять» дают null. */
function mismatch(actual: string, control: string | null): string | null {
  if (control === null || control === '') return null;
  const diff = dec(actual).sub(dec(control));
  return diff.isZero() ? null : diff.toFixed(2);
}

/** Полный грид КС-6 по объекту: строки, помесячные колонки, агрегаты, итоги. */
export async function getKs6Grid(
  db: Db,
  objectId: string,
  opts: { vatView?: VatView; part?: PartCode } = {},
): Promise<Ks6Grid> {
  const vatView: VatView = opts.vatView ?? 'gross';

  // грид всегда показывает ОДНУ часть: части 20 % и 22 % — перекрывающиеся версии
  // одной сметы, и сложить их значило бы задвоить смету
  const availableParts = await listParts(db, objectId);
  const activePart = resolvePart(availableParts, opts.part);
  if (!activePart) {
    return {
      availableParts,
      activePart: null,
      periods: [],
      rows: [],
      totals: {
        contractTotal: '0.00',
        executedAmount: '0.00',
        remainderAmount: '0.00',
        vatView,
        vatContract: '0.00',
        vatExecuted: '0.00',
        vatRateContract: vatRateOn(null),
        byPeriod: {},
        fileContractTotal: null,
        contractMismatch: null,
        fileExecutedTotal: null,
        executedMismatch: null,
        fileTotalsSource: null,
      },
    };
  }

  const [sectionRows, itemRows, docRows] = await Promise.all([
    db
      .select()
      .from(ks6Sections)
      .where(and(eq(ks6Sections.partId, activePart.id), isNull(ks6Sections.deletedAt)))
      .orderBy(asc(ks6Sections.sortOrder)),
    db
      .select()
      .from(workItems)
      .where(and(eq(workItems.partId, activePart.id), isNull(workItems.deletedAt)))
      .orderBy(asc(workItems.sortOrder)),
    db
      .select()
      .from(ks2Documents)
      .where(and(eq(ks2Documents.partId, activePart.id), isNull(ks2Documents.deletedAt))),
  ]);

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
  // сверка с контрольной графой файла идёт только по импортированным КС-2: КС-2,
  // введённые экономистом вручную, законно уводят выполнение от значения в книге
  const importedIds = new Set(docs.filter((d) => d.source === 'import').map((d) => d.id));

  // Режим «без НДС»: суммы выделяются по ставке. У части со ставкой (vat20/vat22)
  // она своя и от дат не зависит: часть 22 % считается по 22 %, когда бы смета ни
  // заводилась. У legacy ставку задаёт дата — по периоду для выполнения, а для
  // договорных колонок периода нет, поэтому берётся действующая на сегодня
  // (vatRateOn(null)): смета — это то, что ещё предстоит выполнить.
  const toNet = vatView === 'net';
  const partVatRate = activePart.vatRate ?? null;
  const contractRate = partVatRate ?? vatRateOn(null);
  const docRateById = new Map(
    docs.map((d) => [d.id, partVatRate ?? vatRateOn(d.periodFrom ?? d.docDate)]),
  );

  const showContract = (amount: string): string =>
    toNet ? netFromGrossRate(amount, contractRate) : amount;
  const showPrice = (price: string): string =>
    toNet ? netPriceFromGrossRate(price, contractRate) : price;
  const showCell = (amount: string, docId: string): string =>
    toNet ? netFromGrossRate(amount, docRateById.get(docId) ?? 0) : amount;

  // выполнение по импортированным КС-2, всегда с НДС — им сверяемся с файлом
  const importedGrossByItem = new Map<string, string>();

  // строки работ с выполнением
  const itemGrid = new Map<string, GridItemRow>();
  for (const it of itemRows) {
    const byPeriod: Record<string, PeriodCell> = {};
    let execQty = dec(0);
    let execAmount = dec(0);
    let importedGross = dec(0);
    const cells = cellByItem.get(it.id);
    if (cells) {
      for (const [docId, cell] of cells) {
        const shown = { qty: cell.qty, amount: showCell(cell.amount, docId) };
        byPeriod[docId] = shown;
        if (approvedIds.has(docId)) {
          execQty = execQty.add(dec(cell.qty));
          execAmount = execAmount.add(dec(shown.amount));
        }
        if (importedIds.has(docId)) importedGross = importedGross.add(dec(cell.amount));
      }
    }
    importedGrossByItem.set(it.id, importedGross.toFixed(2));
    const contractTotal = showContract(it.contractTotal);
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
      unitPrice: showPrice(it.unitPrice),
      unitPriceGross: it.unitPrice,
      materialUnitCost: it.materialUnitCost && showPrice(it.materialUnitCost),
      workUnitCost: it.workUnitCost && showPrice(it.workUnitCost),
      contractTotal,
      sortOrder: it.sortOrder,
      executedQty: execQty.toFixed(6),
      executedAmount: execAmount.toFixed(2),
      remainderQty: dec(it.contractQty).sub(execQty).toFixed(6),
      remainderAmount: dec(contractTotal).sub(execAmount).toFixed(2),
      byPeriod,
      // сверки — на суммах как в БД и в файле, то есть с НДС: расхождение с исходным
      // Excel не зависит от того, в каком режиме сейчас смотрят таблицу
      totalMismatch:
        dec(it.contractQty).isZero() || dec(it.unitPrice).isZero()
          ? null
          : mismatch(it.contractTotal, lineAmount(it.contractQty, it.unitPrice)),
      fileExecutedTotal: it.fileExecutedTotal,
      executedMismatch:
        importedIds.size === 0 ? null : mismatch(importedGross.toFixed(2), it.fileExecutedTotal),
    });
  }

  // агрегат КВР = сумма его номенклатур (стоимости; договорные значения — из файла)
  for (const it of itemRows) {
    if (it.kind !== 'kvr') continue;
    const kvr = itemGrid.get(it.id)!;
    const children = itemRows.filter((c) => c.kvrItemId === it.id && c.kind === 'nomenclature');
    let execAmount = dec(0);
    let importedGross = dec(0);
    const byPeriod: Record<string, PeriodCell> = {};
    for (const child of children) {
      const row = itemGrid.get(child.id)!;
      execAmount = execAmount.add(dec(row.executedAmount));
      importedGross = importedGross.add(dec(importedGrossByItem.get(child.id) ?? '0'));
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
    // выполнение КВР портал складывает из номенклатур — сверяем с файлом уже эту сумму
    kvr.executedMismatch =
      importedIds.size === 0 ? null : mismatch(importedGross.toFixed(2), kvr.fileExecutedTotal);
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
      contractTotal: (a?.contractTotal ?? dec(0)).toFixed(2),
      executedAmount: (a?.executed ?? dec(0)).toFixed(2),
      remainderAmount: (a?.contractTotal ?? dec(0)).sub(a?.executed ?? dec(0)).toFixed(2),
      byPeriod,
    };
  });

  // порядок строк: сквозной sort_order по части сметы
  const rows: GridRow[] = [...sectionGrid, ...itemGrid.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  // итоги
  const nomRows = [...itemGrid.values()].filter((r) => r.kind === 'nomenclature');
  const nomSource = itemRows.filter((it) => it.kind === 'nomenclature');
  const contractTotal = sumStrings(nomRows.map((r) => r.contractTotal));
  const executedAmount = sumStrings(nomRows.map((r) => r.executedAmount));
  const byPeriodTotals: Record<string, string> = {};
  // валовые суммы колонок нужны и в режиме «без НДС»: по ним живут выделение НДС,
  // сумма документа в панели КС-2 и сверка с контрольной колонкой файла
  const byPeriodGross: Record<string, string> = {};
  for (const doc of docs) {
    byPeriodTotals[doc.id] = sumStrings(nomRows.map((r) => r.byPeriod[doc.id]?.amount));
    byPeriodGross[doc.id] = toNet
      ? sumStrings(
          nomSource.map((it) => cellByItem.get(it.id)?.get(doc.id)?.amount),
        )
      : byPeriodTotals[doc.id]!;
  }

  // Ставка документа — ставка части, а у legacy по дате периода (20 % до 31.12.2025,
  // 22 % с 01.01.2026).
  const rateOfDoc = (d: (typeof docs)[number]) =>
    docRateById.get(d.id) ?? vatRateOn(d.periodFrom ?? d.docDate ?? null);

  const periods: PeriodInfo[] = docs.map((d) => {
    const gross = byPeriodGross[d.id] ?? '0.00';
    const vat = vatFromGrossRate(gross, rateOfDoc(d));
    return {
      id: d.id,
      number: d.number,
      docDate: d.docDate,
      periodFrom: d.periodFrom,
      periodTo: d.periodTo,
      status: d.status,
      source: d.source,
      importLabel: d.importLabel,
      totalAmount: gross,
      vatRate: rateOfDoc(d),
      vatAmount: vat,
      netAmount: sub(gross, vat),
    };
  });

  // НДС итогов — сумма построчных, а не выделение от итога: только так «без НДС»
  // по строкам складывается в «без НДС» по документу до копейки
  const vatContract = sumStrings(
    nomSource.map((it) => vatFromGrossRate(it.contractTotal, contractRate)),
  );
  const vatExecuted = sumStrings(
    docs
      .filter((d) => approvedIds.has(d.id))
      .map((d) => vatFromGrossRate(byPeriodGross[d.id] ?? '0', rateOfDoc(d))),
  );

  // сверка с контрольными суммами последнего применённого импорта — своими у части
  const contractTotalGross = toNet
    ? sumStrings(nomSource.map((it) => it.contractTotal))
    : contractTotal;
  const importedExecutedGross = sumStrings(
    nomSource.map((it) => importedGrossByItem.get(it.id)),
  );
  const [fileImport] = activePart.fileTotalsImportId
    ? await db
        .select({ originalName: importFiles.originalName, updatedAt: importFiles.updatedAt })
        .from(importFiles)
        .where(eq(importFiles.id, activePart.fileTotalsImportId))
    : [];

  return {
    availableParts,
    activePart,
    periods,
    rows,
    totals: {
      contractTotal,
      executedAmount,
      remainderAmount: dec(contractTotal).sub(dec(executedAmount)).toFixed(2),
      vatView,
      vatContract,
      vatExecuted,
      vatRateContract: contractRate,
      byPeriod: byPeriodTotals,
      fileContractTotal: activePart.fileContractTotal,
      contractMismatch: mismatch(contractTotalGross, activePart.fileContractTotal),
      fileExecutedTotal: activePart.fileExecutedTotal,
      executedMismatch:
        importedIds.size === 0
          ? null
          : mismatch(importedExecutedGross, activePart.fileExecutedTotal),
      fileTotalsSource: fileImport
        ? { fileName: fileImport.originalName, appliedAt: fileImport.updatedAt.toISOString() }
        : null,
    },
  };
}
