/**
 * Диагностика разбора книги без БД и без очереди:
 *   npx tsx src/scripts/inspect-sheet.ts <файл.xlsx> [имя листа]
 * Без имени листа печатает список листов и результат детектора шапки по каждому.
 */
import { detectHeader } from '../worker/parse-child/header-detect.js';
import { detectPeriodGroups } from '../worker/parse-child/period-groups.js';
import { XlsxBook, numToCol, type SheetGrid } from '../worker/parse-child/xlsx-reader.js';

function report(ws: SheetGrid): void {
  const started = Date.now();
  const layout = detectHeader(ws);
  console.log(`\n--- лист «${ws.name}»: строк ${ws.rowCount}, колонок ${ws.columnCount}`);
  if (!layout) {
    console.log('    шапка не найдена');
    return;
  }
  console.log(
    `    шапка: строки ${layout.headerRow}..${layout.headerRow + layout.headerHeight - 1}, ` +
      `данные с ${layout.dataStartRow}, вес ${layout.score}`,
  );
  const cols = Object.entries(layout.cols)
    .sort((a, b) => (a[1] as number) - (b[1] as number))
    .map(([f, c]) => `${f}=${numToCol(c as number)}`)
    .join(' ');
  console.log(`    графы: ${cols}`);

  const groups = detectPeriodGroups(ws, layout);
  console.log(`    групп периодов: ${groups.periods.length}, контрольных: ${groups.controls.length}`);
  for (const g of groups.periods.slice(0, 3)) {
    console.log(
      `      ${numToCol(g.qtyCol ?? 0)}/${numToCol(g.amountCol)} «${g.label}» ` +
        `№${g.meta.number ?? '—'} ${g.meta.periodFrom ?? g.meta.docDate ?? g.meta.monthDate ?? '—'}`,
    );
  }
  if (groups.periods.length > 3) {
    const last = groups.periods[groups.periods.length - 1]!;
    console.log(`      … последняя: «${last.label}» №${last.meta.number ?? '—'}`);
  }
  for (const c of groups.controls) {
    console.log(`      [контроль ${c.role}] ${numToCol(c.amountCol)} «${c.label}»`);
  }
  console.log(`    (${Date.now() - started} мс на разметку)`);
}

async function main(): Promise<void> {
  const [, , filePath, sheetName] = process.argv;
  if (!filePath) {
    console.error('Использование: tsx src/scripts/inspect-sheet.ts <файл.xlsx> [лист]');
    process.exitCode = 2;
    return;
  }
  const t0 = Date.now();
  const book = await XlsxBook.open(filePath);
  console.log(`книга открыта за ${Date.now() - t0} мс`);
  console.log(
    'листы: ' +
      book
        .listSheets()
        .map((s) => `${s.name}${s.state === 'visible' ? '' : ` [${s.state}]`}`)
        .join(' | '),
  );

  const targets = sheetName
    ? [sheetName]
    : book.visibleSheets().map((s) => s.name);
  for (const name of targets) {
    const t1 = Date.now();
    const ws = await book.readSheet(name);
    console.log(`\n(чтение листа «${name}»: ${Date.now() - t1} мс)`);
    report(ws);
  }
}

void main();
