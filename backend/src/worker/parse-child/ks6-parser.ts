import { detectAggregates } from './aggregate-pass.js';
import { detectHeader, type HeaderLayout } from './header-detect.js';
import { normHeader } from './header-dictionary.js';
import { detectPeriodGroups } from './period-groups.js';
import {
  TOTALS_EPS,
  type ParsedImport,
  type ParsedItem,
  type ParsedKs2Column,
  type ParsedSection,
} from './parsed-schema.js';
import { classifyRow, isDocumentTotalRow, isTotalRow, type RowFacts } from './row-classify.js';
import {
  cellDate,
  cellDecimal,
  cellNum,
  cellText,
  isBold,
  money2,
  parseRuDate,
  price6,
  qty6,
} from './sheet-utils.js';
import { dec } from '../../lib/money.js';
import type { SheetGrid } from './xlsx-reader.js';

/**
 * Разбор накопительной ведомости КС-6.
 *
 * Формат листа не фиксирован: шапка ищется скорингом (header-detect), графы —
 * по словарю синонимов (header-dictionary), блоки выполнения — по повторяющемуся
 * шаблону граф (period-groups), а вид строки — по «Виду»/«Уровню»/шифру
 * (row-classify). Контрольные графы («Выполнено всего», «Остаток») и строки
 * «Итого» из файла не импортируются: портал считает их сам, файл служит сверкой.
 */
export function parseKs6(ws: SheetGrid): ParsedImport {
  return parseSheet(ws, 'ks6');
}

/** ПСДЦ — та же таблица без граф выполнения. */
export function parseSheet(ws: SheetGrid, kind: 'psdc' | 'ks6'): ParsedImport {
  const warnings: string[] = [];
  const layout = detectHeader(ws);
  if (!layout) {
    throw new Error(
      `На листе «${ws.name}» не найдена таблица работ: нужна строка заголовков с наименованием работ ` +
        'и хотя бы одной из граф «Ед. изм.», «Кол-во», «Стоимость».',
    );
  }

  const yearHint = detectYearHint(ws, layout);
  const groups =
    kind === 'ks6'
      ? detectPeriodGroups(ws, layout, { yearHint })
      : { periods: [], controls: [], warnings: [] };
  warnings.push(...groups.warnings);

  const cols = layout.cols;
  const colName = cols.name!;
  const items: ParsedItem[] = [];
  const sections: ParsedSection[] = [];
  const stack: ParsedSection[] = [];
  let lastKvr: ParsedItem | null = null;
  let lastNomenclature: ParsedItem | null = null;
  let seq = 0;
  const nextId = (p: string) => `${p}${++seq}`;
  // строки, чей вид взят из колонки «Вид»: эвристика подбора агрегатов по совпадению
  // сумм их не трогает. «Уровень» и точечный шифр сюда не входят — они задают только
  // глубину, а агрегат от обычной позиции не отличают
  const explicitKinds = new Set<string>();

  const pushSection = (name: string, depth: number, row: number, total: number | null = null): ParsedSection => {
    // глубина не выведена из файла: раздел с суммой считаем верхним уровнем,
    // раздел без суммы — вложенным в текущий (так устроены ПСДЦ и КС-6 СУ-10)
    const guessed = depth > 0 ? depth : total ? 1 : (stack[stack.length - 1]?.level ?? 0) + 1;
    const level = Math.max(1, Math.min(guessed, 12));
    while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
    const section: ParsedSection = {
      tmpId: nextId('s'),
      parentTmpId: stack.length ? stack[stack.length - 1]!.tmpId : null,
      name,
      level,
      rowNumber: row,
    };
    sections.push(section);
    stack.push(section);
    lastKvr = null;
    lastNomenclature = null;
    return section;
  };

  const ensureSection = (row: number): ParsedSection => {
    if (stack.length) return stack[stack.length - 1]!;
    warnings.push(`Строка ${row}: работы до первого раздела — создан раздел «Без раздела»`);
    return pushSection('Без раздела', 1, row);
  };

  let controlsTotal: string | null = null;
  let controlsVat: string | null = null;
  let controlsExecuted: string | null = null;
  let totalsRowSeen = false;

  const execControl = groups.controls.find((c) => c.role === 'executed') ?? null;
  const kindStats = cols.kind ? countKindValues(ws, layout, cols.kind) : { items: 0, sublines: 0 };
  const kindColumnUsed = kindStats.items >= 5;
  const sublineMarkerUsed = kindStats.sublines >= 3;
  // накопленная сумма номенклатуры — по ней отличаем итог документа от итога раздела
  let nomAccum = dec(0);

  for (let r = layout.dataStartRow; r <= ws.rowCount; r++) {
    const name = cellText(ws, r, colName);
    if (!name) continue;

    // строка «цифровой нумерации граф» иногда стоит не сразу под шапкой
    if (/^\d{1,3}$/.test(name) && !(cols.unit && cellText(ws, r, cols.unit))) continue;

    // точные значения для записи; в RowFacts ниже идут те же числа как double —
    // там они нужны только для распознавания вида строки
    const qtyRaw = cols.qty ? cellDecimal(ws, r, cols.qty) : null;
    const priceRaw = cols.unitPrice ? cellDecimal(ws, r, cols.unitPrice) : null;
    const totalRaw = cols.total ? cellDecimal(ws, r, cols.total) : null;

    const facts: RowFacts = {
      kindText: cols.kind ? cellText(ws, r, cols.kind) : '',
      levelText: cols.level ? cellText(ws, r, cols.level) : '',
      posNo: cols.posNo ? cellText(ws, r, cols.posNo) : '',
      code: cols.code ? cellText(ws, r, cols.code) : '',
      name,
      unit: cols.unit ? cellText(ws, r, cols.unit) : '',
      unitColumnPresent: cols.unit !== undefined,
      kindColumnUsed,
      sublineMarkerUsed,
      qty: qtyRaw === null ? null : Number(qtyRaw),
      unitPrice: priceRaw === null ? null : Number(priceRaw),
      total: totalRaw === null ? null : Number(totalRaw),
      bold: isBold(ws, r, colName),
    };

    const verdict = classifyRow(facts);

    if (verdict.kind === 'total') {
      // «Итого по разделу» посреди таблицы чтение не прерывает. А вот итог всего
      // документа прерывает: у Инджоя после него в книге лежит ещё один вариант
      // сметы, и без остановки суммы удваиваются.
      const total = facts.total;
      const isGrandTotal =
        total !== null &&
        nomAccum.gt(0) &&
        dec(totalRaw!).gte(nomAccum.mul(0.95)) &&
        isDocumentTotalRow(name);
      if (
        totalRaw !== null &&
        (isGrandTotal || controlsTotal === null || dec(totalRaw).gt(dec(controlsTotal)))
      ) {
        controlsTotal = money2(totalRaw);
        controlsExecuted = execControl
          ? money2(cellDecimal(ws, r, execControl.amountCol))
          : null;
      }
      totalsRowSeen = true;
      for (let r2 = r + 1; r2 <= Math.min(r + 3, ws.rowCount); r2++) {
        if (cellText(ws, r2, colName).includes('НДС') && cols.total) {
          controlsVat = money2(cellDecimal(ws, r2, cols.total));
          break;
        }
      }
      if (isGrandTotal) {
        // под итогом обычно лежат «НДС», «БЕЗ НДС» и пустые строки с черновыми
        // числами автора файла — терять там нечего; предупреждаем только когда ниже
        // действительно есть строки сметы (у Инджоя это второй вариант сметы)
        const lost = countDataRowsBelow(ws, colName, cols.total, r);
        if (lost > 0) {
          warnings.push(`Строка ${r}: итог документа — данные ниже (${lost} строк) не читались`);
        }
        break;
      }
      continue;
    }

    if (verdict.kind === 'section') {
      pushSection(name, verdict.depth, r, facts.total);
      continue;
    }

    const section = ensureSection(r);
    const kind = verdict.kind;
    const parentTmpId =
      kind === 'subline'
        ? (lastNomenclature?.tmpId ?? lastKvr?.tmpId ?? null)
        : kind === 'nomenclature'
          ? (lastKvr?.tmpId ?? null)
          : null;

    const item: ParsedItem = {
      tmpId: nextId('i'),
      sectionTmpId: section.tmpId,
      kind,
      kvrTmpId: parentTmpId,
      kvrCode: cols.code ? cellText(ws, r, cols.code) : '',
      name,
      characteristic: cols.characteristic ? cellText(ws, r, cols.characteristic) : '',
      unit: facts.unit,
      contractQty: qty6(qtyRaw) ?? '0',
      unitPrice: price6(priceRaw) ?? '0',
      materialUnitCost: cols.materialUnitPrice
        ? price6(cellDecimal(ws, r, cols.materialUnitPrice))
        : null,
      workUnitCost: cols.workUnitPrice ? price6(cellDecimal(ws, r, cols.workUnitPrice)) : null,
      contractTotal: money2(totalRaw) ?? '0.00',
      // контрольная графа «Выполнено с начала строительства» по этой строке: портал
      // считает накопительный итог сам, а файловое значение хранится для сверки
      fileExecutedTotal: execControl ? money2(cellDecimal(ws, r, execControl.amountCol)) : null,
      budgetArticle: cols.budgetArticle ? cellText(ws, r, cols.budgetArticle) : '',
      rowNumber: r,
    };
    items.push(item);
    if (verdict.source === 'kind-column') explicitKinds.add(item.tmpId);
    if (kind === 'kvr') lastKvr = item;
    if (kind === 'nomenclature') {
      lastNomenclature = item;
      nomAccum = nomAccum.add(dec(item.contractTotal));
    }
  }

  if (!totalsRowSeen) {
    warnings.push('Строка «Итого» не найдена — контрольные суммы файла недоступны');
  }

  // Агрегирующие строки («Прижимная стена» = сумма 7 строк ниже) там, где вид строки
  // из файла не выводится: у строк с явной колонкой «Вид» совпадение сумм ничего не
  // значит (ЗИЛ: 30 обычных позиций с одинаковыми расценками по корпусам).
  detectAggregates(items, warnings, explicitKinds);

  const nomItems = items.filter((i) => i.kind === 'nomenclature');

  // сверка с контрольными суммами файла: расхождение не блокирует импорт
  // (источник истины — строки номенклатуры), но должно быть видно в предпросмотре
  if (controlsTotal !== null) {
    const sum = nomItems.reduce((acc, i) => acc.add(dec(i.contractTotal)), dec(0));
    const diff = sum.sub(dec(controlsTotal));
    // Допуск текстового предупреждения абсолютный, а не в процентах: на договоре в
    // 18 млрд «0,1 %» — это 18 млн рублей, потеря такого масштаба прошла бы молча.
    // Копеечные неувязки самих файлов в рубль укладываются и в предупреждение не
    // выносятся — их видно точечно в гриде КС-6 (подсветка расхождений с файлом).
    if (diff.abs().gt(TOTALS_EPS)) {
      warnings.push(
        `Σ строк номенклатуры ${sum.toFixed(2)} расходится с «Итого» файла ${controlsTotal} ` +
          `на ${diff.toFixed(2)} — проверьте, тот ли лист и не задваиваются ли строки`,
      );
    }
  }

  const ks2Columns: ParsedKs2Column[] = [];
  let index = 0;
  for (const g of groups.periods) {
    const cells: ParsedKs2Column['cells'] = [];
    for (const item of nomItems) {
      const q = g.qtyCol === null ? null : cellDecimal(ws, item.rowNumber, g.qtyCol);
      const a = cellDecimal(ws, item.rowNumber, g.amountCol);
      if ((q === null || dec(q).isZero()) && (a === null || dec(a).isZero())) continue;
      cells.push({ itemTmpId: item.tmpId, qty: qty6(q) ?? '0', amount: money2(a) ?? '0.00' });
    }
    if (cells.length === 0) continue;
    ks2Columns.push({
      index: index++,
      label: g.label || null,
      number: g.meta.number,
      monthDate: g.meta.monthDate,
      docDate: g.meta.docDate,
      periodFrom: g.meta.periodFrom,
      periodTo: g.meta.periodTo,
      cells,
    });
  }

  return {
    kind,
    sheetName: ws.name,
    sheetCandidates: [],
    vat: detectVat(ws, layout),
    sections,
    items,
    ks2Columns,
    controls: { contractTotal: controlsTotal, vat: controlsVat, executedTotal: controlsExecuted },
    warnings,
  };
}

/**
 * Сколько строк сметы осталось под итогом документа. Не считаются пустые строки,
 * контрольные («НДС», «БЕЗ НДС», «Итого по …») и текст без денег — под итогом обычно
 * лежат подписи сторон и черновые расчёты автора книги. Строка сметы — это строка с
 * наименованием и суммой (у Инджоя под итогом лежит второй вариант сметы, и вот о
 * нём предупредить нужно).
 */
function countDataRowsBelow(
  ws: SheetGrid,
  colName: number,
  totalCol: number | undefined,
  totalRow: number,
): number {
  let count = 0;
  for (let r = totalRow + 1; r <= ws.rowCount; r++) {
    const name = cellText(ws, r, colName);
    if (!name || isTotalRow(name)) continue;
    if (totalCol !== undefined && cellNum(ws, r, totalCol) === null) continue;
    count += 1;
  }
  return count;
}

/** Насколько лист заполняет графу «Вид»: позиции сметы и пометки детализации. */
function countKindValues(
  ws: SheetGrid,
  layout: HeaderLayout,
  col: number,
): { items: number; sublines: number } {
  let items = 0;
  let sublines = 0;
  const to = Math.min(ws.rowCount, layout.dataStartRow + 3000);
  for (let r = layout.dataStartRow; r <= to; r++) {
    const t = cellText(ws, r, col).toLowerCase().replace(/\s+/g, ' ').trim();
    if (t === 'квр' || t === 'номенклатура') items += 1;
    else if (t.startsWith('в т.ч') || t.startsWith('в тч') || t === 'в том числе') sublines += 1;
    if (items >= 5 && sublines >= 3) break;
  }
  return { items, sublines };
}

/** Год для подписей-месяцев без года: из имени листа или из шапки документа. */
function detectYearHint(ws: SheetGrid, layout: HeaderLayout): number | null {
  const fromName = /(20\d{2})/.exec(ws.name)?.[1];
  if (fromName) return Number(fromName);
  for (let r = 1; r < layout.headerRow; r++) {
    for (let c = 1; c <= Math.min(ws.columnCount, 30); c++) {
      const t = cellText(ws, r, c);
      if (!t) continue;
      const m = /за\s+(20\d{2})\s*год/i.exec(t) ?? /(20\d{2})\s*год/i.exec(t);
      if (m) return Number(m[1]);
    }
  }
  return null;
}

/**
 * Ставка НДС и режим цен из подписей граф: «Стоимость, руб. с НДС 22%» → 22 брутто,
 * «цена за единицу, руб. без НДС» → режим «без НДС».
 */
function detectVat(ws: SheetGrid, layout: HeaderLayout): { rate: number | null; mode: 'gross' | 'net' | null } {
  let rate: number | null = null;
  let mode: 'gross' | 'net' | null = null;
  const from = layout.headerRow;
  const to = layout.headerRow + layout.headerHeight - 1;
  for (let r = from; r <= to; r++) {
    for (let c = 1; c <= layout.lastContractCol; c++) {
      const t = cellText(ws, r, c).toLowerCase();
      if (!t.includes('ндс')) continue;
      if (/без\s*ндс/.test(t)) {
        mode ??= 'net';
        continue;
      }
      const m = /ндс[\s-]*(\d{1,2})\s*%/.exec(t) ?? /(\d{1,2})\s*%[^%]*ндс/.exec(t);
      if (m) {
        rate ??= Number(m[1]);
        mode = 'gross';
      } else if (/(с|в т\.?ч\.?|включая)\s*ндс/.test(t)) {
        mode ??= 'gross';
      }
    }
  }
  return { rate, mode };
}

export { isTotalRow };
