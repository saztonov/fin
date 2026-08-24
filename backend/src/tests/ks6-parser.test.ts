import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseKs6 } from '../worker/parse-child/ks6-parser.js';
import { parsePsdc } from '../worker/parse-child/psdc-parser.js';
import { XlsxBook, type SheetGrid } from '../worker/parse-child/xlsx-reader.js';

/** Книга собирается exceljs, а читается тем же потоковым ридером, что и в проде. */
async function grid(wb: ExcelJS.Workbook, sheet: string): Promise<SheetGrid> {
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const book = await XlsxBook.fromBuffer(buf);
  return book.readSheet(sheet);
}

/** Синтетическая книга с листом «КС-6» по образцу реальной структуры. */
async function buildKs6Workbook(): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('КС-6');
  const set = (r: number, c: number, v: ExcelJS.CellValue) => ws.getRow(r).getCell(c).value = v;

  // шапка документа
  set(3, 10, 'Договор подряда ');
  set(3, 13, 'номер');
  set(3, 14, 'Д-1/24');
  set(4, 13, 'дата');
  set(4, 14, new Date(Date.UTC(2024, 9, 11)));

  // строки метаданных колонок: даты (r6), подписи (r7)
  set(6, 15, new Date(Date.UTC(2024, 9, 1)));
  set(7, 15, 'КС-2 №1 11.10.24-15.10.24');
  set(7, 18, 'Остаток');

  // табличная шапка (r8) + подзаголовки (r9)
  set(8, 1, '№ п/п');
  set(8, 2, 'Код КВР');
  set(8, 4, 'Наименование работ');
  set(8, 11, 'Выполнение с нач.ст-ва');
  set(9, 5, 'Ед.\nизм.');
  set(9, 6, 'Кол-во един.');
  set(9, 7, 'Цена за ед. изм., руб. с НДС');
  set(9, 8, 'Стоимость материала на ед. изм., руб');
  set(9, 9, 'Стоимость работ на ед. изм., руб');
  set(9, 10, 'Всего, руб. с НДС');
  set(9, 11, 'Кол-во');
  set(9, 12, 'Стоимость, руб с НДС');
  set(9, 13, 'Кол-во');
  set(9, 14, 'Стоимость, руб с НДС');
  set(9, 15, 'Кол-во');
  set(9, 16, 'Стоимость, руб с НДС');
  set(9, 17, 'Кол-во');
  set(9, 18, 'Стоимость, руб с НДС');
  // цифровая строка с колонкой «Вид»
  set(10, 1, 1);
  set(10, 3, 'Вид');
  set(10, 4, 3);

  // данные: раздел (с суммой в графах цены/итога — как в реальном файле)
  set(11, 4, 'Работы ПОС');
  set(11, 6, 0);
  set(11, 7, 300);
  set(11, 10, 300);
  // КВР
  set(12, 2, '01К.01');
  set(12, 3, 'КВР');
  set(12, 4, 'Устройство ограждения');
  set(12, 5, 'пог. м');
  set(12, 6, 10);
  set(12, 7, 30);
  set(12, 10, 300);
  // номенклатура с выполнением: столбец истории (13/14) и текущий (15/16)
  set(13, 2, '01К.01');
  set(13, 3, 'Номенклатура');
  set(13, 4, 'Устройство ограждения из ж/б');
  set(13, 5, 'пог. м');
  set(13, 6, 10);
  set(13, 7, 30);
  set(13, 10, 300);
  set(13, 11, 4);
  set(13, 12, 120);
  set(13, 13, 1);
  set(13, 14, 30);
  set(13, 15, 3);
  set(13, 16, 90);
  // подраздел без сумм
  set(14, 4, 'Подземная часть');
  // итого
  set(15, 4, 'Итого, руб., в т.ч. НДС');
  set(15, 10, 300);
  set(15, 12, 120);
  set(16, 4, 'НДС 20%');
  set(16, 10, 50);
  return wb;
}

describe('ks6-parser (синтетическая книга)', () => {
  it('разбирает структуру, договорные графы и помесячные пары', async () => {
    const wb = await buildKs6Workbook();
    const parsed = parseKs6(await grid(wb, 'КС-6'));

    expect(parsed.sections.map((s) => [s.name, s.level])).toEqual([
      ['Работы ПОС', 1],
      ['Подземная часть', 2],
    ]);
    expect(parsed.items).toHaveLength(2);
    const [kvr, nom] = parsed.items;
    expect(kvr!.kind).toBe('kvr');
    expect(nom!.kind).toBe('nomenclature');
    expect(nom!.kvrTmpId).toBe(kvr!.tmpId);
    expect(nom!.contractQty).toBe('10');
    expect(nom!.unitPrice).toBe('30.000000');
    expect(nom!.contractTotal).toBe('300.00');

    // две значимых колонки: безымянная (13/14) и «КС-2 №1» (15/16); «Остаток» отрезан
    expect(parsed.ks2Columns).toHaveLength(2);
    const [col0, col1] = parsed.ks2Columns;
    expect(col0!.label).toBeNull();
    expect(col0!.cells).toEqual([{ itemTmpId: nom!.tmpId, qty: '1', amount: '30.00' }]);
    expect(col1!.number).toBe('1');
    expect(col1!.periodFrom).toBe('2024-10-11');
    expect(col1!.periodTo).toBe('2024-10-15');
    expect(col1!.cells).toEqual([{ itemTmpId: nom!.tmpId, qty: '3', amount: '90.00' }]);

    expect(parsed.controls.contractTotal).toBe('300.00');
    expect(parsed.controls.executedTotal).toBe('120.00');
    expect(parsed.controls.vat).toBe('50.00');

    // контрольная графа «Выполнение с нач.ст-ва» читается и по строке — по ней грид
    // КС-6 сверяет импортированное выполнение с книгой
    expect(nom!.fileExecutedTotal).toBe('120.00');
    expect(kvr!.fileExecutedTotal).toBeNull();
  });

  it('под итогом только «НДС» — предупреждения об обрыве чтения нет', async () => {
    const wb = await buildKs6Workbook();
    const parsed = parseKs6(await grid(wb, 'КС-6'));
    expect(parsed.warnings.filter((w) => w.includes('не читались'))).toEqual([]);
  });

  /**
   * ЗИЛ: у строк есть явный «Вид», а суммы соседних позиций совпадают случайно
   * (одинаковые расценки по корпусам). Эвристика агрегатов не должна их трогать,
   * иначе головная строка уходит из суммы номенклатуры.
   */
  it('явный «Вид» сильнее совпадения сумм, черновые числа справа не дают предупреждений', async () => {
    const wb = await buildKs6Workbook();
    const ws = wb.getWorksheet('КС-6')!;
    const set = (r: number, c: number, v: ExcelJS.CellValue) => (ws.getRow(r).getCell(c).value = v);
    // «Корпус 1» = 100, ниже две позиции по 50 — сумма сходится, но все три помечены
    // «Номенклатура». Строки идут до итога, поэтому итог переезжает ниже
    for (const [row, name, total] of [
      [15, 'Устройство стенки Корпус 1', 100],
      [16, 'Устройство стенки Корпус 2', 50],
      [17, 'Устройство стенки Корпус 3', 50],
    ] as const) {
      set(row, 3, 'Номенклатура');
      set(row, 4, name);
      set(row, 5, 'этаж');
      set(row, 6, 2);
      set(row, 7, total / 2);
      set(row, 10, total);
    }
    set(18, 4, 'Итого, руб., в т.ч. НДС');
    set(18, 10, 500);
    set(19, 4, 'НДС 20%');
    set(19, 10, 83);
    // черновой расчёт автора книги далеко справа от таблицы
    set(6, 40, 286954351.248);

    const parsed = parseKs6(await grid(wb, 'КС-6'));
    const corpus = parsed.items.filter((i) => i.name.startsWith('Устройство стенки'));
    expect(corpus.map((i) => i.kind)).toEqual(['nomenclature', 'nomenclature', 'nomenclature']);
    expect(parsed.warnings.filter((w) => w.includes('агрегирующая'))).toEqual([]);
    expect(parsed.warnings.filter((w) => w.includes('не похожа на период'))).toEqual([]);
  });

  it('понятная ошибка, если на листе нет таблицы работ', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Другой лист');
    ws.getRow(1).getCell(1).value = 'Просто текст';
    const g = await grid(wb, 'Другой лист');
    expect(() => parseKs6(g)).toThrow(/не найдена таблица работ/);
  });
});

describe('psdc-parser (синтетическая книга)', () => {
  it('разбирает разделы/КВР/номенклатуру и контрольные суммы', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('ПСДЦ');
    const set = (r: number, c: number, v: ExcelJS.CellValue) => (ws.getRow(r).getCell(c).value = v);
    set(5, 2, '№ п/п');
    set(5, 3, 'Код КВР');
    set(5, 8, 'Статья бюджета');
    set(5, 9, 'Вид');
    set(5, 10, 'Наименование работ и затрат');
    set(5, 11, 'Характеристика');
    set(5, 12, 'Кол-во');
    set(5, 13, 'Ед.изм.');
    set(5, 14, 'Цена за ед.изм., руб., в т.ч. НДС');
    set(5, 15, 'Стоимость');
    // числовая строка нумерации граф
    set(6, 10, 3);
    // раздел
    set(7, 10, 'Земляные работы');
    // КВР + номенклатура
    set(8, 3, '02П.01');
    set(8, 9, 'КВР');
    set(8, 10, 'Разработка грунта');
    set(8, 12, 100);
    set(8, 13, 'м3');
    set(8, 14, 10);
    set(8, 15, 1000);
    set(9, 3, '02П.01');
    set(9, 9, 'Номенклатура');
    set(9, 10, 'Разработка грунта механизированным способом');
    set(9, 11, 'с вывозом');
    set(9, 12, 100);
    set(9, 13, 'м3');
    set(9, 14, 10);
    set(9, 15, 1000);
    set(10, 10, 'Итого,руб., в т.ч. НДС');
    set(10, 15, 1000);

    const parsed = parsePsdc(await grid(wb, 'ПСДЦ'));
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[1]!.characteristic).toBe('с вывозом');
    expect(parsed.controls.contractTotal).toBe('1000.00');
    expect(parsed.ks2Columns).toHaveLength(0);
  });
});
