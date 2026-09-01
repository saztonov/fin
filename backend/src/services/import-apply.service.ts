import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import {
  estimateParts,
  importFiles,
  importStaging,
  ks2Documents,
  ks2Lines,
  ks6Sections,
  workItems,
} from '../db/schema/index.js';
import { writeAudit } from '../lib/audit.js';
import { ApiError } from '../lib/errors.js';
import { baseYearOfPart, partRate, periodFitsPart, type PartCode } from '../lib/estimate-parts.js';
import {
  dec,
  grossFromNetRate,
  grossPriceFromNetRate,
  sumStrings,
  vatRateOn,
} from '../lib/money.js';
import { ensurePart, findPart } from './parts.service.js';
import { monthIndexOf } from '../worker/parse-child/header-dictionary.js';
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
  /** итог файла по графе этого периода — эталон для сверки; null, если его нет */
  fileTotal: string | null;
  /** Σ строк минус итог файла; null — сверять не с чем или сходится в копейку */
  mismatch: string | null;
  /** период вне границ ставки этой вкладки — при применении будет пропущен */
  outOfPart: boolean;
  existingDocId: string | null;
  existingDocStatus: string | null;
}

export interface ImportPreview {
  importFileId: string;
  /** часть сметы, в которую применится файл */
  partCode: PartCode;
  kind: 'psdc' | 'ks6';
  sections: { tmpId: string; parentTmpId: string | null; name: string; level: number; exists: boolean }[];
  items: ItemDiff[];
  ks2Columns: Ks2ColumnDiff[];
  /** распознанная база сумм книги — предзаполнение переключателя в предпросмотре */
  vat: ParsedImport['vat'];
  counts: { new: number; match: number; changed: number; missing: number };
  controls: ParsedImport['controls'] & {
    computedContractTotal: string;
    computedExecutedTotal: string;
    executedMismatch: string | null;
  };
  warnings: string[];
  structureEmpty: boolean;
}

async function loadStaging(db: Db | Tx, importFileId: string) {
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

/**
 * Часть, в которую применяется файл. Код задаёт сервер при загрузке
 * (`import_files.part_code`), клиент его не присылает: подделка параметра
 * смешала бы ставки 20 % и 22 % в одной смете.
 */
function fileePartCode(file: typeof importFiles.$inferSelect): PartCode {
  return file.partCode ?? 'legacy';
}

/**
 * Существующее содержимое ТОЙ ЖЕ части. Сопоставление обязано идти внутри своей
 * части: у листов 20 % и 22 % совпадает большинство номенклатур, и без фильтра
 * строки второго листа нашли бы «совпадения» в первом и стали бы «изменёнными»
 * вместо новых.
 */
async function loadExistingForPart(db: Db | Tx, partId: string | null) {
  if (!partId) return { existingItems: [], existingSections: [], existingDocs: [] };
  const [existingItems, existingSections, existingDocs] = await Promise.all([
    db
      .select()
      .from(workItems)
      .where(and(eq(workItems.partId, partId), isNull(workItems.deletedAt)))
      .orderBy(asc(workItems.sortOrder)),
    db
      .select()
      .from(ks6Sections)
      .where(and(eq(ks6Sections.partId, partId), isNull(ks6Sections.deletedAt))),
    db
      .select()
      .from(ks2Documents)
      .where(and(eq(ks2Documents.partId, partId), isNull(ks2Documents.deletedAt))),
  ]);
  return { existingItems, existingSections, existingDocs };
}

export async function buildPreview(db: Db, importFileId: string): Promise<ImportPreview> {
  const { file, parsed } = await loadStaging(db, importFileId);

  const partCode = fileePartCode(file);
  const part = await findPart(db, file.objectId, partCode);
  const { existingItems, existingSections, existingDocs } = await loadExistingForPart(
    db,
    part?.id ?? null,
  );

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
    const total = sumStrings(c.cells.map((cell) => cell.amount));
    // сверка с итогом файла по этой же графе: расхождение видно поимённо по акту
    const diff = c.fileTotal === null ? null : dec(total).sub(dec(c.fileTotal));
    const mismatch = diff && diff.abs().gt(TOTALS_EPS) ? diff.toFixed(2) : null;
    return {
      index: c.index,
      label: c.label,
      number: c.number,
      monthDate: c.monthDate,
      docDate: c.docDate,
      periodFrom: c.periodFrom,
      periodTo: c.periodTo,
      cellCount: c.cells.length,
      totalAmount: total,
      fileTotal: c.fileTotal,
      mismatch,
      outOfPart: !periodFitsPart(partCode, c.periodFrom, c.periodTo),
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

  // непустота считается по СВОЕЙ части: у второго листа книги свой набор строк,
  // и «новыми» они должны считаться относительно него, а не первого листа
  const structureEmpty = existingItems.length === 0;
  return {
    importFileId,
    partCode,
    kind: parsed.kind,
    sections,
    items,
    ks2Columns,
    vat: parsed.vat,
    counts,
    controls: {
      ...parsed.controls,
      computedContractTotal,
      computedExecutedTotal,
      executedMismatch,
    },
    warnings,
    structureEmpty,
  };
}

/**
 * Перевод разобранной книги из сумм без НДС в суммы с НДС на месте.
 *
 * Количества не трогаем — налог на них не начисляется. Контрольные суммы файла
 * пересчитываем тоже: иначе сверка в гриде КС-6 сравнивала бы брутто-данные с
 * нетто-эталоном и показывала расхождение размером ровно в налог.
 */
function grossUpParsed(parsed: ParsedImport, partCode: PartCode): void {
  const fixed = partRate(partCode);
  const rateFor = (onDate?: string | null) => fixed ?? vatRateOn(onDate);
  const rate = rateFor(null);
  const money = (v: string | null, on?: string | null) =>
    v === null ? null : grossFromNetRate(v, rateFor(on));
  const price = (v: string | null) => (v === null ? null : grossPriceFromNetRate(v, rate));

  for (const i of parsed.items) {
    i.unitPrice = price(i.unitPrice)!;
    i.contractTotal = money(i.contractTotal)!;
    i.materialUnitCost = price(i.materialUnitCost);
    i.workUnitCost = price(i.workUnitCost);
    i.fileExecutedTotal = money(i.fileExecutedTotal);
  }
  for (const c of parsed.ks2Columns) {
    // У legacy ставка зависит от даты акта, и брать её надо ровно тем же правилом,
    // каким грид и выгрузки её потом выделяют обратно (periodVatRate — по концу
    // периода). Иначе акт через границу ставок начислялся бы по одной ставке, а
    // разбирался по другой, и режим «без НДС» разъезжался бы с файлом.
    const on = c.periodTo || c.periodFrom || c.monthDate;
    c.fileTotal = money(c.fileTotal, on);
    for (const cell of c.cells) cell.amount = money(cell.amount, on)!;
  }
  parsed.controls.contractTotal = money(parsed.controls.contractTotal);
  parsed.controls.executedTotal = money(parsed.controls.executedTotal);
  parsed.vat = { rate, mode: 'gross' };
}

export interface ApplyOptions {
  /** применять изменения договорных значений по совпавшим строкам */
  applyChanged: boolean;
  /** импортировать историю помесячных выполнений (только kind=ks6) */
  importHistory: boolean;
  /** перезаписывать строки существующих КС-2 с совпавшим номером */
  overwriteKs2: boolean;
  /** импортированные КС-2 сразу утверждены (история — свершившийся факт) */
  approveImported: boolean;
  /**
   * База сумм в файле. `net` — книга дана без НДС (графы «Стоимость без НДС»),
   * и суммы приводятся к с НДС по ставке вкладки: портал везде ведёт учёт с НДС.
   * `gross` — оставить как есть. Значение подтверждает человек в предпросмотре,
   * предзаполнено распознанным `parsed.vat.mode`.
   */
  vatMode: 'gross' | 'net';
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
  /** колонки книги, чей период не относится к этой вкладке — пропущены */
  ks2OutOfPart: number;
  linesCreated: number;
}

function monthBounds(iso: string): { from: string; to: string } {
  const [y, m] = iso.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

/**
 * Применение одного файла импорта ВНУТРИ уже открытой транзакции.
 *
 * Отдельно от `applyImport` ради режима «две страницы КС»: там оба листа должны
 * лечь одной транзакцией, иначе падение второго оставит применённым первый —
 * половину сметы, которую пользователь не заказывал.
 */
export async function applyImportTx(
  tx: Tx,
  importFileId: string,
  options: ApplyOptions,
  userId: string,
): Promise<ApplyResult> {
  const { file, parsed } = await loadStaging(tx, importFileId);
  if (file.status === 'applied') {
    throw ApiError.conflict('Импорт уже применён', 'already_applied');
  }

  // блокировка объекта на время применения: та же, что берёт очистка сметы
  await tx.execute(sql`select id from construction_objects where id = ${file.objectId} for update`);

  const partCode = fileePartCode(file);
  const part = await ensurePart(tx, file.objectId, partCode);

  const { existingItems, existingSections, existingDocs } = await loadExistingForPart(tx, part.id);
  const structureEmpty = existingItems.length === 0;

  // Книга без НДС приводится к с НДС ОДИН раз здесь, а не в местах записи: так
  // ни одна сумма не может уехать мимо пересчёта, и дальше по коду вид данных
  // ровно один. Ставку берём у вкладки (partRate), для legacy — по дате периода.
  if (options.vatMode === 'net') grossUpParsed(parsed, partCode);

  const periodOverrides = new Map(options.periods.map((p) => [p.index, p]));

  /**
   * Границы периода колонки. Если книга дала только название месяца без года
   * («Январь» на листе «КС6а ндс22%»), год берётся из части: у 22 % он однозначен.
   */
  const columnPeriod = (col: ParsedImport['ks2Columns'][number]) => {
    const override = periodOverrides.get(col.index);
    let month = col.monthDate;
    if (!month && col.label) {
      const idx = monthIndexOf(col.label);
      const year = baseYearOfPart(partCode);
      if (idx !== null && year !== null) {
        month = `${year}-${String(idx + 1).padStart(2, '0')}-01`;
      }
    }
    const bounds = month ? monthBounds(month) : null;
    return {
      from: override?.periodFrom ?? col.periodFrom ?? bounds?.from ?? null,
      to: override?.periodTo ?? col.periodTo ?? bounds?.to ?? null,
      docDate: override?.docDate ?? col.docDate ?? null,
      number: override?.number ?? col.number,
    };
  };

  /**
   * Колонки за пределами своей вкладки пропускаются, а не валят импорт.
   * В реальных книгах лист «по 31.12.2025» содержит ещё и плановый график на годы
   * вперёд (Сторис.xlsx: 36 колонок до мая 2028), а те же месяцы 2026 года уже
   * закрыты на листе 22 %. Импортировать их дважды — прямой задвоенный счёт.
   */
  const outOfPart = new Set<number>();
  if (options.importHistory) {
    for (const col of parsed.ks2Columns) {
      const period = columnPeriod(col);
      if (!periodFitsPart(partCode, period.from, period.to)) {
        outOfPart.add(col.index);
        continue;
      }
      if (!period.number) {
        throw ApiError.badRequest(
          `Колонке выполнения №${col.index + 1} (${col.label ?? 'без подписи'}) не задан номер КС-2`,
          'period_number_required',
        );
      }
    }
  }

  const matched = matchItems(parsed.items, existingItems);

  const result: ApplyResult = {
    sectionsCreated: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    ks2Created: 0,
    ks2Overwritten: 0,
    ks2Skipped: 0,
    ks2OutOfPart: 0,
    linesCreated: 0,
  };

  {
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
            partId: part.id,
            parentId,
            name: s.name,
            sortOrder: structureEmpty ? s.rowNumber * 10 : (sortCounter += 10),
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
          partId: part.id,
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
        if (outOfPart.has(col.index)) {
          result.ks2OutOfPart += 1;
          continue;
        }
        const period = columnPeriod(col);
        const number = period.number!;
        const periodFrom = period.from;
        const periodTo = period.to;
        const docDate = period.docDate;

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
              partId: part.id,
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
              partId: part.id,
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

    // Снимок контрольных сумм книги — на СВОЕЙ части: у листов 20 % и 22 % свои
    // «Итого», и общий на объект снимок второй лист затирал бы первым.
    if (parsed.controls.contractTotal || parsed.controls.executedTotal) {
      await tx
        .update(estimateParts)
        .set({
          fileContractTotal: parsed.controls.contractTotal,
          fileExecutedTotal: parsed.controls.executedTotal,
          fileTotalsImportId: importFileId,
        })
        .where(eq(estimateParts.id, part.id));
    }

    await tx
      .update(importFiles)
      .set({ status: 'applied', updatedAt: new Date() })
      .where(eq(importFiles.id, importFileId));
  }

  return result;
}

/** Применение одного файла импорта своей транзакцией. */
export async function applyImport(
  db: Db,
  importFileId: string,
  options: ApplyOptions,
  userId: string,
): Promise<ApplyResult> {
  const result = await db.transaction((tx) => applyImportTx(tx, importFileId, options, userId));
  await writeAudit(db, {
    action: 'import.apply',
    userId,
    entityType: 'import',
    entityId: importFileId,
    details: { options: { ...options, periods: options.periods.length }, result },
  });
  return result;
}

function addResults(a: ApplyResult, b: ApplyResult): ApplyResult {
  return {
    sectionsCreated: a.sectionsCreated + b.sectionsCreated,
    itemsCreated: a.itemsCreated + b.itemsCreated,
    itemsUpdated: a.itemsUpdated + b.itemsUpdated,
    ks2Created: a.ks2Created + b.ks2Created,
    ks2Overwritten: a.ks2Overwritten + b.ks2Overwritten,
    ks2Skipped: a.ks2Skipped + b.ks2Skipped,
    ks2OutOfPart: a.ks2OutOfPart + b.ks2OutOfPart,
    linesCreated: a.linesCreated + b.linesCreated,
  };
}

/**
 * Применение обеих страниц книги ОДНОЙ транзакцией.
 *
 * Последовательные вызовы `applyImport` тут не годятся: если второй лист упадёт,
 * первый останется применённым, и в портале окажется половина сметы — состояние,
 * которого нет ни в одном файле.
 */
export async function applyImportBatch(
  db: Db,
  batchId: string,
  optionsByImportId: Map<string, ApplyOptions>,
  userId: string,
): Promise<ApplyResult> {
  const files = await db
    .select({ id: importFiles.id, partCode: importFiles.partCode })
    .from(importFiles)
    .where(eq(importFiles.batchId, batchId));
  if (files.length === 0) throw ApiError.notFound('Пара файлов импорта не найдена');

  // порядок вкладок: сначала 20 %, потом 22 % — так номера КС-2 и sort_order
  // ложатся в том же порядке, в каком пользователь их видит
  const ordered = [...files].sort((a, b) => (a.partCode ?? '').localeCompare(b.partCode ?? ''));

  const result = await db.transaction(async (tx) => {
    let acc: ApplyResult = {
      sectionsCreated: 0,
      itemsCreated: 0,
      itemsUpdated: 0,
      ks2Created: 0,
      ks2Overwritten: 0,
      ks2Skipped: 0,
      ks2OutOfPart: 0,
      linesCreated: 0,
    };
    for (const f of ordered) {
      const opts = optionsByImportId.get(f.id);
      if (!opts) throw ApiError.badRequest(`Не заданы параметры применения для листа`, 'bad_batch');
      acc = addResults(acc, await applyImportTx(tx, f.id, opts, userId));
    }
    return acc;
  });

  await writeAudit(db, {
    action: 'import.apply_batch',
    userId,
    entityType: 'import',
    entityId: batchId,
    details: { files: ordered.map((f) => ({ id: f.id, part: f.partCode })), result },
  });
  return result;
}
