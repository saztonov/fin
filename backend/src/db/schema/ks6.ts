import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { estimateParts } from './parts.js';

export const ks6Sections = pgTable(
  'ks6_sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** часть сметы: legacy — единая смета, vat20/vat22 — версии по ставкам */
    partId: uuid('part_id')
      .notNull()
      .references(() => estimateParts.id),
    parentId: uuid('parent_id').references((): AnyPgColumn => ks6Sections.id),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('ks6_sections_part_sort_idx').on(t.partId, t.sortOrder),
    index('ks6_sections_part_idx').on(t.partId),
  ],
);

export const workItems = pgTable(
  'work_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partId: uuid('part_id')
      .notNull()
      .references(() => estimateParts.id),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => ks6Sections.id),
    // subline — строки «в т.ч.» под номенклатурой: хранятся, но в суммы не входят
    kind: text('kind', { enum: ['kvr', 'nomenclature', 'subline'] }).notNull(),
    kvrItemId: uuid('kvr_item_id').references((): AnyPgColumn => workItems.id),
    kvrCode: text('kvr_code').notNull().default(''),
    name: text('name').notNull(),
    characteristic: text('characteristic').notNull().default(''),
    unit: text('unit').notNull().default(''),
    contractQty: numeric('contract_qty', { precision: 15, scale: 6 }).notNull().default('0'),
    // расценка — 6 знаков: в ведомостях она с 4–6 знаками, урезание до копеек
    // ломало бы qty × price при ручном вводе КС-2
    unitPrice: numeric('unit_price', { precision: 18, scale: 6 }).notNull().default('0'),
    materialUnitCost: numeric('material_unit_cost', { precision: 18, scale: 6 }),
    workUnitCost: numeric('work_unit_cost', { precision: 18, scale: 6 }),
    contractTotal: numeric('contract_total', { precision: 18, scale: 2 }).notNull().default('0'),
    /** контрольная графа «Выполнено с нач. ст-ва» из файла импорта — только для сверки */
    fileExecutedTotal: numeric('file_executed_total', { precision: 18, scale: 2 }),
    budgetArticle: text('budget_article').notNull().default(''),
    note: text('note').notNull().default(''),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('work_items_part_sort_idx').on(t.partId, t.sortOrder),
    index('work_items_section_idx').on(t.sectionId),
    index('work_items_kvr_idx').on(t.kvrItemId),
    index('work_items_part_idx').on(t.partId),
    // цель составного FK из ks2_lines: строка выполнения обязана ссылаться
    // на работу своей части
    unique('work_items_id_part_uq').on(t.id, t.partId),
  ],
);

export type Ks6Section = typeof ks6Sections.$inferSelect;
export type WorkItem = typeof workItems.$inferSelect;
