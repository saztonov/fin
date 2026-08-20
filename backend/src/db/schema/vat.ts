import { date, numeric, pgTable } from 'drizzle-orm/pg-core';

/**
 * Ставки НДС по датам: 20% до 31.12.2025, 22% с 01.01.2026.
 * Таблицей, а не константой, чтобы следующая смена ставки была миграцией данных.
 */
export const vatRates = pgTable('vat_rates', {
  effectiveFrom: date('effective_from').primaryKey(),
  rate: numeric('rate', { precision: 5, scale: 2 }).notNull(),
});

export type VatRate = typeof vatRates.$inferSelect;
