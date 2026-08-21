import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { ks2Documents, ks2Lines, workItems } from '../db/schema/index.js';
import { writeAudit } from '../lib/audit.js';
import { ApiError } from '../lib/errors.js';
import { lineAmount, roundQty, sumStrings } from '../lib/money.js';

export async function getDocOrThrow(db: Db, docId: string) {
  const [doc] = await db
    .select()
    .from(ks2Documents)
    .where(and(eq(ks2Documents.id, docId), isNull(ks2Documents.deletedAt)));
  if (!doc) throw ApiError.notFound('КС-2 не найден');
  return doc;
}

export async function assertUniqueNumber(
  db: Db,
  contractId: string,
  number: string,
  exceptId?: string,
) {
  const dup = await db
    .select({ id: ks2Documents.id })
    .from(ks2Documents)
    .where(
      and(
        eq(ks2Documents.contractId, contractId),
        eq(ks2Documents.number, number),
        isNull(ks2Documents.deletedAt),
      ),
    );
  if (dup.some((d) => d.id !== exceptId)) {
    throw ApiError.conflict('КС-2 с таким номером уже есть по договору', 'ks2_number_taken');
  }
}

export interface LineInput {
  workItemId: string;
  qty: string;
}

/**
 * Bulk-сохранение строк выполнения черновика.
 * Стоимость = round2(qty × цена договора); qty=0 удаляет строку.
 */
export async function setLines(
  db: Db,
  docId: string,
  lines: LineInput[],
  userId: string,
): Promise<{ saved: number; totalAmount: string }> {
  const doc = await getDocOrThrow(db, docId);
  if (doc.status !== 'draft') {
    throw ApiError.conflict('КС-2 утверждён — редактирование запрещено', 'ks2_approved');
  }
  if (lines.length === 0) return { saved: 0, totalAmount: '0.00' };

  const itemIds = lines.map((l) => l.workItemId);
  const items = await db
    .select({
      id: workItems.id,
      kind: workItems.kind,
      contractId: workItems.contractId,
      unitPrice: workItems.unitPrice,
    })
    .from(workItems)
    .where(and(inArray(workItems.id, itemIds), isNull(workItems.deletedAt)));
  const itemById = new Map(items.map((i) => [i.id, i]));
  for (const line of lines) {
    const item = itemById.get(line.workItemId);
    if (!item || item.contractId !== doc.contractId) {
      throw ApiError.badRequest('Строка работ не принадлежит договору', 'bad_work_item');
    }
    if (item.kind !== 'nomenclature') {
      throw ApiError.badRequest('Выполнение вносится только по номенклатуре', 'kvr_not_editable');
    }
  }

  let saved = 0;
  await db.transaction(async (tx) => {
    for (const line of lines) {
      const item = itemById.get(line.workItemId)!;
      const qty = roundQty(line.qty);
      if (Number(qty) === 0) {
        await tx
          .delete(ks2Lines)
          .where(and(eq(ks2Lines.ks2DocumentId, docId), eq(ks2Lines.workItemId, line.workItemId)));
        continue;
      }
      const amount = lineAmount(qty, item.unitPrice);
      await tx
        .insert(ks2Lines)
        .values({
          ks2DocumentId: docId,
          workItemId: line.workItemId,
          qty,
          amount,
          updatedBy: userId,
        })
        .onConflictDoUpdate({
          target: [ks2Lines.ks2DocumentId, ks2Lines.workItemId],
          set: { qty, amount, updatedBy: userId, updatedAt: new Date() },
        });
      saved += 1;
    }
    await tx
      .update(ks2Documents)
      .set({ updatedAt: new Date() })
      .where(eq(ks2Documents.id, docId));
  });

  const allLines = await db
    .select({ amount: ks2Lines.amount })
    .from(ks2Lines)
    .where(eq(ks2Lines.ks2DocumentId, docId));
  return { saved, totalAmount: sumStrings(allLines.map((l) => l.amount)) };
}

/**
 * Полная очистка КС-2 по договору — физическое удаление документов и строк выполнения.
 * Нужна для перезаливки истории из исправленного Excel: soft delete оставил бы строки
 * ks2_lines, которые блокируют удаление позиций сметы и не видны повторному импорту.
 */
export async function clearByContract(
  db: Db,
  contractId: string,
  userId: string,
): Promise<{ documents: number; lines: number }> {
  // без фильтра по deletedAt — вычищаем и строки ранее soft-deleted документов
  const docs = await db
    .select({ id: ks2Documents.id, number: ks2Documents.number })
    .from(ks2Documents)
    .where(eq(ks2Documents.contractId, contractId));
  if (docs.length === 0) return { documents: 0, lines: 0 };

  const ids = docs.map((d) => d.id);
  let lines = 0;
  await db.transaction(async (tx) => {
    const removed = await tx.delete(ks2Lines).where(inArray(ks2Lines.ks2DocumentId, ids));
    lines = removed.rowCount ?? 0;
    await tx.delete(ks2Documents).where(eq(ks2Documents.contractId, contractId));
  });

  await writeAudit(db, {
    action: 'ks2.clear',
    userId,
    entityType: 'contract',
    entityId: contractId,
    details: { documents: docs.length, lines, numbers: docs.map((d) => d.number) },
  });
  return { documents: docs.length, lines };
}

export async function approve(db: Db, docId: string, userId: string) {
  const doc = await getDocOrThrow(db, docId);
  if (doc.status === 'approved') {
    throw ApiError.conflict('КС-2 уже утверждён', 'already_approved');
  }
  const [updated] = await db
    .update(ks2Documents)
    .set({ status: 'approved', approvedBy: userId, approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(ks2Documents.id, docId))
    .returning();
  await writeAudit(db, {
    action: 'ks2.approve',
    userId,
    entityType: 'ks2',
    entityId: docId,
    details: { number: doc.number },
  });
  return updated;
}

export async function returnToDraft(db: Db, docId: string, userId: string) {
  const doc = await getDocOrThrow(db, docId);
  if (doc.status === 'draft') {
    throw ApiError.conflict('КС-2 уже в статусе черновика', 'already_draft');
  }
  const [updated] = await db
    .update(ks2Documents)
    .set({ status: 'draft', approvedBy: null, approvedAt: null, updatedAt: new Date() })
    .where(eq(ks2Documents.id, docId))
    .returning();
  await writeAudit(db, {
    action: 'ks2.return',
    userId,
    entityType: 'ks2',
    entityId: docId,
    details: { number: doc.number },
  });
  return updated;
}
