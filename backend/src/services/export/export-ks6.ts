import ExcelJS from 'exceljs';
import type { Db } from '../../db/client.js';
import { constructionObjects } from '../../db/schema/index.js';
import { and, eq, isNull } from 'drizzle-orm';
import { ApiError } from '../../lib/errors.js';
import { vatFromGross } from '../../lib/money.js';
import { getKs6Grid } from '../ks6.service.js';
import { sanitizeCellText } from './sanitize.js';

const MONEY_FMT = '#,##0.00';
const QTY_FMT = '#,##0.###';

const thin = { style: 'thin' as const, color: { argb: 'FFB0B0B0' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

function fmtRuDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function toNum(s: string | null | undefined): number | null {
  if (s === null || s === undefined || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n !== 0 ? n : n === 0 ? null : null;
}

function toNumKeepZero(s: string | null | undefined): number | null {
  if (s === null || s === undefined || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Выгрузка КС-6 (накопительная ведомость) со всеми периодами, близко к образцу. */
export async function exportKs6(db: Db, objectId: string): Promise<{ buffer: Buffer; filename: string }> {
  const [object] = await db
    .select()
    .from(constructionObjects)
    .where(and(eq(constructionObjects.id, objectId), isNull(constructionObjects.deletedAt)));
  if (!object) throw ApiError.notFound('Объект не найден');
  const grid = await getKs6Grid(db, objectId);
  if (!grid.contract) throw ApiError.badRequest('По объекту не заведён договор', 'no_contract');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Портал КС';
  const ws = wb.addWorksheet('КС-6', {
    views: [{ state: 'frozen', xSplit: 4, ySplit: 0 }],
  });

  const periods = grid.periods;
  const firstPairCol = 12;
  const pairCol = (i: number) => firstPairCol + i * 2;
  const afterPairs = pairCol(periods.length);
  const colRemQty = afterPairs;
  const colRemAmt = afterPairs + 1;
  const colTotQty = afterPairs + 2;
  const colTotAmt = afterPairs + 3;
  const lastCol = colTotAmt;

  // ---- шапка документа ----
  const put = (row: number, col: number, value: ExcelJS.CellValue, opts?: { bold?: boolean }) => {
    const cell = ws.getRow(row).getCell(col);
    cell.value = typeof value === 'string' ? sanitizeCellText(value) : value;
    if (opts?.bold) cell.font = { bold: true };
    return cell;
  };

  put(1, 1, 'Заказчик:', { bold: true });
  put(1, 3, grid.contract.customerName);
  put(2, 1, 'Генподрядчик:', { bold: true });
  put(2, 3, grid.contract.contractorName);
  put(3, 1, 'Стройка:', { bold: true });
  put(3, 3, grid.contract.subject);
  put(4, 1, 'Объект:', { bold: true });
  put(4, 3, `${object.code} — ${object.name}${object.address ? `, ${object.address}` : ''}`);
  put(5, 1, 'Договор подряда:', { bold: true });
  put(5, 3, `№ ${grid.contract.number} от ${fmtRuDate(grid.contract.dateSigned)}`);
  const lastAmendment = grid.amendments[grid.amendments.length - 1];
  if (lastAmendment) {
    put(6, 1, 'Доп. соглашение:', { bold: true });
    put(6, 3, `№ ${lastAmendment.number} от ${fmtRuDate(lastAmendment.dateSigned)}`);
  }
  put(7, 1, 'ЖУРНАЛ УЧЁТА ВЫПОЛНЕННЫХ РАБОТ (КС-6, накопительная ведомость)', { bold: true });

  // ---- шапка таблицы ----
  const labelRow = 9; // подписи КС-2 №N + период
  const groupRow = 10; // группы граф
  const subRow = 11; // Кол-во / Стоимость
  const dataStart = 12;

  const groupHeaders: [number, number, string][] = [
    [1, 1, '№ п/п'],
    [2, 2, 'Код КВР'],
    [3, 3, 'Наименование работ'],
    [4, 4, 'Ед. изм.'],
    [5, 9, 'По договору (ПСДЦ)'],
    [10, 11, 'Выполнение с начала строительства'],
  ];
  for (const [c1, c2, title] of groupHeaders) {
    // одиночные графы растягиваются на оба яруса шапки, группы — только на верхний
    ws.mergeCells(groupRow, c1, c2 === c1 ? subRow : groupRow, c2);
    put(groupRow, c1, title, { bold: true });
  }
  // подзаголовки договорной группы
  const contractSubs: [number, string][] = [
    [5, 'Кол-во'],
    [6, 'Цена за ед., руб. с НДС'],
    [7, 'Ст-ть материала на ед., руб.'],
    [8, 'Ст-ть работ на ед., руб.'],
    [9, 'Всего, руб. с НДС'],
    [10, 'Кол-во'],
    [11, 'Стоимость, руб. с НДС'],
  ];
  for (const [c, title] of contractSubs) put(subRow, c, title, { bold: true });

  periods.forEach((p, i) => {
    const c = pairCol(i);
    const periodText = p.periodFrom
      ? `${fmtRuDate(p.periodFrom)}–${fmtRuDate(p.periodTo)}`
      : (p.importLabel ?? '');
    put(labelRow, c, `КС-2 №${p.number}${p.status === 'draft' ? ' (черновик)' : ''}`, { bold: true });
    ws.mergeCells(labelRow, c, labelRow, c + 1);
    put(groupRow, c, periodText || 'за отчётный период');
    ws.mergeCells(groupRow, c, groupRow, c + 1);
    put(subRow, c, 'Кол-во', { bold: true });
    put(subRow, c + 1, 'Стоимость, руб. с НДС', { bold: true });
  });

  put(groupRow, colRemQty, 'Остаток', { bold: true });
  ws.mergeCells(groupRow, colRemQty, groupRow, colRemAmt);
  put(subRow, colRemQty, 'Кол-во', { bold: true });
  put(subRow, colRemAmt, 'Стоимость, руб. с НДС', { bold: true });
  put(groupRow, colTotQty, 'Выполнено ВСЕГО', { bold: true });
  ws.mergeCells(groupRow, colTotQty, groupRow, colTotAmt);
  put(subRow, colTotQty, 'Кол-во', { bold: true });
  put(subRow, colTotAmt, 'Стоимость, руб. с НДС', { bold: true });

  for (let c = 1; c <= lastCol; c++) {
    for (const r of [groupRow, subRow, labelRow]) {
      const cell = ws.getRow(r).getCell(c);
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      if (r !== labelRow) cell.border = BORDER;
    }
  }

  // ---- данные ----
  const sectionFills: Record<number, string> = { 1: 'FFE9EDF3', 2: 'FFF2F4F7', 3: 'FFF9FAFC' };
  let rowNum = dataStart;
  let itemCounter = 0;

  for (const row of grid.rows) {
    const r = ws.getRow(rowNum);
    if (row.type === 'section') {
      const fill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: sectionFills[row.level] ?? 'FFF2F4F7' },
      };
      r.getCell(3).value = sanitizeCellText(row.name) + (row.amendmentNumber ? ` [ДС №${row.amendmentNumber}]` : '');
      r.getCell(3).font = { bold: true };
      r.getCell(9).value = toNumKeepZero(row.contractTotal);
      r.getCell(11).value = toNumKeepZero(row.executedAmount);
      periods.forEach((p, i) => {
        r.getCell(pairCol(i) + 1).value = toNum(row.byPeriod[p.id] ?? null);
      });
      r.getCell(colRemAmt).value = toNumKeepZero(row.remainderAmount);
      r.getCell(colTotAmt).value = toNumKeepZero(row.executedAmount);
      for (let c = 1; c <= lastCol; c++) {
        const cell = r.getCell(c);
        cell.fill = fill;
        cell.font = { ...(cell.font ?? {}), bold: true };
        cell.border = BORDER;
      }
    } else {
      itemCounter += 1;
      r.getCell(1).value = itemCounter;
      r.getCell(2).value = sanitizeCellText(row.kvrCode);
      r.getCell(3).value =
        sanitizeCellText(row.kind === 'nomenclature' ? `    ${row.name}` : row.name) +
        (row.amendmentNumber ? ` [ДС №${row.amendmentNumber}]` : '');
      r.getCell(4).value = sanitizeCellText(row.unit);
      r.getCell(5).value = toNum(row.contractQty);
      r.getCell(6).value = toNum(row.unitPrice);
      r.getCell(7).value = toNum(row.materialUnitCost);
      r.getCell(8).value = toNum(row.workUnitCost);
      r.getCell(9).value = toNumKeepZero(row.contractTotal);
      if (row.kind === 'nomenclature') {
        r.getCell(10).value = toNum(row.executedQty);
        r.getCell(11).value = toNum(row.executedAmount);
        r.getCell(colRemQty).value = toNum(row.remainderQty);
        r.getCell(colTotQty).value = toNum(row.executedQty);
      } else {
        r.getCell(11).value = toNum(row.executedAmount);
      }
      periods.forEach((p, i) => {
        const cell = row.byPeriod[p.id];
        if (!cell) return;
        r.getCell(pairCol(i)).value = toNum(cell.qty);
        r.getCell(pairCol(i) + 1).value = toNum(cell.amount);
      });
      r.getCell(colRemAmt).value = toNumKeepZero(row.remainderAmount);
      r.getCell(colTotAmt).value = toNum(row.executedAmount);
      if (row.kind === 'kvr') {
        r.getCell(3).font = { bold: true };
      }
      for (let c = 1; c <= lastCol; c++) r.getCell(c).border = BORDER;
    }
    rowNum += 1;
  }

  // ---- итоги ----
  const totalRow = ws.getRow(rowNum);
  totalRow.getCell(3).value = 'Итого, руб., в т.ч. НДС';
  totalRow.getCell(9).value = toNumKeepZero(grid.totals.contractTotal);
  totalRow.getCell(11).value = toNumKeepZero(grid.totals.executedAmount);
  periods.forEach((p, i) => {
    totalRow.getCell(pairCol(i) + 1).value = toNumKeepZero(grid.totals.byPeriod[p.id] ?? null);
  });
  totalRow.getCell(colRemAmt).value = toNumKeepZero(grid.totals.remainderAmount);
  totalRow.getCell(colTotAmt).value = toNumKeepZero(grid.totals.executedAmount);
  const vatRow = ws.getRow(rowNum + 1);
  vatRow.getCell(3).value = 'НДС 20%';
  vatRow.getCell(9).value = toNumKeepZero(grid.totals.vatContract);
  vatRow.getCell(11).value = toNumKeepZero(grid.totals.vatExecuted);
  periods.forEach((p, i) => {
    vatRow.getCell(pairCol(i) + 1).value = toNumKeepZero(vatFromGross(grid.totals.byPeriod[p.id] ?? '0'));
  });
  for (const r of [totalRow, vatRow]) {
    for (let c = 1; c <= lastCol; c++) {
      r.getCell(c).font = { bold: true };
      r.getCell(c).border = BORDER;
    }
  }

  // ---- форматы и ширины ----
  ws.getColumn(1).width = 7;
  ws.getColumn(2).width = 16;
  ws.getColumn(3).width = 55;
  ws.getColumn(4).width = 9;
  for (const c of [5, 10, colRemQty, colTotQty]) ws.getColumn(c).width = 12;
  for (const c of [6, 7, 8]) ws.getColumn(c).width = 14;
  for (const c of [9, 11, colRemAmt, colTotAmt]) ws.getColumn(c).width = 17;
  periods.forEach((_p, i) => {
    ws.getColumn(pairCol(i)).width = 11;
    ws.getColumn(pairCol(i) + 1).width = 16;
  });
  for (let c = 5; c <= lastCol; c++) {
    const isQty = c === 5 || c === 10 || c === colRemQty || c === colTotQty ||
      periods.some((_p, i) => pairCol(i) === c);
    ws.getColumn(c).numFmt = isQty ? QTY_FMT : MONEY_FMT;
  }
  ws.views = [{ state: 'frozen', xSplit: 4, ySplit: subRow }];

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: `KS-6_${object.code}.xlsx` };
}
