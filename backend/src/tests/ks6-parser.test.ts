import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseKs6 } from '../worker/parse-child/ks6-parser.js';
import { parsePsdc } from '../worker/parse-child/psdc-parser.js';

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
    const parsed = parseKs6(wb);

    expect(parsed.header.contractNumber).toBe('Д-1/24');
    expect(parsed.header.contractDate).toBe('2024-10-11');

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
    expect(nom!.unitPrice).toBe('30.00');
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
  });

  it('ошибка с перечнем видимых листов, если «КС-6» нет', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Другой лист');
    expect(() => parseKs6(wb)).toThrow(/нет видимого листа «КС-6».*Другой лист/);
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

    const parsed = parsePsdc(wb);
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[1]!.characteristic).toBe('с вывозом');
    expect(parsed.controls.contractTotal).toBe('1000.00');
    expect(parsed.ks2Columns).toHaveLength(0);
  });
});
