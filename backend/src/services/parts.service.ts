import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { estimateParts, workItems } from '../db/schema/index.js';
import { ApiError } from '../lib/errors.js';
import {
  PART_TITLE,
  partRate,
  partSortOrder,
  type PartCode,
} from '../lib/estimate-parts.js';

export interface PartInfo {
  id: string;
  code: PartCode;
  title: string;
  /** ставка части; null у legacy — там ставка по дате */
  vatRate: number | null;
  fileContractTotal: string | null;
  fileExecutedTotal: string | null;
  fileTotalsImportId: string | null;
}

function toInfo(p: typeof estimateParts.$inferSelect): PartInfo {
  return {
    id: p.id,
    code: p.code,
    title: PART_TITLE[p.code],
    vatRate: p.vatRate === null ? null : Number(p.vatRate),
    fileContractTotal: p.fileContractTotal,
    fileExecutedTotal: p.fileExecutedTotal,
    fileTotalsImportId: p.fileTotalsImportId,
  };
}

/** Все части договора в порядке вкладок. */
export async function listParts(db: Db | Tx, contractId: string): Promise<PartInfo[]> {
  const rows = await db
    .select()
    .from(estimateParts)
    .where(eq(estimateParts.contractId, contractId))
    .orderBy(asc(estimateParts.sortOrder));
  return rows.map(toInfo);
}

/** Часть по коду; null — если её ещё нет. */
export async function findPart(
  db: Db | Tx,
  contractId: string,
  code: PartCode,
): Promise<PartInfo | null> {
  const [row] = await db
    .select()
    .from(estimateParts)
    .where(and(eq(estimateParts.contractId, contractId), eq(estimateParts.code, code)));
  return row ? toInfo(row) : null;
}

/** Часть по коду, создавая её при необходимости. */
export async function ensurePart(
  db: Db | Tx,
  contractId: string,
  code: PartCode,
): Promise<PartInfo> {
  const existing = await findPart(db, contractId, code);
  if (existing) return existing;
  const [created] = await db
    .insert(estimateParts)
    .values({
      contractId,
      code,
      vatRate: partRate(code)?.toFixed(2) ?? null,
      sortOrder: partSortOrder(code),
    })
    .returning();
  return toInfo(created!);
}

/**
 * Часть, которую открывать по умолчанию: legacy, если она есть, иначе первая
 * вкладка со ставкой. Возвращает null, когда смета вообще не заводилась.
 */
export function defaultPart(parts: PartInfo[]): PartInfo | null {
  return parts.find((p) => p.code === 'legacy') ?? parts[0] ?? null;
}

/** Часть по коду из запроса; без кода — часть по умолчанию. */
export function resolvePart(parts: PartInfo[], code: PartCode | undefined): PartInfo | null {
  if (!code) return defaultPart(parts);
  const found = parts.find((p) => p.code === code);
  if (!found) throw ApiError.notFound(`Часть сметы «${PART_TITLE[code]}» не заведена`);
  return found;
}

/**
 * Есть ли в части хоть одна строка сметы. Нужно, чтобы не смешивать единую смету
 * с разделённой: legacy со строками и vat20/vat22 у одного договора несовместимы —
 * иначе одни и те же работы будут посчитаны и там, и там.
 */
export async function partHasItems(db: Db | Tx, partId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(and(eq(workItems.partId, partId), isNull(workItems.deletedAt)))
    .limit(1);
  return Boolean(row);
}

/** Непустая legacy-смета блокирует переход на две страницы. */
export async function hasNonEmptyLegacy(db: Db | Tx, contractId: string): Promise<boolean> {
  const legacy = await findPart(db, contractId, 'legacy');
  return legacy ? partHasItems(db, legacy.id) : false;
}
