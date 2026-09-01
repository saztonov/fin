import { describe, expect, it } from 'vitest';
import {
  classifyGroup,
  classifyHeader,
  isPeriodLabel,
  normHeader,
  parsePeriodLabel,
} from '../worker/parse-child/header-dictionary.js';
import {
  classifyRow,
  depthFromCode,
  isDocumentTotalRow,
  isTotalRow,
  type RowFacts,
} from '../worker/parse-child/row-classify.js';

/**
 * Заголовки и подписи взяты из реальных книг заказчиков (temp/КС): Дом_56, ЗИЛ,
 * Инджой, Кинг, Примавера, Садовническая, Событие, Сторис.
 */
describe('normHeader', () => {
  it('снимает НДС-суффиксы, рубли и скобочные пояснения', () => {
    expect(normHeader('Стоимость, руб. с НДС 22%')).toBe('стоимость');
    expect(normHeader('Цена за ед. изм., руб, в т.ч. НДС')).toBe('цена за ед изм');
    expect(normHeader('Стоимость ВСЕГО (руб. с НДС 22%)')).toBe('стоимость всего');
    expect(normHeader('Общая ст-ть в руб.')).toBe('общая ст-ть');
    expect(normHeader('цена за единицу, руб. без НДС')).toBe('цена за единицу');
  });
});

describe('classifyHeader', () => {
  it('узнаёт договорные графы во всех встреченных формулировках', () => {
    expect(classifyHeader('№ п/п')).toBe('posNo');
    expect(classifyHeader('№п/п')).toBe('posNo');
    expect(classifyHeader('Наименование видов работ и затрат')).toBe('name');
    expect(classifyHeader('Ед. изм.')).toBe('unit');
    expect(classifyHeader('Объем по договору')).toBe('qty');
    expect(classifyHeader('Количество*')).toBe('qty');
    expect(classifyHeader('Единичная расценка в руб.')).toBe('unitPrice');
    expect(classifyHeader('Общая ст-ть в руб.')).toBe('total');
    expect(classifyHeader('Вид')).toBe('kind');
    expect(classifyHeader('Код статьи затрат')).toBe('budgetArticle');
  });

  it('разделяет материалы и работы, в том числе по заголовку группы', () => {
    expect(classifyHeader('Ст-ть Материала')).toBe('materialTotal');
    expect(classifyHeader('Ст-ть Работ')).toBe('workTotal');
    expect(classifyHeader('Стоимость материала на ед. изм., руб')).toBe('materialUnitPrice');
    expect(classifyHeader('Цена за ед. изм. (руб. с НДС 22%)', 'Материалы')).toBe(
      'materialUnitPrice',
    );
    expect(classifyHeader('Стоимость за объём (руб. с НДС 22%)', 'Работы')).toBe('workTotal');
  });
});

describe('подписи блоков выполнения', () => {
  it('отличает период от контрольной графы', () => {
    expect(classifyGroup('Акт № 1 от 31.01.2026')).toBe('period');
    expect(classifyGroup('КС2№1 01.12.2025-18.02.2026')).toBe('period');
    expect(classifyGroup('ВЫПОЛНЕНО С НАЧАЛА СТРОИТЕЛЬСТВА')).toBe('executed');
    expect(classifyGroup('Стоимость фактически выполненных работ с начала строительства')).toBe(
      'executed',
    );
    expect(classifyGroup('Остаток от договора')).toBe('remainder');
    expect(classifyGroup('не печатать')).toBe('unknown');
    expect(isPeriodLabel('2026-01-01')).toBe(true);
    expect(isPeriodLabel('Июнь')).toBe(true);
  });

  it('вытаскивает номер и период из подписи', () => {
    expect(parsePeriodLabel('Акт № 23 от 28.02.2026')).toMatchObject({
      number: '23',
      docDate: '2026-02-28',
    });
    expect(parsePeriodLabel('КС №9 от 10.01.2025г.')).toMatchObject({ number: '9' });
    expect(parsePeriodLabel('КС2№2 19.02.2026-04.03.2026')).toMatchObject({
      number: '2',
      periodFrom: '2026-02-19',
      periodTo: '2026-03-04',
    });
    expect(parsePeriodLabel('№ 12 от 29.09.2023 СМР бетон')).toMatchObject({
      number: '12',
      docDate: '2023-09-29',
    });
    // голая дата приходит из датовой ячейки уже как ISO
    expect(parsePeriodLabel('2026-03-01')).toMatchObject({ monthDate: '2026-03-01' });
    // месяц без года — год восстанавливается уровнем выше, по порядку колонок
    expect(parsePeriodLabel('Июль')).toMatchObject({ monthIndex: 6, monthDate: null });
  });
});

describe('классификация строк', () => {
  const base: RowFacts = {
    kindText: '',
    levelText: '',
    posNo: '',
    code: '',
    codeRole: null,
    name: 'Работы',
    unit: '',
    unitColumnPresent: true,
    kindColumnUsed: false,
    sublineMarkerUsed: false,
    qty: null,
    unitPrice: null,
    total: null,
    bold: false,
  };

  it('«Вид» главнее всего, пустой «Вид» на заполненном листе — детализация', () => {
    expect(classifyRow({ ...base, kindText: 'КВР', unit: 'м3' }).kind).toBe('kvr');
    expect(classifyRow({ ...base, kindText: 'Номенклатура', unit: 'м3' }).kind).toBe(
      'nomenclature',
    );
    expect(classifyRow({ ...base, kindText: 'в т.ч.', unit: 'м3' }).kind).toBe('subline');
    // на листе, размечающем детализацию, пустой «Вид» у строки с ед. изм. — тоже детализация
    expect(
      classifyRow({ ...base, kindColumnUsed: true, sublineMarkerUsed: true, unit: 'м3' }).kind,
    ).toBe('subline');
    // если разметки детализации на листе нет — это обычная номенклатура
    expect(classifyRow({ ...base, kindColumnUsed: true, unit: 'м3' }).kind).toBe('nomenclature');
    // свой текст в «Виде» («не в системе») — тоже строка сметы
    expect(classifyRow({ ...base, kindText: 'не в системе' }).kind).toBe('nomenclature');
    expect(classifyRow({ ...base, kindColumnUsed: false, unit: 'м3' }).kind).toBe('nomenclature');
  });

  it('уровень берётся из колонки «Уровень N» или из точечного шифра', () => {
    expect(classifyRow({ ...base, levelText: 'Уровень 5' })).toMatchObject({
      kind: 'section',
      depth: 5,
    });
    expect(classifyRow({ ...base, code: '01.01.02.01' })).toMatchObject({
      kind: 'section',
      depth: 4,
    });
    expect(depthFromCode('1.1.1.')).toBe(3);
    expect(depthFromCode('не число')).toBeNull();
  });

  it('разделы несут суммы, поэтому позицию определяет ед. изм.', () => {
    expect(classifyRow({ ...base, total: 300, unitPrice: 300 }).kind).toBe('section');
    expect(classifyRow({ ...base, total: 300, unit: 'компл' }).kind).toBe('nomenclature');
  });

  it('итог документа отличается от итога раздела', () => {
    expect(isTotalRow('Итого по разделу 3')).toBe(true);
    expect(isDocumentTotalRow('Итого по разделу 3')).toBe(false);
    expect(isDocumentTotalRow('ИТОГО, руб. с НДС 20%')).toBe(true);
    expect(isDocumentTotalRow('Всего по Объекту')).toBe(true);
    expect(isDocumentTotalRow('Устройство стяжки')).toBe(false);
  });
});
