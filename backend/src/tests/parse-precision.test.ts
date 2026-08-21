import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseKs6 } from '../worker/parse-child/ks6-parser.js';
import { sumStrings } from '../lib/money.js';
import { XlsxBook, type SheetGrid } from '../worker/parse-child/xlsx-reader.js';

async function grid(wb: ExcelJS.Workbook, sheet: string): Promise<SheetGrid> {
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const book = await XlsxBook.fromBuffer(buf);
  return book.readSheet(sheet);
}

/**
 * Книга с «половинками копейки»: 0,615 и 1,005 — значения, на которых
 * `number.toFixed(2)` округляет вниз (двоичное представление чуть меньше половины),
 * а Excel и половинное-вверх округление дают на копейку больше.
 */
async function buildHalfKopeckWorkbook(): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('КС-6');
  const set = (r: number, c: number, v: ExcelJS.CellValue) => (ws.getRow(r).getCell(c).value = v);

  set(1, 1, '№ п/п');
  set(1, 2, 'Наименование работ');
  set(1, 3, 'Ед. изм.');
  set(1, 4, 'Кол-во');
  set(1, 5, 'Цена за ед., руб. с НДС');
  set(1, 6, 'Всего, руб. с НДС');
  for (let c = 1; c <= 6; c++) set(2, c, c);

  set(3, 2, 'Раздел 1');

  set(4, 1, 1);
  set(4, 2, 'Работа с копеечной расценкой');
  set(4, 3, 'м3');
  set(4, 4, 1);
  set(4, 5, 0.615);
  set(4, 6, 0.615);

  set(5, 1, 2);
  set(5, 2, 'Работа с расценкой 1,005');
  set(5, 3, 'м3');
  set(5, 4, 3);
  set(5, 5, 1.005);
  set(5, 6, 3.015);

  set(6, 2, 'Итого, руб., в т.ч. НДС');
  set(6, 6, 3.63);
  return wb;
}

describe('точность разбора Excel', () => {
  it('копейка округляется вверх (half-up), а не по представимости double', async () => {
    const parsed = parseKs6(await grid(await buildHalfKopeckWorkbook(), 'КС-6'));
    const items = parsed.items.filter((i) => i.kind === 'nomenclature');
    expect(items).toHaveLength(2);

    // toFixed(2) дал бы '0.61' и '3.01' — по копейке вниз на каждой строке
    expect(items[0]!.contractTotal).toBe('0.62');
    expect(items[1]!.contractTotal).toBe('3.02');
    // расценка хранится целиком, а не урезается до копеек
    expect(items[0]!.unitPrice).toBe('0.615000');
    expect(items[1]!.unitPrice).toBe('1.005000');
  });

  it('копеечная неувязка книги не поднимает шума, но остаётся видимой разницей', async () => {
    // Excel складывает неокруглённые 0,615 + 3,015 = 3,63, портал — округлённые до
    // копеек 0,62 + 3,02 = 3,64. Ровно такое расхождение и подсвечивает грид КС-6;
    // в текст предупреждений оно не идёт — там допуск в рубль
    const parsed = parseKs6(await grid(await buildHalfKopeckWorkbook(), 'КС-6'));
    const sum = sumStrings(
      parsed.items.filter((i) => i.kind === 'nomenclature').map((i) => i.contractTotal),
    );
    expect(parsed.controls.contractTotal).toBe('3.63');
    expect(sum).toBe('3.64');
    expect(parsed.warnings.filter((w) => w.includes('расходится'))).toEqual([]);
  });

  it('без контрольной графы выполнения сверять нечего', async () => {
    const parsed = parseKs6(await grid(await buildHalfKopeckWorkbook(), 'КС-6'));
    expect(parsed.items.every((i) => i.fileExecutedTotal === null)).toBe(true);
  });
});
