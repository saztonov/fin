import type ExcelJS from 'exceljs';
import { detectAggregates } from './aggregate-pass.js';
import type { ParsedImport, ParsedItem, ParsedSection } from './parsed-schema.js';
import {
  cellNum,
  cellText,
  findCol,
  findRow,
  getVisibleSheet,
  isBold,
  money2,
  qty6,
} from './sheet-utils.js';

/**
 * Разбор листа «ПСДЦ»: структура (разделы → КВР → номенклатура) + договорные данные.
 * Эвристики описаны в docs/import-format.md.
 */
export function parsePsdc(wb: ExcelJS.Workbook): ParsedImport {
  const ws = getVisibleSheet(wb, 'ПСДЦ');
  const warnings: string[] = [];

  const headerRow = findRow(
    ws,
    1,
    30,
    (t, r) => {
      for (let c = 1; c <= 40; c++) {
        if (cellText(ws, r, c) === '№ п/п') {
          // в той же строке должны быть «Вид» и «Наименование работ…»
          let hasVid = false;
          let hasName = false;
          for (let c2 = 1; c2 <= 40; c2++) {
            const t2 = cellText(ws, r, c2);
            if (t2 === 'Вид') hasVid = true;
            if (t2.startsWith('Наименование работ')) hasName = true;
          }
          return hasVid && hasName;
        }
      }
      return false;
    },
  );
  if (!headerRow) throw new Error('Не найдена строка заголовков листа «ПСДЦ» (№ п/п / Вид / Наименование работ)');

  const col = {
    kvr: findCol(ws, headerRow, (t) => t === 'Код КВР'),
    budget: findCol(ws, headerRow, (t) => t.startsWith('Статья бюджета')),
    vid: findCol(ws, headerRow, (t) => t === 'Вид'),
    name: findCol(ws, headerRow, (t) => t.startsWith('Наименование работ')),
    characteristic: findCol(ws, headerRow, (t) => t.startsWith('Характеристика')),
    qty: findCol(ws, headerRow, (t) => t.startsWith('Кол-во')),
    unit: findCol(ws, headerRow, (t) => t.startsWith('Ед.') || t.startsWith('Ед изм')),
    price: findCol(ws, headerRow, (t) => t.startsWith('Цена за ед')),
    material: findCol(ws, headerRow, (t) => t.includes('материала')),
    work: findCol(ws, headerRow, (t) => t.includes('работ на ед') || t.startsWith('Ст-ть работ')),
    total: findCol(
      ws,
      headerRow,
      (t) => (t === 'Стоимость' || t.startsWith('Стоимость,')) && !t.includes('материал'),
    ),
  };
  if (!col.vid || !col.name) throw new Error('Не удалось сопоставить колонки листа «ПСДЦ»');

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

  const maxRow = ws.rowCount;
  for (let r = headerRow + 1; r <= maxRow; r++) {
    const name = cellText(ws, r, col.name);
    const vid = cellText(ws, r, col.vid);
    if (!name && !vid) continue;
    // строка цифровой нумерации граф под шапкой
    if (/^\d+$/.test(name) && !vid) continue;

    if (name.startsWith('Итого')) {
      controlsTotal = col.total ? money2(cellNum(ws, r, col.total)) : null;
      for (let r2 = r + 1; r2 <= Math.min(r + 3, maxRow); r2++) {
        if (cellText(ws, r2, col.name).includes('НДС')) {
          controlsVat = col.total ? money2(cellNum(ws, r2, col.total)) : null;
          break;
        }
      }
      break;
    }

    const qty = col.qty ? cellNum(ws, r, col.qty) : null;
    const unit = col.unit ? cellText(ws, r, col.unit) : '';
    const price = col.price ? cellNum(ws, r, col.price) : null;
    const total = col.total ? cellNum(ws, r, col.total) : null;

    if (vid === 'КВР' || vid === 'Номенклатура') {
      const section = ensureSection(r);
      const isKvr = vid === 'КВР';
      const item: ParsedItem = {
        tmpId: nextId('i'),
        sectionTmpId: section.tmpId,
        kind: isKvr ? 'kvr' : 'nomenclature',
        kvrTmpId: isKvr ? null : (lastKvr?.tmpId ?? null),
        kvrCode: col.kvr ? cellText(ws, r, col.kvr) : '',
        name,
        characteristic: col.characteristic ? cellText(ws, r, col.characteristic) : '',
        unit,
        contractQty: qty6(qty) ?? '0',
        unitPrice: money2(price) ?? '0.00',
        materialUnitCost: col.material ? money2(cellNum(ws, r, col.material)) : null,
        workUnitCost: col.work ? money2(cellNum(ws, r, col.work)) : null,
        contractTotal:
          money2(total) ?? money2((qty ?? 0) * (price ?? 0)) ?? '0.00',
        budgetArticle: col.budget ? cellText(ws, r, col.budget) : '',
        rowNumber: r,
      };
      if (!isKvr && !lastKvr) {
        warnings.push(`Строка ${r}: номенклатура без предшествующего КВР`);
      }
      items.push(item);
      if (isKvr) lastKvr = item;
      continue;
    }

    // строка без «Вид»: признак строки работ — только единица измерения
    // (разделы могут нести суммы в числовых графах)
    if (unit) {
      const section = ensureSection(r);
      items.push({
        tmpId: nextId('i'),
        sectionTmpId: section.tmpId,
        kind: 'nomenclature',
        kvrTmpId: lastKvr?.tmpId ?? null,
        kvrCode: col.kvr ? cellText(ws, r, col.kvr) : '',
        name,
        characteristic: col.characteristic ? cellText(ws, r, col.characteristic) : '',
        unit,
        contractQty: qty6(qty) ?? '0',
        unitPrice: money2(price) ?? '0.00',
        materialUnitCost: col.material ? money2(cellNum(ws, r, col.material)) : null,
        workUnitCost: col.work ? money2(cellNum(ws, r, col.work)) : null,
        contractTotal: money2(total) ?? '0.00',
        budgetArticle: col.budget ? cellText(ws, r, col.budget) : '',
        rowNumber: r,
      });
      warnings.push(`Строка ${r}: «${name.slice(0, 60)}» без колонки «Вид» — принята как номенклатура`);
      continue;
    }

    // раздел
    const bold = isBold(ws, r, col.name);
    const hasTotal = total !== null && total !== 0;
    const level = hasTotal || (bold && !lastL1) ? 1 : 2;
    const section: ParsedSection = {
      tmpId: nextId('s'),
      parentTmpId: level === 2 ? (lastL1?.tmpId ?? null) : null,
      name,
      level: level === 2 && !lastL1 ? 1 : level,
      rowNumber: r,
    };
    sections.push(section);
    if (level === 1) lastL1 = section;
    currentSection = section;
    lastKvr = null;
    if (!bold && !hasTotal) {
      warnings.push(`Строка ${r}: «${name.slice(0, 60)}» похожа на аннотацию — принята как подраздел`);
    }
  }

  // агрегирующие строки, помеченные «Номенклатура», переводим в КВР
  detectAggregates(items, warnings);

  // реквизиты договора из титульных строк
  let contractNumber: string | null = null;
  for (let r = 1; r < headerRow; r++) {
    for (let c = 1; c <= 15; c++) {
      const t = cellText(ws, r, c);
      const m = t.match(/договор[а-я]*\s+(?:генерального\s+подряда\s*)?№\s*([^\s,]+)/i);
      if (m) {
        contractNumber = m[1] ?? null;
        break;
      }
    }
    if (contractNumber) break;
  }

  return {
    kind: 'psdc',
    header: {
      contractNumber,
      contractDate: null,
      amendmentNumber: null,
      amendmentDate: null,
    },
    sections,
    items,
    ks2Columns: [],
    controls: { contractTotal: controlsTotal, vat: controlsVat, executedTotal: null },
    warnings,
  };
}
