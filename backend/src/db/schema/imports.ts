import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { constructionObjects } from './catalog.js';
import { users } from './users.js';

export const importFiles = pgTable(
  'import_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    objectId: uuid('object_id')
      .notNull()
      .references(() => constructionObjects.id),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    kind: text('kind', { enum: ['psdc', 'ks6'] }).notNull(),
    originalName: text('original_name').notNull(),
    storageKey: text('storage_key').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    mimeDetected: text('mime_detected').notNull().default(''),
    /** лист книги, выбранный пользователем; null — подбирается автоматически */
    sheetName: text('sheet_name'),
    /** общий id двух записей одной книги в режиме «две страницы КС» */
    batchId: uuid('batch_id'),
    /** в какую часть сметы применяется лист; задаёт сервер, не клиент */
    partCode: text('part_code', { enum: ['legacy', 'vat20', 'vat22'] }),
    status: text('status', {
      enum: ['uploaded', 'parsing', 'parsed', 'parse_failed', 'applied', 'discarded'],
    })
      .notNull()
      .default('uploaded'),
    error: text('error'),
    parserVersion: text('parser_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('import_files_object_idx').on(t.objectId, t.createdAt),
    index('import_files_batch_idx').on(t.batchId),
  ],
);

export const importStaging = pgTable(
  'import_staging',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importFileId: uuid('import_file_id')
      .notNull()
      .references(() => importFiles.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').notNull(),
    summary: jsonb('summary').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('import_staging_file_uq').on(t.importFileId)],
);

export type ImportFile = typeof importFiles.$inferSelect;
