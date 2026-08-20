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

/** Число из ячейки: number, строка с пробелами/NBSP/запятой. null, если не число. */
export function cellNum(ws: SheetGrid, row: number, col: number): number | null {
  const cell = ws.get(row, col);
  const v = cell.value;
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (cell.isDate) return null;
  const s = String(v)
    .replace(/[\s  ]/g, '')
    .replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
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

/** Округление денег к строке (2 знака, half-up через toFixed). */
export function money2(n: number | null): string | null {
  if (n === null) return null;
  return n.toFixed(2);
}

/** Округление количества к строке (до 6 знаков, без хвостовых нулей). */
export function qty6(n: number | null): string | null {
  if (n === null) return null;
  const fixed = n.toFixed(6);
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
