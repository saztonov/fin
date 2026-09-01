import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildCodeHierarchy, normalizeCode } from '../worker/parse-child/code-hierarchy.js';
import { detectHeader } from '../worker/parse-child/header-detect.js';
import { parseKs6 } from '../worker/parse-child/ks6-parser.js';
import { XlsxBook, type SheetGrid } from '../worker/parse-child/xlsx-reader.js';

async function grid(wb: ExcelJS.Workbook, sheet: string): Promise<SheetGrid> {
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const book = await XlsxBook.fromBuffer(buf);
  return book.readSheet(sheet);
}

type Row = [posNo: string, name: string, unit: string, qty: number | null, price: number | null, total: number, ks2?: number];

/**
 * Книга формы «Садовническая 69»: разделы несут «Ед. изм. = Компл» и «Кол-во = 1»,
 * вложенность видна только по точечному «№ п/п», а в конце три итоговые строки —
 * «ИТОГО:» без НДС, сам «НДС 22%» и «ИТОГО, в т.ч. НДС 22%».
 */
async function buildBook(rows: Row[], opts: { echoHeader?: boolean; totals?: boolean } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('КС6а');
  const set = (r: number, c: number, v: ExcelJS.CellValue) => (ws.getRow(r).getCell(c).value = v);

  // шапка: договорный блок + одна графа выполнения с подписью периода
  set(1, 7, 'КС2№1 01.02.2026-28.02.2026');
  set(1, 8, 'КС2№1 01.02.2026-28.02.2026');
  const head = ['№п/п', 'Наименование Работ', 'Ед. изм.', 'Кол-во', 'цена за единицу, руб. без НДС', 'Стоимость без НДС, руб.'];
  head.forEach((h, i) => set(2, i + 1, h));
  set(2, 7, 'Кол-во');
  set(2, 8, 'Стоимость без НДС, руб.');

  let r = 3;
  if (opts.echoHeader) {
    // строка-повтор подписей шапки (Садовническая: строка 9 дублирует строку 8)
    head.forEach((h, i) => set(r, i + 1, h));
    set(r, 7, 'Кол-во');
    set(r, 8, 'Стоимость без НДС, руб.');
    r += 1;
  }

  for (const [posNo, name, unit, qty, price, total, ks2] of rows) {
    set(r, 1, posNo);
    set(r, 2, name);
    if (unit) set(r, 3, unit);
    if (qty !== null) set(r, 4, qty);
    if (price !== null) set(r, 5, price);
    set(r, 6, total);
    if (ks2 !== undefined) {
      set(r, 7, 1);
      set(r, 8, ks2);
    }
    r += 1;
  }

  if (opts.totals !== false) {
    const leafSum = rows.filter((x) => !isParentOf(rows, x[0])).reduce((a, x) => a + x[5], 0);
    const leafKs2 = rows
      .filter((x) => !isParentOf(rows, x[0]))
      .reduce((a, x) => a + (x[6] ?? 0), 0);
    set(r, 2, 'ИТОГО:');
    set(r, 6, leafSum);
    set(r, 8, leafKs2);
    set(r + 1, 2, 'НДС 22%');
    set(r + 1, 6, Math.round(leafSum * 0.22 * 100) / 100);
    set(r + 1, 8, Math.round(leafKs2 * 0.22 * 100) / 100);
    set(r + 2, 2, 'ИТОГО, в т.ч. НДС 22%');
    set(r + 2, 6, Math.round(leafSum * 1.22 * 100) / 100);
    set(r + 2, 8, Math.round(leafKs2 * 1.22 * 100) / 100);
  }
  return wb;
}

const isParentOf = (rows: Row[], code: string) =>
  rows.some((o) => o[0] !== code && o[0].replace(/\.$/, '').startsWith(code.replace(/\.$/, '') + '.'));

/** Разделы с «Компл»/1, у каждого — свои позиции; суммы разделов = суммы детей. */
const NESTED: Row[] = [
  ['1', 'Разработка РД', 'Компл', 1, null, 300, 30],
  ['1.1', 'Конструктивные решения', 'Компл', 1, null, 100, 10],
  ['1.1.1', 'Плита', 'м3', 2, 25, 50, 5],
  ['1.1.2', 'Стена', 'м3', 2, 25, 50, 5],
  ['1.2', 'Архитектурные решения', 'Компл', 1, null, 200, 20],
  ['1.2.1', 'Фасад', 'м2', 4, 25, 100, 10],
  ['1.2.2', 'Кровля', 'м2', 4, 25, 100, 10],
];

describe('иерархия по точечному № п/п', () => {
  it('нормализация кода: хвостовая точка снимается, дефис приводится к точке', () => {
    expect(normalizeCode('1.1.')).toBe('1.1');
    expect(normalizeCode(' 01.01.02.01 ')).toBe('01.01.02.01');
    expect(normalizeCode('1-2')).toBe('1.2');
    expect(normalizeCode('поз. 5')).toBeNull();
    expect(normalizeCode('')).toBeNull();
  });

  it('«1» не родитель «11» — сравнение посегментное, а не по подстроке', async () => {
    const rows: Row[] = [
      ['1', 'Работа один', 'м3', 1, 10, 10],
      ['11', 'Работа одиннадцать', 'м3', 1, 20, 20],
      ['2', 'Работа два', 'м3', 1, 30, 30],
    ];
    const ws = await grid(await buildBook(rows), 'КС6а');
    const h = buildCodeHierarchy(ws, detectHeader(ws)!);
    expect(h.parents.size).toBe(0);
    // все три строки — позиции, ни одна не съедена как «раздел»
    const parsed = parseKs6(ws);
    expect(parsed.items.filter((i) => i.kind === 'nomenclature')).toHaveLength(3);
  });

  it('сквозная нумерация 1,2,3 не создаёт родителей', async () => {
    const rows: Row[] = [
      ['1', 'Первая', 'м3', 1, 10, 10],
      ['2', 'Вторая', 'м3', 1, 10, 10],
      ['3', 'Третья', 'м3', 1, 10, 10],
    ];
    const ws = await grid(await buildBook(rows), 'КС6а');
    const h = buildCodeHierarchy(ws, detectHeader(ws)!);
    expect(h.parents.size).toBe(0);
    expect(h.trusted).toBe(false);
  });

  it('раздел с «Ед. изм. = Компл» и детьми по шифру не попадает в суммы', async () => {
    const ws = await grid(await buildBook(NESTED), 'КС6а');
    const h = buildCodeHierarchy(ws, detectHeader(ws)!);
    expect(h.trusted).toBe(true);
    expect([...h.parents].sort()).toEqual(['1', '1.1', '1.2']);

    const parsed = parseKs6(ws);
    const nom = parsed.items.filter((i) => i.kind === 'nomenclature');
    // считаются только 4 листа, а не 7 строк: разделы ушли в структуру
    expect(nom.map((i) => i.name).sort()).toEqual(['Кровля', 'Плита', 'Стена', 'Фасад']);
    const sum = nom.reduce((a, i) => a + Number(i.contractTotal), 0);
    expect(sum).toBe(300);
    expect(parsed.controls.contractTotal).toBe('300.00');
    // без правила сумма была бы 900 — разделы сложились бы вместе с детьми
    expect(sum).not.toBe(900);
  });

  it('суммы КС-2 тоже берутся только по листьям', async () => {
    const ws = await grid(await buildBook(NESTED), 'КС6а');
    const parsed = parseKs6(ws);
    expect(parsed.ks2Columns).toHaveLength(1);
    const col = parsed.ks2Columns[0]!;
    expect(col.cells).toHaveLength(4);
    const sum = col.cells.reduce((a, c) => a + Number(c.amount), 0);
    expect(sum).toBe(30);
    expect(col.fileTotal).toBe('30.00');
  });

  it('лист без «Ед. изм.», заданный одним «Всего», остаётся позицией', async () => {
    // «1.3.7 Разработка РД генплана по ПЗУ» у Садовнической: ни ед. изм., ни цены
    const rows: Row[] = [
      ...NESTED,
      ['2', 'Внутренние сети', 'Компл', 1, null, 70],
      ['2.1', 'Слаботочка', 'м', 1, 20, 20],
      ['2.2', 'Разработка РД генплана', '', null, null, 50],
    ];
    const ws = await grid(await buildBook(rows), 'КС6а');
    const parsed = parseKs6(ws);
    const nom = parsed.items.filter((i) => i.kind === 'nomenclature');
    expect(nom.map((i) => i.name)).toContain('Разработка РД генплана');
    expect(nom.reduce((a, i) => a + Number(i.contractTotal), 0)).toBe(370);
  });

  it('иерархия без подтверждения сумм не применяется — разбор прежний', async () => {
    // родитель заявляет 999, дети дают 100 — арифметика не сходится
    const rows: Row[] = [
      ['1', 'Раздел', 'Компл', 1, null, 999],
      ['1.1', 'Работа А', 'м3', 1, 50, 50],
      ['1.2', 'Работа Б', 'м3', 1, 50, 50],
      ['2', 'Раздел два', 'Компл', 1, null, 888],
      ['2.1', 'Работа В', 'м3', 1, 60, 60],
      ['2.2', 'Работа Г', 'м3', 1, 60, 60],
      ['3', 'Раздел три', 'Компл', 1, null, 777],
      ['3.1', 'Работа Д', 'м3', 1, 70, 70],
      ['3.2', 'Работа Е', 'м3', 1, 70, 70],
    ];
    const ws = await grid(await buildBook(rows, { totals: false }), 'КС6а');
    const h = buildCodeHierarchy(ws, detectHeader(ws)!);
    expect(h.nodes).toBe(3);
    expect(h.matched).toBe(0);
    expect(h.trusted).toBe(false);
    // раз не доверяем — «Компл» по-прежнему делает строку позицией
    const parsed = parseKs6(ws);
    const names = parsed.items.filter((i) => i.kind === 'nomenclature').map((i) => i.name);
    expect(names).toContain('Раздел');
  });

  it('о применении иерархии и о риске задвоения сообщается в предупреждениях', async () => {
    const applied = parseKs6(await grid(await buildBook(NESTED), 'КС6а'));
    expect(applied.warnings.some((w) => w.includes('Вложенность взята из графы «№ п/п»'))).toBe(true);
    expect(applied.warnings.some((w) => w.includes('задвоение'))).toBe(false);
  });
});

describe('строка-повтор шапки', () => {
  it('подписи граф, продублированные под шапкой, не становятся работой', async () => {
    const ws = await grid(await buildBook(NESTED, { echoHeader: true }), 'КС6а');
    const parsed = parseKs6(ws);
    const names = parsed.items.map((i) => i.name);
    expect(names).not.toContain('Наименование Работ');
    expect(parsed.items.filter((i) => i.kind === 'nomenclature')).toHaveLength(4);
    expect(parsed.warnings.some((w) => w.includes('до первого раздела'))).toBe(false);
  });
});
