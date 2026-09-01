import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { grossFromNetRate, grossPriceFromNetRate, netFromGrossRate } from '../lib/money.js';
import { parseKs6 } from '../worker/parse-child/ks6-parser.js';
import { isGrossTotalRow, isVatAmountRow } from '../worker/parse-child/row-classify.js';
import { XlsxBook, type SheetGrid } from '../worker/parse-child/xlsx-reader.js';

async function grid(wb: ExcelJS.Workbook, sheet: string): Promise<SheetGrid> {
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const book = await XlsxBook.fromBuffer(buf);
  return book.readSheet(sheet);
}

/**
 * Книга в суммах БЕЗ НДС с тремя итоговыми строками подряд, как у «Садовническая 69»:
 * «ИТОГО:» (нетто), «НДС 22%» (сам налог) и «ИТОГО, в т.ч. НДС 22%» (брутто).
 * Контролем должна стать первая: графы листа — нетто, сверять надо на одной базе.
 */
async function buildNetBook(opts: { periodTotal?: number } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('КС6а');
  const set = (r: number, c: number, v: ExcelJS.CellValue) => (ws.getRow(r).getCell(c).value = v);

  set(1, 7, 'КС2№1 01.02.2026-28.02.2026');
  set(1, 8, 'КС2№1 01.02.2026-28.02.2026');
  ['№п/п', 'Наименование Работ', 'Ед. изм.', 'Кол-во', 'цена за единицу, руб. без НДС', 'Стоимость без НДС, руб.']
    .forEach((h, i) => set(2, i + 1, h));
  set(2, 7, 'Кол-во');
  set(2, 8, 'Стоимость без НДС, руб.');

  set(3, 2, 'Раздел 1');
  const rows: [string, string, number, number, number][] = [
    ['1', 'Плита', 2, 100, 200],
    ['2', 'Стена', 3, 100, 300],
  ];
  let r = 4;
  for (const [no, name, qty, price, total] of rows) {
    set(r, 1, no);
    set(r, 2, name);
    set(r, 3, 'м3');
    set(r, 4, qty);
    set(r, 5, price);
    set(r, 6, total);
    set(r, 7, qty);
    set(r, 8, total / 2);
    r += 1;
  }
  const net = 500;
  const periodTotal = opts.periodTotal ?? 250;
  set(r, 2, 'ИТОГО:');
  set(r, 6, net);
  set(r, 8, periodTotal);
  set(r + 1, 2, 'НДС 22%');
  set(r + 1, 6, 110);
  set(r + 1, 8, 55);
  set(r + 2, 2, 'ИТОГО, в т.ч. НДС 22%');
  set(r + 2, 6, 610);
  set(r + 2, 8, 305);
  return wb;
}

describe('распознавание итоговых строк', () => {
  it('строка налога отличается от итога, включающего налог', () => {
    expect(isVatAmountRow('НДС 22%')).toBe(true);
    expect(isVatAmountRow('в т.ч. НДС 20 %')).toBe(true);
    expect(isVatAmountRow('ИТОГО, в т.ч. НДС 22%')).toBe(false);
    expect(isVatAmountRow('ИТОГО:')).toBe(false);
    expect(isVatAmountRow('Работы по НДС-контуру')).toBe(false);

    expect(isGrossTotalRow('ИТОГО, в т.ч. НДС 22%')).toBe(true);
    expect(isGrossTotalRow('Всего с НДС')).toBe(true);
    expect(isGrossTotalRow('ИТОГО:')).toBe(false);
    expect(isGrossTotalRow('НДС 22%')).toBe(false);
  });

  it('на листе без НДС контролем становится нетто-итог, а не «в т.ч. НДС»', async () => {
    const parsed = parseKs6(await grid(await buildNetBook(), 'КС6а'));
    expect(parsed.vat.mode).toBe('net');
    // 610 — брутто-строка, её брать нельзя: данные листа нетто
    expect(parsed.controls.contractTotal).toBe('500.00');
    // 110 — сам налог; раньше сюда попадал брутто-итог 610
    expect(parsed.controls.vat).toBe('110.00');
  });

  it('Σ строк сходится с нетто-итогом — предупреждения о расхождении нет', async () => {
    const parsed = parseKs6(await grid(await buildNetBook(), 'КС6а'));
    expect(parsed.warnings.filter((w) => w.includes('расходится'))).toEqual([]);
  });

  it('итог файла по графе периода попадает в колонку КС-2', async () => {
    const parsed = parseKs6(await grid(await buildNetBook(), 'КС6а'));
    expect(parsed.ks2Columns[0]!.fileTotal).toBe('250.00');
  });

  it('расхождение по конкретной КС-2 называет акт и сумму', async () => {
    // итог файла по графе занижен на 50 — ровно это и происходит при задвоении
    const parsed = parseKs6(await grid(await buildNetBook({ periodTotal: 200 }), 'КС6а'));
    const w = parsed.warnings.find((x) => x.includes('КС-2 №1'));
    expect(w).toBeDefined();
    expect(w).toContain('250.00');
    expect(w).toContain('50.00');
  });
});

describe('перевод сумм без НДС в суммы с НДС', () => {
  it('нетто + налог даёт брутто до копейки', () => {
    expect(grossFromNetRate('100.00', 22)).toBe('122.00');
    expect(grossFromNetRate('0.01', 22)).toBe('0.01');
    expect(grossFromNetRate('1234.56', 20)).toBe('1481.47');
  });

  it('обратная операция возвращает исходную сумму', () => {
    for (const net of ['100.00', '1234.56', '999999.99']) {
      const gross = grossFromNetRate(net, 22);
      expect(netFromGrossRate(gross, 22)).toBe(net);
    }
  });

  it('цена за единицу пересчитывается делением, с сохранением 6 знаков', () => {
    expect(grossPriceFromNetRate('0.615000', 22)).toBe('0.750300');
    expect(grossPriceFromNetRate('100', 0)).toBe('100.000000');
  });
});
