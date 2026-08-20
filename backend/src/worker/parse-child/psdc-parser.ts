import { parseSheet } from './ks6-parser.js';
import type { ParsedImport } from './parsed-schema.js';
import type { SheetGrid } from './xlsx-reader.js';

/**
 * Разбор листа ПСДЦ — структура сметы договора без граф выполнения.
 *
 * Отдельного парсера больше нет: ПСДЦ и КС-6 отличаются только наличием блоков
 * периодов, а поиск шапки, словарь граф и классификация строк у них общие.
 */
export function parsePsdc(ws: SheetGrid): ParsedImport {
  return parseSheet(ws, 'psdc');
}
