import { round2, round6, roundQty } from '../../lib/money.js';
import { SheetGrid, serialToIso } from './xlsx-reader.js';

/** Текст ячейки с учётом объединений (slave отдаёт значение master). */
export function cellText(ws: SheetGrid, row: number, col: number): string {
  const v = ws.get(row, col).value;
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

/** Текст только собственной ячейки, без разворота объединений. */
export function cellTextRaw(ws: SheetGrid, row: number, col: number): string {
  const v = ws.raw(row, col).value;
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

/**
 * Число из ячейки в виде double. Только для эвристик распознавания: вид строки,
 * подбор агрегатов, «есть ли в графе хоть что-нибудь». Для денег и количеств —
 * `cellDecimal`: double теряет копейки.
 */
export function cellNum(ws: SheetGrid, row: number, col: number): number | null {
  const s = cellDecimal(ws, row, col);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Точное десятичное значение ячейки строкой, без промежуточного double.
 * Для числовых ячеек берётся исходный текст из XML, для текстовых — содержимое
 * с отброшенными пробелами/NBSP и запятой вместо точки.
 */
export function cellDecimal(ws: SheetGrid, row: number, col: number): string | null {
  const cell = ws.get(row, col);
  const v = cell.value;
  if (v === null || v === undefined || v === '') return null;
  if (cell.isDate) return null;
  const s = (cell.text || String(v))
    .replace(/[\s  ]/g, '')
    .replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(s) ? s : null;
}

/** ISO-дата из ячейки: датовый формат, русская дата текстом или Excel-серийник. */
export function cellDate(ws: SheetGrid, row: number, col: number): string | null {
  const cell = ws.get(row, col);
  if (cell.isDate && typeof cell.value === 'string') return cell.value;
  if (typeof cell.value === 'string') return parseRuDate(cell.value);
  if (typeof cell.value === 'number') return serialToIso(cell.value);
  return null;
}

/** «11.10.2024 г.» / «07.04.25» → ISO-дата. */
export function parseRuDate(s: string): string | null {
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return null;
  const dd = m[1]!.padStart(2, '0');
  const mm = m[2]!.padStart(2, '0');
  let yy = m[3]!;
  if (yy.length === 2) yy = `20${yy}`;
  const iso = `${yy}-${mm}-${dd}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export function isBold(ws: SheetGrid, row: number, col: number): boolean {
  return ws.raw(row, col).bold;
}

/**
 * Деньги к строке: ровно копейка, half-up как в Excel. Считает decimal.js из
 * `lib/money.ts` — `number.toFixed(2)` здесь не годится, он округляет по
 * представимости double и на `1.005` даёт «1.00».
 */
export function money2(v: string | null): string | null {
  return v === null ? null : round2(v);
}

/** Цена за единицу: до 6 знаков, как numeric(18,6). */
export function price6(v: string | null): string | null {
  return v === null ? null : round6(v);
}

/** Количество к строке: до 6 знаков, без хвостовых нулей. */
export function qty6(v: string | null): string | null {
  if (v === null) return null;
  const fixed = roundQty(v);
  return fixed.replace(/\.?0+$/, '') || '0';
}

/** Поиск строки по предикату над текстами ячеек. */
export function findRow(
  ws: SheetGrid,
  fromRow: number,
  toRow: number,
  predicate: (texts: (col: number) => string, row: number) => boolean,
): number | null {
  for (let r = fromRow; r <= Math.min(toRow, ws.rowCount); r++) {
    const texts = (c: number) => cellText(ws, r, c);
    if (predicate(texts, r)) return r;
  }
  return null;
}

/** Колонка в строке row, чей текст удовлетворяет предикату. */
export function findCol(
  ws: SheetGrid,
  row: number,
  predicate: (text: string) => boolean,
  maxCol = 80,
): number | null {
  for (let c = 1; c <= maxCol; c++) {
    const t = cellText(ws, row, c);
    if (t && predicate(t)) return c;
  }
  return null;
}
