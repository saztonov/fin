import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  constructionObjects,
  estimateParts,
  ks2Documents,
  ks2Lines,
  ks6Sections,
  workItems,
} from '../db/schema/index.js';
import { writeAudit } from '../lib/audit.js';

export interface ClearEstimateResult {
  sections: number;
  items: number;
  documents: number;
  lines: number;
  parts: number;
}

/**
 * Полная очистка сметы объекта: строки, разделы и вся история КС-2 — физически,
 * без soft delete. Нужна для перезаливки книги «с нуля»: очистка одних только КС-2
 * оставляла строки сметы, и повторный импорт ложился поверх них.
 *
 * КС-2 удаляются вместе со сметой не «заодно», а по необходимости: ks2_lines
 * ссылаются на work_items без ON DELETE CASCADE, и пока выполнение живо, строку
 * сметы удалить нельзя (та же причина, по которой DELETE /work-items/:id отвечает
 * `item_in_use`). Объект и журнал загруженных файлов сохраняются.
 */
export async function clearEstimateByObject(
  db: Db,
  objectId: string,
  userId: string,
): Promise<ClearEstimateResult> {
  const result: ClearEstimateResult = { sections: 0, items: 0, documents: 0, lines: 0, parts: 0 };

  await db.transaction(async (tx) => {
    // блокировка объекта на время очистки: параллельный apply импорта иначе
    // допишет строки в уже опустошённую смету
    await tx.execute(sql`select id from construction_objects where id = ${objectId} for update`);

    const parts = await tx
      .select({ id: estimateParts.id })
      .from(estimateParts)
      .where(eq(estimateParts.objectId, objectId));
    if (parts.length === 0) return;
    const partIds = parts.map((p) => p.id);

    // без фильтра по deletedAt — вычищаем и ранее soft-deleted строки: они не видны
    // повторному импорту, но продолжают держать ссылки и ломать сверки
    const docs = await tx
      .select({ id: ks2Documents.id })
      .from(ks2Documents)
      .where(inArray(ks2Documents.partId, partIds));

    if (docs.length > 0) {
      const removedLines = await tx.delete(ks2Lines).where(
        inArray(
          ks2Lines.ks2DocumentId,
          docs.map((d) => d.id),
        ),
      );
      result.lines = removedLines.rowCount ?? 0;
      const removedDocs = await tx
        .delete(ks2Documents)
        .where(inArray(ks2Documents.partId, partIds));
      result.documents = removedDocs.rowCount ?? 0;
    }

    // work_items.kvr_item_id — самоссылка, одним delete по частям закрывается
    const removedItems = await tx.delete(workItems).where(inArray(workItems.partId, partIds));
    result.items = removedItems.rowCount ?? 0;
    const removedSections = await tx
      .delete(ks6Sections)
      .where(inArray(ks6Sections.partId, partIds));
    result.sections = removedSections.rowCount ?? 0;

    // Части удаляются вместе со сметой: на них висят контрольные суммы книги
    // (снимок последнего импорта), и без сброса грид продолжил бы подсвечивать
    // расхождения с файлом, которого уже нет. Заодно это снимает признак
    // «смета разделена по ставкам» — после очистки можно грузить и одной страницей,
    // и двумя.
    const removedParts = await tx
      .delete(estimateParts)
      .where(eq(estimateParts.objectId, objectId));
    result.parts = removedParts.rowCount ?? 0;

    await tx
      .update(constructionObjects)
      .set({ updatedAt: new Date() })
      .where(eq(constructionObjects.id, objectId));
  });

  await writeAudit(db, {
    action: 'estimate.clear',
    userId,
    entityType: 'object',
    entityId: objectId,
    details: result,
  });
  return result;
}
