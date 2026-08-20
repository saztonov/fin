import type ExcelJS from 'exceljs';

/** Развёртка значения ячейки exceljs: формулы, rich text, даты. */
export function rawValue(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if ('result' in v) return (v as { result: unknown }).result ?? null;
    if ('richText' in v) {
      return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
    }
    if (v instanceof Date) return v;
    if ('text' in v) return (v as { text: string }).text;
    if ('error' in v) return null;
  }
  return v;
}

export function cellText(ws: ExcelJS.Worksheet, row: number, col: number): string {
  const v = rawValue(ws.getRow(row).getCell(col));
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, ' ').trim();
}

/** Число из ячейки: number, строка с пробелами/NBSP/запятой. null, если не число. */
export function cellNum(ws: ExcelJS.Worksheet, row: number, col: number): number | null {
  const v = rawValue(ws.getRow(row).getCell(col));
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return null;
  const s = String(v)
    .replace(/[\s  ]/g, '')
    .replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function cellDate(ws: ExcelJS.Worksheet, row: number, col: number): string | null {
  const v = rawValue(ws.getRow(row).getCell(col));
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') return parseRuDate(v);
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

export function isBold(ws: ExcelJS.Worksheet, row: number, col: number): boolean {
  const font = ws.getRow(row).getCell(col).font;
  return Boolean(font?.bold);
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
  ws: ExcelJS.Worksheet,
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

/** Колонка в строке headerRow, чей текст удовлетворяет предикату. */
export function findCol(
  ws: ExcelJS.Worksheet,
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

export function getVisibleSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const target = wb.worksheets.find(
    (ws) => ws.name.trim() === name && ws.state !== 'hidden' && ws.state !== 'veryHidden',
  );
  if (!target) {
    const visible = wb.worksheets
      .filter((ws) => ws.state !== 'hidden' && ws.state !== 'veryHidden')
      .map((ws) => ws.name);
    throw new Error(
      `В книге нет видимого листа «${name}». Видимые листы: ${visible.join(', ') || 'нет'}`,
    );
  }
  return target;
}
