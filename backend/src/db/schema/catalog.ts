import {
  date,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const constructionObjects = pgTable(
  'construction_objects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 5 }).notNull(),
    name: text('name').notNull(),
    address: text('address').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('construction_objects_code_uq').on(t.code)],
);

export const userObjectAssignments = pgTable(
  'user_object_assignments',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    objectId: uuid('object_id')
      .notNull()
      .references(() => constructionObjects.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.objectId] })],
);

export const contracts = pgTable(
  'contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    objectId: uuid('object_id')
      .notNull()
      .references(() => constructionObjects.id),
    number: text('number').notNull(),
    amount: numeric('amount', { precision: 18, scale: 2 }).notNull().default('0'),
    dateSigned: date('date_signed'),
    zosDate: date('zos_date'),
    customerName: text('customer_name').notNull().default(''),
    contractorName: text('contractor_name').notNull().default(''),
    subject: text('subject').notNull().default(''),
    /** gross — цены в договоре с НДС, net — договор без НДС */
    vatMode: text('vat_mode', { enum: ['gross', 'net'] }).notNull().default('gross'),
    // контрольные суммы книги переехали на estimate_parts (миграция 0008): у частей
    // 20 % и 22 % свои листы, а значит и свои «Итого»
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('contracts_object_uq').on(t.objectId)],
);

export const amendments = pgTable(
  'amendments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id),
    number: text('number').notNull(),
    amount: numeric('amount', { precision: 18, scale: 2 }).notNull().default('0'),
    dateSigned: date('date_signed'),
    zosExtensionDate: date('zos_extension_date'),
    note: text('note').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('amendments_contract_number_uq').on(t.contractId, t.number)],
);

export type ConstructionObject = typeof constructionObjects.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type Amendment = typeof amendments.$inferSelect;
