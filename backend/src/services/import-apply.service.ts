import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  amendments,
  contracts,
  importFiles,
  importStaging,
  ks2Documents,
  ks2Lines,
  ks6Sections,
  workItems,
} from '../db/schema/index.js';
import { writeAudit } from '../lib/audit.js';
import { ApiError } from '../lib/errors.js';
import { dec, sumStrings } from '../lib/money.js';
import { TOTALS_EPS, type ParsedImport, type ParsedItem } from '../worker/parse-child/parsed-schema.js';

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function itemKey(i: { kvrCode: string; name: string; unit: string; kind: string }): string {
  return `${i.kind}|${norm(i.kvrCode)}|${norm(i.name)}|${norm(i.unit)}`;
}

export type ItemDiffStatus = 'new' | 'match' | 'changed' | 'missing';

export interface ItemDiff {
  status: ItemDiffStatus;
  staged?: ParsedItem;
  existingId?: string;
  existingName?: string;
  changes?: { field: string; from: string; to: string }[];
}

export interface Ks2ColumnDiff {
  index: number;
  label: string | null;
  number: string | null;
  monthDate: string | null;
  docDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  cellCount: number;
  totalAmount: string;
  existingDocId: string | null;
  existingDocStatus: string | null;
}

export interface ImportPreview {
  importFileId: string;
  kind: 'psdc' | 'ks6';
  header: ParsedImport['header'];
  sections: { tmpId: string; parentTmpId: string | null; name: string; level: number; exists: boolean }[];
  items: ItemDiff[];
  ks2Columns: Ks2ColumnDiff[];
  counts: { new: number; match: number; changed: number; missing: number };
  controls: ParsedImport['controls'] & {
    computedContractTotal: string;
    computedExecutedTotal: string;
    executedMismatch: string | null;
  };
  warnings: string[];
  structureEmpty: boolean;
  amendmentRequired: boolean;
}

async function loadStaging(db: Db, importFileId: string) {
  const [file] = await db.select().from(importFiles).where(eq(importFiles.id, importFileId));
  if (!file) throw ApiError.notFound('Файл импорта не найден');
  if (file.status !== 'parsed' && file.status !== 'applied') {
    throw ApiError.conflict(`Файл в статусе «${file.status}» — предпросмотр недоступен`, 'not_parsed');
  }
  const [staging] = await db
    .select()
    .from(importStaging)
    .where(eq(importStaging.importFileId, importFileId));
  if (!staging) throw ApiError.notFound('Результат разбора не найден');
  return { file, parsed: staging.payload as ParsedImport };
}

/** Сопоставление staged-строк с существующими: ключ (kind, код, имя, ед.изм.) + порядковый номер дубля. */
function matchItems(
  staged: ParsedItem[],
  existing: (typeof workItems.$inferSelect)[],
): Map<string, typeof workItems.$inferSelect | null> {
  const byKey = new Map<string, (typeof workItems.$inferSelect)[]>();
  for (const e of existing) {
    const k = itemKey(e);
    const arr = byKey.get(k) ?? [];
    arr.push(e);
    byKey.set(k, arr);
  }
  const used = new Set<string>();
  const result = new Map<string, typeof workItems.$inferSelect | null>();
  const occurrence = new Map<string, number>();
  for (const s of staged) {
    const k = itemKey(s);
    const idx = occurrence.get(k) ?? 0;
    occurrence.set(k, idx + 1);
    const candidates = (byKey.get(k) ?? []).filter((c) => !used.has(c.id));
    const chosen = candidates[0] ?? null;
    if (chosen) used.add(chosen.id);
    result.set(s.tmpId, chosen);
  }
  return result;
}

export async function buildPreview(db: Db, importFileId: string): Promise<ImportPreview> {
  const { file, parsed } = await loadStaging(db, importFileId);

  const [existingItems, existingSections, existingDocs] = await Promise.all([
    db
      .select()
      .from(workItems)
      .where(and(eq(workItems.contractId, file.contractId), isNull(workItems.deletedAt)))
      .orderBy(asc(workItems.sortOrder)),
    db
      .select()
      .from(ks6Sections)
      .where(and(eq(ks6Sections.contractId, file.contractId), isNull(ks6Sections.deletedAt))),
    db
      .select()
      .from(ks2Documents)
      .where(and(eq(ks2Documents.contractId, file.contractId), isNull(ks2Documents.deletedAt))),
  ]);

  const matched = matchItems(parsed.items, existingItems);
  const items: ItemDiff[] = [];
  const counts = { new: 0, match: 0, changed: 0, missing: 0 };

  for (const s of parsed.items) {
    const ex = matched.get(s.tmpId);
    if (!ex) {
      counts.new += 1;
      items.push({ status: 'new', staged: s });
      continue;
    }
    const changes: { field: string; from: string; to: string }[] = [];
    if (!dec(ex.contractQty).eq(dec(s.contractQty))) {
      changes.push({ field: 'contractQty', from: ex.contractQty, to: s.contractQty });
    }
    if (!dec(ex.unitPrice).eq(dec(s.unitPrice))) {
      changes.push({ field: 'unitPrice', from: ex.unitPrice, to: s.unitPrice });
    }
    if (!dec(ex.contractTotal).eq(dec(s.contractTotal))) {
      changes.push({ field: 'contractTotal', from: ex.contractTotal, to: s.contractTotal });
    }
    if (changes.length > 0) {
      counts.changed += 1;
      items.push({ status: 'changed', staged: s, existingId: ex.id, changes });
    } else {
      counts.match += 1;
      items.push({ status: 'match', staged: s, existingId: ex.id });
    }
  }
  const matchedIds = new Set([...matched.values()].filter(Boolean).map((e) => e!.id));
  for (const ex of existingItems) {
    if (!matchedIds.has(ex.id)) {
      counts.missing += 1;
      items.push({ status: 'missing', existingId: ex.id, existingName: ex.name });
    }
  }

  const existingSectionKeys = new Set(existingSections.map((s) => norm(s.name)));
  const sections = parsed.sections.map((s) => ({
    tmpId: s.tmpId,
    parentTmpId: s.parentTmpId,
    name: s.name,
    level: s.level,
    exists: existingSectionKeys.has(norm(s.name)),
  }));

  const docByNumber = new Map(existingDocs.map((d) => [norm(d.number), d]));
  const ks2Columns: Ks2ColumnDiff[] = parsed.ks2Columns.map((c) => {
    const ex = c.number ? docByNumber.get(norm(c.number)) : undefined;
    return {
      index: c.index,
      label: c.label,
      number: c.number,
      monthDate: c.monthDate,
      docDate: c.docDate,
      periodFrom: c.periodFrom,
      periodTo: c.periodTo,
      cellCount: c.cells.length,
      totalAmount: sumStrings(c.cells.map((cell) => cell.amount)),
      existingDocId: ex?.id ?? null,
      existingDocStatus: ex?.status ?? null,
    };
  });

  const computedContractTotal = sumStrings(
    parsed.items.filter((i) => i.kind === 'nomenclature').map((i) => i.contractTotal),
  );
  const computedExecutedTotal = sumStrings(
    parsed.ks2Columns.flatMap((c) => c.cells.map((cell) => cell.amount)),
  );
  // расхождение с «Итого» файла сообщает сам парсер (оно уже в parsed.warnings) —
  // здесь только сверка помесячных с контрольной колонкой «Выполнение с нач. ст-ва»
  const warnings = [...parsed.warnings];
  let executedMismatch: string | null = null;
  if (parsed.controls.executedTotal) {
    const diff = dec(computedExecutedTotal).sub(dec(parsed.controls.executedTotal));
    if (diff.abs().gt(TOTALS_EPS)) {
      executedMismatch = diff.toFixed(2);
      warnings.push(
        `Сумма помесячных выполнений (${computedExecutedTotal}) отличается от контрольной колонки файла «Выполнение с нач. ст-ва» (${parsed.controls.executedTotal}) на ${executedMismatch} руб. — внутренняя неувязка исходного Excel; источником истины приняты помесячные суммы`,
      );
    }
  }

  const structureEmpty = existingItems.length === 0;
  return {
    importFileId,
    kind: parsed.kind,
    header: parsed.header,
    sections,
    items,
    ks2Columns,
    counts,
    controls: {
      ...parsed.controls,
      computedContractTotal,
      computedExecutedTotal,
      executedMismatch,
    },
    warnings,
    structureEmpty,
    amendmentRequired: !structureEmpty && counts.new > 0,
  };
}

export interface ApplyOptions {
  /** ДС, которым добавляются новые строки в непустой договор */
  amendmentId?: string | null;
  /** применять изменения договорных значений по совпавшим строкам */
  applyChanged: boolean;
  /** импортировать историю помесячных выполнений (только kind=ks6) */
  importHistory: boolean;
  /** перезаписывать строки существующих КС-2 с совпавшим номером */
  overwriteKs2: boolean;
  /** импортированные КС-2 сразу утверждены (история — свершившийся факт) */
  approveImported: boolean;
  /** уточнения периодов по колонкам: index → реквизиты */
  periods: { index: number; number: string; periodFrom?: string | null; periodTo?: string | null; docDate?: string | null }[];
}

export interface ApplyResult {
  sectionsCreated: number;
  itemsCreated: number;
  itemsUpdated: number;
  ks2Created: number;
  ks2Overwritten: number;
  ks2Skipped: number;
  linesCreated: number;
}

function monthBounds(iso: string): { from: string; to: string } {
  const [y, m] = iso.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

export async function applyImport(
  db: Db,
  importFileId: string,
  options: ApplyOptions,
  userId: string,
): Promise<ApplyResult> {
  const { file, parsed } = await loadStaging(db, importFileId);
  if (file.status === 'applied') {
    throw ApiError.conflict('Импорт уже применён', 'already_applied');
  }

  const preview = await buildPreview(db, importFileId);
  if (preview.amendmentRequired && !options.amendmentId) {
    throw ApiError.badRequest(
      'В договоре уже есть строки: для новых строк выберите дополнительное соглашение',
      'amendment_required',
    );
  }
  if (options.amendmentId) {
    const [am] = await db
      .select({ id: amendments.id, contractId: amendments.contractId })
      .from(amendments)
      .where(and(eq(amendments.id, options.amendmentId), isNull(amendments.deletedAt)));
    if (!am || am.contractId !== file.contractId) {
      throw ApiError.badRequest('ДС не найдено или относится к другому договору', 'bad_amendment');
    }
  }

  const periodOverrides = new Map(options.periods.map((p) => [p.index, p]));
  if (options.importHistory) {
    for (const col of parsed.ks2Columns) {
      const number = periodOverrides.get(col.index)?.number ?? col.number;
      if (!number) {
        throw ApiError.badRequest(
          `Колонке выполнения №${col.index + 1} (${col.label ?? 'без подписи'}) не задан номер КС-2`,
          'period_number_required',
        );
      }
    }
  }

  const [existingItems, existingSections, existingDocs] = await Promise.all([
    db
      .select()
      .from(workItems)
      .where(and(eq(workItems.contractId, file.contractId), isNull(workItems.deletedAt)))
      .orderBy(asc(workItems.sortOrder)),
    db
      .select()
      .from(ks6Sections)
      .where(and(eq(ks6Sections.contractId, file.contractId), isNull(ks6Sections.deletedAt))),
    db
      .select()
      .from(ks2Documents)
      .where(and(eq(ks2Documents.contractId, file.contractId), isNull(ks2Documents.deletedAt))),
  ]);

  const matched = matchItems(parsed.items, existingItems);
  const structureEmpty = existingItems.length === 0;
  const amendmentForNew = structureEmpty ? null : (options.amendmentId ?? null);

  const result: ApplyResult = {
    sectionsCreated: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    ks2Created: 0,
    ks2Overwritten: 0,
    ks2Skipped: 0,
    linesCreated: 0,
  };

  await db.transaction(async (tx) => {
    // --- разделы ---
    const sectionIdByTmp = new Map<string, string>();
    const existingSectionByName = new Map(existingSections.map((s) => [norm(s.name), s.id]));
    let sortCounter =
      Math.max(
        0,
        ...existingItems.map((i) => i.sortOrder),
        ...existingSections.map((s) => s.sortOrder),
      ) + 10;

    // порядок строк файла: разделы и работы по rowNumber
    const orderedRows = [
      ...parsed.sections.map((s) => ({ kind: 'section' as const, row: s.rowNumber, s })),
      ...parsed.items.map((i) => ({ kind: 'item' as const, row: i.rowNumber, i })),
    ].sort((a, b) => a.row - b.row);

    const itemIdByTmp = new Map<string, string>();

    for (const entry of orderedRows) {
      if (entry.kind === 'section') {
        const s = entry.s;
        const existingId = existingSectionByName.get(norm(s.name));
        if (existingId) {
          sectionIdByTmp.set(s.tmpId, existingId);
          continue;
        }
        const parentId = s.parentTmpId ? (sectionIdByTmp.get(s.parentTmpId) ?? null) : null;
        const [created] = await tx
          .insert(ks6Sections)
          .values({
            contractId: file.contractId,
            parentId,
            name: s.name,
            sortOrder: structureEmpty ? s.rowNumber * 10 : (sortCounter += 10),
            amendmentId: amendmentForNew,
          })
          .returning({ id: ks6Sections.id });
        sectionIdByTmp.set(s.tmpId, created!.id);
        result.sectionsCreated += 1;
        continue;
      }

      const s = entry.i;
      const ex = matched.get(s.tmpId);
      if (ex) {
        itemIdByTmp.set(s.tmpId, ex.id);
        if (options.applyChanged) {
          const needUpdate =
            !dec(ex.contractQty).eq(dec(s.contractQty)) ||
            !dec(ex.unitPrice).eq(dec(s.unitPrice)) ||
            !dec(ex.contractTotal).eq(dec(s.contractTotal));
          if (needUpdate) {
            await tx
              .update(workItems)
              .set({
                contractQty: s.contractQty,
                unitPrice: s.unitPrice,
                materialUnitCost: s.materialUnitCost,
                workUnitCost: s.workUnitCost,
                contractTotal: s.contractTotal,
                fileExecutedTotal: s.fileExecutedTotal,
                updatedAt: new Date(),
              })
              .where(eq(workItems.id, ex.id));
            result.itemsUpdated += 1;
          }
        }
        continue;
      }
      const sectionId = sectionIdByTmp.get(s.sectionTmpId);
      if (!sectionId) {
        throw ApiError.badRequest(
          `Строка «${s.name.slice(0, 60)}»: раздел не сопоставлен`,
          'section_unresolved',
        );
      }
      const [created] = await tx
        .insert(workItems)
        .values({
          contractId: file.contractId,
          sectionId,
          kind: s.kind,
          kvrItemId: s.kvrTmpId ? (itemIdByTmp.get(s.kvrTmpId) ?? null) : null,
          kvrCode: s.kvrCode,
          name: s.name,
          characteristic: s.characteristic,
          unit: s.unit,
          contractQty: s.contractQty,
          unitPrice: s.unitPrice,
          materialUnitCost: s.materialUnitCost,
          workUnitCost: s.workUnitCost,
          contractTotal: s.contractTotal,
          fileExecutedTotal: s.fileExecutedTotal,
          budgetArticle: s.budgetArticle,
          amendmentId: amendmentForNew,
          sortOrder: structureEmpty ? s.rowNumber * 10 : (sortCounter += 10),
        })
        .returning({ id: workItems.id });
      itemIdByTmp.set(s.tmpId, created!.id);
      result.itemsCreated += 1;
    }

    // --- история КС-2 ---
    if (options.importHistory && parsed.kind === 'ks6') {
      const docByNumber = new Map(existingDocs.map((d) => [norm(d.number), d]));
      for (const col of parsed.ks2Columns) {
        const override = periodOverrides.get(col.index);
        const number = override?.number ?? col.number!;
        let periodFrom = override?.periodFrom ?? col.periodFrom;
        let periodTo = override?.periodTo ?? col.periodTo;
        if (!periodFrom && col.monthDate) {
          const b = monthBounds(col.monthDate);
          periodFrom = b.from;
          periodTo = periodTo ?? b.to;
        }
        const docDate = override?.docDate ?? col.docDate;

        const existing = docByNumber.get(norm(number));
        let docId: string;
        if (existing) {
          if (!options.overwriteKs2) {
            result.ks2Skipped += 1;
            continue;
          }
          docId = existing.id;
          await tx.delete(ks2Lines).where(eq(ks2Lines.ks2DocumentId, docId));
          await tx
            .update(ks2Documents)
            .set({
              docDate: docDate ?? existing.docDate,
              periodFrom: periodFrom ?? existing.periodFrom,
              periodTo: periodTo ?? existing.periodTo,
              importLabel: col.label,
              source: 'import',
              updatedAt: new Date(),
            })
            .where(eq(ks2Documents.id, docId));
          result.ks2Overwritten += 1;
        } else {
          const [created] = await tx
            .insert(ks2Documents)
            .values({
              contractId: file.contractId,
              number,
              docDate: docDate ?? null,
              periodFrom: periodFrom ?? null,
              periodTo: periodTo ?? null,
              status: options.approveImported ? 'approved' : 'draft',
              source: 'import',
              importLabel: col.label,
              createdBy: userId,
              approvedBy: options.approveImported ? userId : null,
              approvedAt: options.approveImported ? new Date() : null,
            })
            .returning({ id: ks2Documents.id });
          docId = created!.id;
          result.ks2Created += 1;
        }

        for (const cell of col.cells) {
          const workItemId = itemIdByTmp.get(cell.itemTmpId);
          if (!workItemId) continue;
          await tx
            .insert(ks2Lines)
            .values({
              ks2DocumentId: docId,
              workItemId,
              qty: cell.qty,
              // суммы истории — как в файле, не пересчитываем qty×price
              amount: cell.amount,
              updatedBy: userId,
            })
            .onConflictDoUpdate({
              target: [ks2Lines.ks2DocumentId, ks2Lines.workItemId],
              set: { qty: cell.qty, amount: cell.amount, updatedBy: userId, updatedAt: new Date() },
            });
          result.linesCreated += 1;
        }
      }
    }

    // снимок контрольных сумм книги: по ним грид КС-6 показывает расхождение
    // портала с исходным Excel уже после применения импорта
    if (parsed.controls.contractTotal || parsed.controls.executedTotal) {
      await tx
        .update(contracts)
        .set({
          fileContractTotal: parsed.controls.contractTotal,
          fileExecutedTotal: parsed.controls.executedTotal,
          fileTotalsImportId: importFileId,
          updatedAt: new Date(),
        })
        .where(eq(contracts.id, file.contractId));
    }

    await tx
      .update(importFiles)
      .set({ status: 'applied', updatedAt: new Date() })
      .where(eq(importFiles.id, importFileId));
  });

  await writeAudit(db, {
    action: 'import.apply',
    userId,
    entityType: 'import',
    entityId: importFileId,
    details: { options: { ...options, periods: options.periods.length }, result },
  });

  return result;
}
