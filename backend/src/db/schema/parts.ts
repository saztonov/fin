import { integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { constructionObjects } from './catalog.js';

/** Код части сметы: единая смета либо версия под свою ставку НДС. */
export type PartCode = 'legacy' | 'vat20' | 'vat22';

/**
 * Часть сметы объекта.
 *
 * `legacy` — обычная единая смета (все данные до появления частей): ставка НДС
 * определяется датой. `vat20` / `vat22` — две версии одной сметы под разные ставки:
 * заказчики ведут их отдельными листами книги.
 * Части НЕ складываются — это перекрывающиеся версии, а не слагаемые.
 */
export const estimateParts = pgTable(
  'estimate_parts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    objectId: uuid('object_id')
      .notNull()
      .references(() => constructionObjects.id),
    code: text('code', { enum: ['legacy', 'vat20', 'vat22'] }).notNull(),
    /** ставка части; null только у legacy — там она берётся по дате */
    vatRate: numeric('vat_rate', { precision: 5, scale: 2 }),
    sortOrder: integer('sort_order').notNull().default(0),
    /**
     * Контрольные суммы последнего применённого к этой части файла: «Итого» книги
     * и колонка выполнения с начала строительства. Данными не являются — по ним
     * грид подсвечивает расхождение портала с исходным листом.
     */
    fileContractTotal: numeric('file_contract_total', { precision: 18, scale: 2 }),
    fileExecutedTotal: numeric('file_executed_total', { precision: 18, scale: 2 }),
    // без .references(): FK задан миграцией, а ссылка на importFiles замкнула бы
    // импорт parts ↔ imports в цикл
    fileTotalsImportId: uuid('file_totals_import_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('estimate_parts_uq').on(t.objectId, t.code)],
);

export type EstimatePart = typeof estimateParts.$inferSelect;
