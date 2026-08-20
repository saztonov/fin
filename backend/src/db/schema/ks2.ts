import {
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { contracts } from './catalog.js';
import { workItems } from './ks6.js';
import { users } from './users.js';

export const ks2Documents = pgTable(
  'ks2_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id),
    number: text('number').notNull(),
    docDate: date('doc_date'),
    periodFrom: date('period_from'),
    periodTo: date('period_to'),
    status: text('status', { enum: ['draft', 'approved'] }).notNull().default('draft'),
    source: text('source', { enum: ['manual', 'import'] }).notNull().default('manual'),
    importLabel: text('import_label'),
    createdBy: uuid('created_by').references(() => users.id),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('ks2_documents_number_uq').on(t.contractId, t.number),
    index('ks2_documents_period_idx').on(t.contractId, t.periodFrom),
  ],
);

export const ks2Lines = pgTable(
  'ks2_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ks2DocumentId: uuid('ks2_document_id')
      .notNull()
      .references(() => ks2Documents.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id),
    qty: numeric('qty', { precision: 15, scale: 6 }).notNull().default('0'),
    amount: numeric('amount', { precision: 18, scale: 2 }).notNull().default('0'),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('ks2_lines_doc_item_uq').on(t.ks2DocumentId, t.workItemId),
    index('ks2_lines_work_item_idx').on(t.workItemId),
  ],
);

export type Ks2Document = typeof ks2Documents.$inferSelect;
export type Ks2Line = typeof ks2Lines.$inferSelect;
