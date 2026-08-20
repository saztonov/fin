import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { amendments, contracts } from './catalog.js';

export const ks6Sections = pgTable(
  'ks6_sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id),
    parentId: uuid('parent_id').references((): AnyPgColumn => ks6Sections.id),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull(),
    amendmentId: uuid('amendment_id').references(() => amendments.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('ks6_sections_contract_idx').on(t.contractId, t.sortOrder)],
);

export const workItems = pgTable(
  'work_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => ks6Sections.id),
    kind: text('kind', { enum: ['kvr', 'nomenclature'] }).notNull(),
    kvrItemId: uuid('kvr_item_id').references((): AnyPgColumn => workItems.id),
    kvrCode: text('kvr_code').notNull().default(''),
    name: text('name').notNull(),
    characteristic: text('characteristic').notNull().default(''),
    unit: text('unit').notNull().default(''),
    contractQty: numeric('contract_qty', { precision: 15, scale: 6 }).notNull().default('0'),
    unitPrice: numeric('unit_price', { precision: 18, scale: 2 }).notNull().default('0'),
    materialUnitCost: numeric('material_unit_cost', { precision: 18, scale: 2 }),
    workUnitCost: numeric('work_unit_cost', { precision: 18, scale: 2 }),
    contractTotal: numeric('contract_total', { precision: 18, scale: 2 }).notNull().default('0'),
    budgetArticle: text('budget_article').notNull().default(''),
    note: text('note').notNull().default(''),
    amendmentId: uuid('amendment_id').references(() => amendments.id),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('work_items_contract_idx').on(t.contractId, t.sortOrder),
    index('work_items_section_idx').on(t.sectionId),
    index('work_items_kvr_idx').on(t.kvrItemId),
  ],
);

export type Ks6Section = typeof ks6Sections.$inferSelect;
export type WorkItem = typeof workItems.$inferSelect;
