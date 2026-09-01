import ExcelJS from 'exceljs';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { constructionObjects, estimateParts, ks2Documents } from '../../db/schema/index.js';
import { ApiError } from '../../lib/errors.js';
import { periodVatRate } from '../../lib/estimate-parts.js';
import { dec, sumStrings, vatFromGrossRate } from '../../lib/money.js';
import { getKs6Grid } from '../ks6.service.js';
import { sanitizeCellText } from './sanitize.js';

const MONEY_FMT = '#,##0.00';
const QTY_FMT = '#,##0.###';
const PRICE_FMT = '#,##0.00####';
const thin = { style: 'thin' as const, color: { argb: 'FFB0B0B0' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

function fmtRuDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Выгрузка акта КС-2 за период (упрощённая форма; строгая ОКУД 0322005 — этап 2). */
export async function exportKs2(db: Db, ks2Id: string): Promise<{ buffer: Buffer; filename: string }> {
  const [doc] = await db
    .select()
    .from(ks2Documents)
    .where(and(eq(ks2Documents.id, ks2Id), isNull(ks2Documents.deletedAt)));
  if (!doc) throw ApiError.notFound('КС-2 не найден');
  // грид берётся по части документа: строки сметы у частей 20 % и 22 % разные,
  // и общий грид не нашёл бы половину строк акта
  const [part] = await db
    .select({ code: estimateParts.code, objectId: estimateParts.objectId })
    .from(estimateParts)
    .where(eq(estimateParts.id, doc.partId));
  if (!part) throw ApiError.notFound('Часть сметы не найдена');
  const [object] = await db
    .select()
    .from(constructionObjects)
    .where(eq(constructionObjects.id, part.objectId));

  const grid = await getKs6Grid(db, part.objectId, { part: part.code });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Портал КС';
  const ws = wb.addWorksheet(`КС-2 №${doc.number}`.slice(0, 31));

  const put = (row: number, col: number, value: ExcelJS.CellValue, bold = false) => {
    const cell = ws.getRow(row).getCell(col);
    cell.value = typeof value === 'string' ? sanitizeCellText(value) : value;
    if (bold) cell.font = { bold: true };
    return cell;
  };

  put(1, 1, 'АКТ О ПРИЕМКЕ ВЫПОЛНЕННЫХ РАБОТ', true);
  put(2, 1, `КС-2 № ${doc.number} от ${fmtRuDate(doc.docDate)}`, true);
  put(3, 1, 'Отчетный период:');
  put(3, 3, `${fmtRuDate(doc.periodFrom)} — ${fmtRuDate(doc.periodTo)}`);
  put(4, 1, 'Объект:');
  put(4, 3, object ? `${object.code} — ${object.name}` : '');
  if (doc.status === 'draft') put(5, 1, 'ЧЕРНОВИК (не утверждён)', true);

  const headerRow = 10;
  const headers: [number, string, number][] = [
    [1, '№ п/п', 7],
    [2, 'Код КВР', 16],
    [3, 'Наименование работ', 60],
    [4, 'Ед. изм.', 9],
    [5, 'Кол-во', 12],
    [6, 'Цена за ед., руб. с НДС', 15],
    [7, 'Стоимость, руб. с НДС', 17],
  ];
  for (const [c, title, width] of headers) {
    const cell = put(headerRow, c, title, true);
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = BORDER;
    ws.getColumn(c).width = width;
  }
  ws.getColumn(5).numFmt = QTY_FMT;
  // цена за единицу хранится с 6 знаками — печатаем как есть
  ws.getColumn(6).numFmt = PRICE_FMT;
  ws.getColumn(7).numFmt = MONEY_FMT;

  let rowNum = headerRow + 1;
  let counter = 0;
  const amounts: string[] = [];
  let pendingSection: string | null = null;

  for (const row of grid.rows) {
    if (row.type === 'section') {
      const amount = row.byPeriod[doc.id];
      pendingSection = amount && !dec(amount).isZero() ? row.name : null;
      if (pendingSection) {
        const r = ws.getRow(rowNum);
        r.getCell(3).value = sanitizeCellText(row.name);
        for (let c = 1; c <= 7; c++) {
          r.getCell(c).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF2F4F7' },
          };
          r.getCell(c).font = { bold: true };
          r.getCell(c).border = BORDER;
        }
        r.getCell(7).value = Number(amount);
        rowNum += 1;
      }
      continue;
    }
    if (row.kind !== 'nomenclature') continue;
    const cell = row.byPeriod[doc.id];
    if (!cell || (dec(cell.qty).isZero() && dec(cell.amount).isZero())) continue;
    counter += 1;
    const r = ws.getRow(rowNum);
    r.getCell(1).value = counter;
    r.getCell(2).value = sanitizeCellText(row.kvrCode);
    r.getCell(3).value = sanitizeCellText(row.name);
    r.getCell(4).value = sanitizeCellText(row.unit);
    r.getCell(5).value = Number(cell.qty);
    r.getCell(6).value = Number(row.unitPrice);
    r.getCell(7).value = Number(cell.amount);
    for (let c = 1; c <= 7; c++) r.getCell(c).border = BORDER;
    amounts.push(cell.amount);
    rowNum += 1;
  }

  const total = sumStrings(amounts);
  const totalRow = ws.getRow(rowNum);
  totalRow.getCell(3).value = 'Итого, руб., в т.ч. НДС';
  totalRow.getCell(7).value = Number(total);
  const vatRow = ws.getRow(rowNum + 1);
  // ставка части главнее даты: часть 22 % считается по 22 %, когда бы смета ни
  // заводилась. Для legacy (часть без ставки) — по концу периода, как в гриде.
  const rate = grid.activePart?.vatRate ?? periodVatRate(doc.periodFrom, doc.periodTo, doc.docDate);
  vatRow.getCell(3).value = rate ? `НДС ${rate}%` : 'НДС не облагается';
  vatRow.getCell(7).value = Number(vatFromGrossRate(total, rate));
  for (const r of [totalRow, vatRow]) {
    for (let c = 1; c <= 7; c++) {
      r.getCell(c).font = { bold: true };
      r.getCell(c).border = BORDER;
    }
  }

  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: headerRow }];

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const safeNumber = doc.number.replace(/[^\w-]+/g, '_');
  return { buffer, filename: `KS-2_${object?.code ?? ''}_${safeNumber}.xlsx` };
}
