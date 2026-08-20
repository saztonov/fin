/**
 * Потоковое чтение xlsx для parse-child.
 *
 * Зачем не exceljs: `Workbook.xlsx.readFile` строит объектную модель всей книги и на
 * реальных КС-6 (Инджой — 15,6 МБ / 13,7 тыс. строк, Сторис — 5,3 МБ) не укладывается
 * даже в девять минут, тогда как PARSE_TIMEOUT_MS = 60 000. Здесь читается ровно один
 * лист и ровно то, что нужно парсерам: значение, «жирный», объединения.
 *
 * exceljs остаётся в проекте для экспорта — там книги наши и маленькие.
 */
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { SaxesParser } from 'saxes';

export type SheetState = 'visible' | 'hidden' | 'veryHidden';

export interface SheetInfo {
  name: string;
  state: SheetState;
  /** порядковый номер листа в книге, с 1 */
  index: number;
}

export interface CellValue {
  /** строка, число или ISO-дата (yyyy-mm-dd) для ячеек с датовым форматом */
  value: string | number | null;
  isDate: boolean;
  bold: boolean;
}

const EMPTY: CellValue = { value: null, isDate: false, bold: false };

/** Сетка одного листа: разрежённая, доступ по (row, col) с 1. */
export class SheetGrid {
  readonly name: string;
  readonly rowCount: number;
  readonly columnCount: number;
  private readonly cells: Map<number, Map<number, CellValue>>;
  /** slave-ячейка объединения → координаты master */
  private readonly mergeMaster: Map<string, [number, number]>;
  readonly merges: string[];

  constructor(
    name: string,
    cells: Map<number, Map<number, CellValue>>,
    merges: string[],
    rowCount: number,
    columnCount: number,
  ) {
    this.name = name;
    this.cells = cells;
    this.merges = merges;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
    this.mergeMaster = buildMergeMap(merges);
  }

  /** Значение ячейки без учёта объединений. */
  raw(row: number, col: number): CellValue {
    return this.cells.get(row)?.get(col) ?? EMPTY;
  }

  /** Значение с учётом объединений: slave отдаёт значение master. */
  get(row: number, col: number): CellValue {
    const own = this.cells.get(row)?.get(col);
    if (own && own.value !== null && own.value !== '') return own;
    const master = this.mergeMaster.get(`${row}:${col}`);
    if (master) {
      const [mr, mc] = master;
      if (mr !== row || mc !== col) return this.cells.get(mr)?.get(mc) ?? own ?? EMPTY;
    }
    return own ?? EMPTY;
  }

  /** Номера строк, где есть хотя бы одна заполненная ячейка, по возрастанию. */
  filledRows(): number[] {
    return [...this.cells.keys()].sort((a, b) => a - b);
  }
}

function buildMergeMap(merges: string[]): Map<string, [number, number]> {
  const map = new Map<string, [number, number]>();
  for (const ref of merges) {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
    if (!m) continue;
    const c1 = colToNum(m[1]!);
    const r1 = Number(m[2]);
    const c2 = colToNum(m[3]!);
    const r2 = Number(m[4]);
    // объединения в шапках бывают широкими, но не гигантскими — страхуемся от мусора
    if ((r2 - r1 + 1) * (c2 - c1 + 1) > 100_000) continue;
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) map.set(`${r}:${c}`, [r1, c1]);
    }
  }
  return map;
}

export function colToNum(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]!) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function numToCol(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = (n - 1 - m) / 26;
  }
  return s;
}

/** Excel-серийник → ISO-дата. Учитывает мнимое 29.02.1900. */
export function serialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 2_958_465) return null;
  const days = serial < 61 ? serial : serial - 1;
  const ms = Math.round((days - 25568) * 86_400_000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

interface Styles {
  /** индекс cellXf → является ли формат датовым */
  xfIsDate: boolean[];
  /** индекс cellXf → жирный шрифт */
  xfIsBold: boolean[];
}

const BUILTIN_DATE_FMT = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58,
]);

function formatCodeIsDate(code: string): boolean {
  // отбрасываем экранированные куски и цвета/условия, ищем маркеры даты
  const cleaned = code
    .replace(/\[[^\]]*\]/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '');
  return /[ymdhs]/i.test(cleaned) && !/^[^ymdhs]*$/i.test(cleaned);
}

/** Открытая книга: zip держится в памяти, листы читаются по требованию. */
export class XlsxBook {
  private constructor(
    private readonly zip: JSZip,
    private readonly sheets: (SheetInfo & { path: string })[],
    private readonly sharedStrings: string[],
    private readonly styles: Styles,
  ) {}

  static async open(filePath: string): Promise<XlsxBook> {
    return XlsxBook.fromBuffer(await readFile(filePath));
  }

  static async fromBuffer(buf: Buffer): Promise<XlsxBook> {
    const zip = await JSZip.loadAsync(buf, { checkCRC32: false });
    const sheets = await readWorkbookSheets(zip);
    const sharedStrings = await readSharedStrings(zip);
    const styles = await readStyles(zip);
    return new XlsxBook(zip, sheets, sharedStrings, styles);
  }

  listSheets(): SheetInfo[] {
    return this.sheets.map(({ name, state, index }) => ({ name, state, index }));
  }

  visibleSheets(): SheetInfo[] {
    return this.listSheets().filter((s) => s.state === 'visible');
  }

  async readSheet(name: string): Promise<SheetGrid> {
    const sheet = this.sheets.find((s) => s.name === name) ?? this.sheets.find((s) => s.name.trim() === name.trim());
    if (!sheet) {
      throw new Error(
        `В книге нет листа «${name}». Листы: ${this.sheets.map((s) => s.name).join(', ') || 'нет'}`,
      );
    }
    const entry = this.zip.file(sheet.path);
    if (!entry) throw new Error(`Повреждённая книга: нет ${sheet.path}`);
    return readSheetGrid(entry, sheet.name, this.sharedStrings, this.styles);
  }
}

async function streamXml(
  entry: JSZip.JSZipObject,
  handlers: {
    open?: (name: string, attrs: Record<string, string>) => void;
    text?: (t: string) => void;
    close?: (name: string) => void;
  },
): Promise<void> {
  const parser = new SaxesParser();
  let failure: Error | null = null;
  parser.on('error', (e) => {
    failure = e instanceof Error ? e : new Error(String(e));
  });
  if (handlers.open) {
    parser.on('opentag', (t) => handlers.open!(t.name, t.attributes as Record<string, string>));
  }
  if (handlers.text) parser.on('text', (t) => handlers.text!(t));
  if (handlers.close) parser.on('closetag', (t) => handlers.close!(t.name));

  await new Promise<void>((resolve, reject) => {
    const stream = entry.nodeStream('nodebuffer');
    stream.on('data', (chunk: Buffer | string) => {
      try {
        parser.write(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    stream.on('end', () => resolve());
    stream.on('error', (e: Error) => reject(e));
  });
  if (failure) throw failure;
}

async function readWorkbookSheets(zip: JSZip): Promise<(SheetInfo & { path: string })[]> {
  const wb = zip.file('xl/workbook.xml');
  if (!wb) throw new Error('Повреждённая книга: нет xl/workbook.xml');
  const raw: { name: string; state: SheetState; rid: string }[] = [];
  await streamXml(wb, {
    open: (name, a) => {
      if (name !== 'sheet') return;
      const state = (a.state as SheetState) || 'visible';
      raw.push({ name: a.name ?? '', state, rid: a['r:id'] ?? '' });
    },
  });

  const rels = new Map<string, string>();
  const relEntry = zip.file('xl/_rels/workbook.xml.rels');
  if (relEntry) {
    await streamXml(relEntry, {
      open: (name, a) => {
        if (name === 'Relationship' && a.Id && a.Target) rels.set(a.Id, a.Target);
      },
    });
  }

  return raw.map((s, i) => {
    let target = (rels.get(s.rid) ?? `worksheets/sheet${i + 1}.xml`)
      .replace(/^\/xl\//, '')
      .replace(/^\//, '');
    if (!target.startsWith('xl/')) target = `xl/${target}`;
    return { name: s.name, state: s.state, index: i + 1, path: target };
  });
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const entry = zip.file('xl/sharedStrings.xml');
  if (!entry) return [];
  const out: string[] = [];
  let current: string | null = null;
  let inText = false;
  await streamXml(entry, {
    open: (name) => {
      if (name === 'si') current = '';
      else if (name === 't' && current !== null) inText = true;
    },
    text: (t) => {
      if (inText && current !== null) current += t;
    },
    close: (name) => {
      if (name === 't') inText = false;
      else if (name === 'si') {
        out.push(current ?? '');
        current = null;
      }
    },
  });
  return out;
}

async function readStyles(zip: JSZip): Promise<Styles> {
  const entry = zip.file('xl/styles.xml');
  const xfIsDate: boolean[] = [];
  const xfIsBold: boolean[] = [];
  if (!entry) return { xfIsDate, xfIsBold };

  const customDateFmt = new Set<number>();
  const fontBold: boolean[] = [];
  let inFonts = false;
  let inCellXfs = false;
  let fontIdx = -1;

  await streamXml(entry, {
    open: (name, a) => {
      if (name === 'numFmt') {
        const id = Number(a.numFmtId);
        if (Number.isFinite(id) && a.formatCode && formatCodeIsDate(a.formatCode)) {
          customDateFmt.add(id);
        }
      } else if (name === 'fonts') inFonts = true;
      else if (name === 'font' && inFonts) {
        fontIdx += 1;
        fontBold[fontIdx] = false;
      } else if (name === 'b' && inFonts && fontIdx >= 0) fontBold[fontIdx] = true;
      else if (name === 'cellXfs') inCellXfs = true;
      else if (name === 'xf' && inCellXfs) {
        const numFmtId = Number(a.numFmtId ?? 0);
        const fid = Number(a.fontId ?? 0);
        xfIsDate.push(BUILTIN_DATE_FMT.has(numFmtId) || customDateFmt.has(numFmtId));
        xfIsBold.push(fontBold[fid] === true);
      }
    },
    close: (name) => {
      if (name === 'fonts') inFonts = false;
      else if (name === 'cellXfs') inCellXfs = false;
    },
  });

  return { xfIsDate, xfIsBold };
}

async function readSheetGrid(
  entry: JSZip.JSZipObject,
  name: string,
  sst: string[],
  styles: Styles,
): Promise<SheetGrid> {
  const cells = new Map<number, Map<number, CellValue>>();
  const merges: string[] = [];
  let maxRow = 0;
  let maxCol = 0;

  let row = 0;
  let col = 0;
  let cellType = 'n';
  let styleIdx = -1;
  let inValue = false;
  let inInlineStr = false;
  let buf = '';

  await streamXml(entry, {
    open: (tag, a) => {
      switch (tag) {
        case 'row':
          row = Number(a.r ?? row + 1);
          break;
        case 'c':
          col = a.r ? colToNum(a.r) : col + 1;
          cellType = a.t ?? 'n';
          styleIdx = a.s !== undefined ? Number(a.s) : -1;
          buf = '';
          break;
        case 'v':
          inValue = true;
          break;
        case 'is':
          inInlineStr = true;
          break;
        case 't':
          if (inInlineStr) inValue = true;
          break;
        default:
          break;
      }
      if (tag === 'mergeCell' && a.ref) merges.push(a.ref);
    },
    text: (t) => {
      if (inValue) buf += t;
    },
    close: (tag) => {
      if (tag === 'v' || (tag === 't' && inInlineStr)) inValue = false;
      else if (tag === 'is') inInlineStr = false;
      else if (tag === 'c') {
        if (buf !== '') {
          const bold = styleIdx >= 0 && styles.xfIsBold[styleIdx] === true;
          let value: string | number | null;
          let isDate = false;
          if (cellType === 's') {
            value = sst[Number(buf)] ?? '';
          } else if (cellType === 'inlineStr' || cellType === 'str') {
            value = buf;
          } else if (cellType === 'b') {
            value = buf === '1' ? 'ИСТИНА' : 'ЛОЖЬ';
          } else if (cellType === 'e') {
            value = null;
          } else {
            const n = Number(buf);
            if (Number.isFinite(n)) {
              const dateFmt = styleIdx >= 0 && styles.xfIsDate[styleIdx] === true;
              if (dateFmt) {
                const iso = serialToIso(n);
                if (iso) {
                  value = iso;
                  isDate = true;
                } else value = n;
              } else value = n;
            } else value = buf;
          }
          if (value !== null && value !== '') {
            let line = cells.get(row);
            if (!line) {
              line = new Map<number, CellValue>();
              cells.set(row, line);
            }
            line.set(col, { value, isDate, bold });
            if (row > maxRow) maxRow = row;
            if (col > maxCol) maxCol = col;
          }
        }
        buf = '';
        styleIdx = -1;
      }
    },
  });

  return new SheetGrid(name, cells, merges, maxRow, maxCol);
}
