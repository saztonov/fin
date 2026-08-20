import type ExcelJS from 'exceljs';
import { detectAggregates } from './aggregate-pass.js';
import type { ParsedImport, ParsedItem, ParsedKs2Column, ParsedSection } from './parsed-schema.js';
import {
  cellDate,
  cellNum,
  cellText,
  findCol,
  findRow,
  getVisibleSheet,
  money2,
  parseRuDate,
  qty6,
} from './sheet-utils.js';

/**
 * Разбор листа «КС-6»: структура + договорные графы + помесячные пары
 * «Кол-во/Стоимость» каждого КС-2. Эвристики — docs/import-format.md.
 */
export function parseKs6(wb: ExcelJS.Workbook): ParsedImport {
  const ws = getVisibleSheet(wb, 'КС-6');
  const warnings: string[] = [];

  const headerRow = findRow(ws, 1, 40, (t, r) => {
    let hasNo = false;
    let hasKvr = false;
    let hasName = false;
    for (let c = 1; c <= 15; c++) {
      const t2 = cellText(ws, r, c);
      if (t2 === '№ п/п') hasNo = true;
      if (t2 === 'Код КВР') hasKvr = true;
      if (t2.startsWith('Наименование работ')) hasName = true;
    }
    return hasNo && hasKvr && hasName;
  });
  if (!headerRow) {
    throw new Error('Не найдена шапка таблицы листа «КС-6» (№ п/п / Код КВР / Наименование работ)');
  }
  const subRow = headerRow + 1;
  const labelsRow = headerRow - 1;
  const datesRow = headerRow - 2;

  const colKvr = findCol(ws, headerRow, (t) => t === 'Код КВР')!;
  const colName = findCol(ws, headerRow, (t) => t.startsWith('Наименование работ'))!;
  const colUnit = findCol(ws, subRow, (t) => t.startsWith('Ед.'));
  const colQty = findCol(ws, subRow, (t) => t.startsWith('Кол-во един'));
  const colPrice = findCol(ws, subRow, (t) => t.startsWith('Цена за ед'));
  const colMat = findCol(ws, subRow, (t) => t.includes('материала'));
  const colWork = findCol(ws, subRow, (t) => t.includes('работ на ед'));
  const colTotal = findCol(ws, subRow, (t) => t.startsWith('Всего'));
  if (!colUnit || !colQty || !colTotal) {
    throw new Error('Не удалось сопоставить договорные графы листа «КС-6»');
  }

  // колонка «Вид» — из цифровой строки под подзаголовками
  let colVid: number | null = null;
  let dataStart: number | null = null;
  for (let r = subRow + 1; r <= subRow + 3; r++) {
    const c = findCol(ws, r, (t) => t === 'Вид', 15);
    if (c) {
      colVid = c;
      dataStart = r + 1;
      break;
    }
  }
  if (!colVid || !dataStart) {
    throw new Error('Не найдена колонка «Вид» листа «КС-6»');
  }

  // контрольная пара «Выполнение с нач.ст-ва»
  const execGroupCol = findCol(ws, headerRow, (t) => t.includes('нач.ст-ва') || t.includes('нач. ст-ва'));
  const execAmountCol = execGroupCol ? execGroupCol + 1 : null;

  // помесячные пары от колонки после контрольной до «Остаток»
  const pairs: { qtyCol: number; amountCol: number }[] = [];
  const startScan = (execGroupCol ?? colTotal) + 2;
  const lastCol = Math.min(ws.columnCount, 120);
  for (let c = startScan; c <= lastCol; c++) {
    const t = cellText(ws, subRow, c);
    if (t !== 'Кол-во') continue;
    const tNext = cellText(ws, subRow, c + 1);
    if (!tNext.startsWith('Стоимость')) continue;
    const label = `${cellText(ws, labelsRow, c)} ${cellText(ws, labelsRow, c + 1)}`.trim();
    if (label.includes('Остаток') || label.includes('Выполнено')) break;
    pairs.push({ qtyCol: c, amountCol: c + 1 });
    c += 1;
  }

  // строки данных
  const sections: ParsedSection[] = [];
  const items: ParsedItem[] = [];
  let lastL1: ParsedSection | null = null;
  let currentSection: ParsedSection | null = null;
  let lastKvr: ParsedItem | null = null;
  let seq = 0;
  const nextId = (p: string) => `${p}${++seq}`;

  const ensureSection = (rowNumber: number): ParsedSection => {
    if (currentSection) return currentSection;
    const s: ParsedSection = {
      tmpId: nextId('s'),
      parentTmpId: null,
      name: 'Без раздела',
      level: 1,
      rowNumber,
    };
    sections.push(s);
    warnings.push(`Строка ${rowNumber}: работы до первого раздела — создан раздел «Без раздела»`);
    currentSection = s;
    lastL1 = s;
    return s;
  };

  let controlsTotal: string | null = null;
  let controlsVat: string | null = null;
  let controlsExecuted: string | null = null;
  let totalsRow: number | null = null;

  const maxRow = ws.rowCount;
  for (let r = dataStart; r <= maxRow; r++) {
    const name = cellText(ws, r, colName);
    const vid = cellText(ws, r, colVid);
    if (!name && !vid) continue;

    if (name.startsWith('Итого')) {
      totalsRow = r;
      controlsTotal = money2(cellNum(ws, r, colTotal));
      controlsExecuted = execAmountCol ? money2(cellNum(ws, r, execAmountCol)) : null;
      for (let r2 = r + 1; r2 <= Math.min(r + 3, maxRow); r2++) {
        if (cellText(ws, r2, colName).includes('НДС')) {
          controlsVat = money2(cellNum(ws, r2, colTotal));
          break;
        }
      }
      break;
    }

    const unit = colUnit ? cellText(ws, r, colUnit) : '';
    const qty = colQty ? cellNum(ws, r, colQty) : null;
    const price = colPrice ? cellNum(ws, r, colPrice) : null;
    const total = cellNum(ws, r, colTotal);

    const isKvr = vid === 'КВР';
    const isNom = vid === 'Номенклатура';
    // разделы в файле несут суммы в графах цены/итога, поэтому признак строки
    // работ — только заполненная единица измерения
    const looksLikeItem = Boolean(unit);

    if (isKvr || isNom || (name && looksLikeItem)) {
      if (!name) {
        warnings.push(`Строка ${r}: значения без наименования — строка пропущена`);
        continue;
      }
      const section = ensureSection(r);
      const kind = isKvr ? 'kvr' : 'nomenclature';
      const item: ParsedItem = {
        tmpId: nextId('i'),
        sectionTmpId: section.tmpId,
        kind,
        kvrTmpId: kind === 'kvr' ? null : (lastKvr?.tmpId ?? null),
        kvrCode: cellText(ws, r, colKvr),
        name,
        characteristic: '',
        unit,
        contractQty: qty6(qty) ?? '0',
        unitPrice: money2(price) ?? '0.00',
        materialUnitCost: colMat ? money2(cellNum(ws, r, colMat)) : null,
        workUnitCost: colWork ? money2(cellNum(ws, r, colWork)) : null,
        contractTotal: money2(total) ?? '0.00',
        budgetArticle: '',
        rowNumber: r,
      };
      if (!isKvr && !isNom) {
        warnings.push(`Строка ${r}: «${name.slice(0, 60)}» без колонки «Вид» — принята как номенклатура`);
      }
      if (kind === 'nomenclature' && !item.kvrCode) {
        warnings.push(`Строка ${r}: номенклатура без кода КВР — привязана к предыдущему КВР`);
      }
      items.push(item);
      if (kind === 'kvr') lastKvr = item;
      continue;
    }

    if (!name) continue;

    // раздел
    const hasTotal = total !== null && total !== 0;
    const level = hasTotal || !lastL1 ? 1 : 2;
    const section: ParsedSection = {
      tmpId: nextId('s'),
      parentTmpId: level === 2 ? (lastL1?.tmpId ?? null) : null,
      name,
      level,
      rowNumber: r,
    };
    sections.push(section);
    if (level === 1) lastL1 = section;
    currentSection = section;
    lastKvr = null;
    if (!hasTotal && level === 2) {
      warnings.push(
        `Строка ${r}: «${name.slice(0, 60)}» принята как подраздел (возможно, аннотация — проверьте)`,
      );
    }
  }

  if (!totalsRow) warnings.push('Строка «Итого» не найдена — контрольные суммы файла недоступны');

  // агрегирующие строки, помеченные «Номенклатура», переводим в КВР до сбора ячеек
  detectAggregates(items, warnings);

  // помесячные колонки: метаданные + ячейки только по номенклатуре
  const nomItems = items.filter((i) => i.kind === 'nomenclature');
  const ks2Columns: ParsedKs2Column[] = [];
  let colIndex = 0;
  for (const pair of pairs) {
    const labelQ = cellText(ws, labelsRow, pair.qtyCol);
    const labelA = cellText(ws, labelsRow, pair.amountCol);
    const label = (labelQ || labelA || '').trim() || null;
    const monthDate = cellDate(ws, datesRow, pair.qtyCol) ?? cellDate(ws, datesRow, pair.amountCol);

    let number: string | null = null;
    let periodFrom: string | null = null;
    let periodTo: string | null = null;
    let docDate: string | null = null;
    if (label) {
      const mNum = label.match(/КС-2\s*№\s*([^\s(]+)/i);
      if (mNum) number = mNum[1] ?? null;
      const mRange = label.match(/(\d{1,2}\.\d{1,2}\.\d{2,4})\s*[-–—]\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/);
      if (mRange) {
        periodFrom = parseRuDate(mRange[1]!);
        periodTo = parseRuDate(mRange[2]!);
      } else {
        const mFrom = label.match(/от\s+(\d{1,2}\.\d{1,2}\.\d{2,4})/i);
        if (mFrom) docDate = parseRuDate(mFrom[1]!);
      }
    }

    const cells: ParsedKs2Column['cells'] = [];
    for (const item of nomItems) {
      const q = cellNum(ws, item.rowNumber, pair.qtyCol);
      const a = cellNum(ws, item.rowNumber, pair.amountCol);
      if ((q === null || q === 0) && (a === null || a === 0)) continue;
      cells.push({
        itemTmpId: item.tmpId,
        qty: qty6(q) ?? '0',
        amount: money2(a) ?? '0.00',
      });
    }

    // пустые будущие колонки без метаданных пропускаем
    if (cells.length === 0 && !label && !monthDate) continue;
    if (cells.length === 0) continue;

    ks2Columns.push({
      index: colIndex++,
      label,
      number,
      monthDate,
      docDate,
      periodFrom,
      periodTo,
      cells,
    });
    if (!label && !monthDate) {
      warnings.push(
        `Колонка выполнения №${colIndex} (столбец ${pair.qtyCol}) без подписи и даты — укажите номер и период вручную`,
      );
    } else if (!periodFrom && !monthDate) {
      warnings.push(`Колонка «${label ?? colIndex}» без периода — уточните период перед применением`);
    }
  }

  // реквизиты договора и ДС из шапки документа
  let contractNumber: string | null = null;
  let contractDate: string | null = null;
  let amendmentNumber: string | null = null;
  let amendmentDate: string | null = null;
  for (let r = 1; r < headerRow - 3; r++) {
    for (let c = 1; c <= 20; c++) {
      const t = cellText(ws, r, c);
      if (t.startsWith('Договор подряда') || t.startsWith('Дополнительное соглашение')) {
        const isContract = t.startsWith('Договор');
        for (let rr = r; rr <= r + 1; rr++) {
          for (let cc = c; cc <= Math.min(c + 8, 25); cc++) {
            const key = cellText(ws, rr, cc);
            if (key === 'номер') {
              const val = cellText(ws, rr, cc + 1);
              if (isContract && !contractNumber) contractNumber = val || null;
              if (!isContract && !amendmentNumber) amendmentNumber = val || null;
            }
            if (key === 'дата') {
              const val = cellDate(ws, rr, cc + 1) ?? parseRuDate(cellText(ws, rr, cc + 1));
              if (isContract && !contractDate) contractDate = val;
              if (!isContract && !amendmentDate) amendmentDate = val;
            }
          }
        }
      }
    }
  }

  return {
    kind: 'ks6',
    header: { contractNumber, contractDate, amendmentNumber, amendmentDate },
    sections,
    items,
    ks2Columns,
    controls: {
      contractTotal: controlsTotal,
      vat: controlsVat,
      executedTotal: controlsExecuted,
    },
    warnings,
  };
}
