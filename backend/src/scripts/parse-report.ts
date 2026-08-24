/**
 * Сводка разбора книг КС-6 без БД:
 *   npx tsx src/scripts/parse-report.ts <файл.xlsx|каталог> [лист]
 * Печатает по каждой книге: лист, состав строк, периоды, НДС и сверку сумм.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseKs6 } from '../worker/parse-child/ks6-parser.js';
import { sumStrings } from '../lib/money.js';
import { selectSheet } from '../worker/parse-child/sheet-select.js';
import { XlsxBook } from '../worker/parse-child/xlsx-reader.js';

async function reportFile(file: string, sheet?: string): Promise<void> {
  const started = Date.now();
  console.log(`\n${'='.repeat(78)}\n# ${path.basename(file)}`);
  try {
    const book = await XlsxBook.open(file);
    const { ws } = await selectSheet(book, sheet ?? null);
    const parsed = parseKs6(ws);
    const byKind = parsed.items.reduce<Record<string, number>>((acc, i) => {
      acc[i.kind] = (acc[i.kind] ?? 0) + 1;
      return acc;
    }, {});
    const nomTotal = sumStrings(
      parsed.items.filter((i) => i.kind === 'nomenclature').map((i) => i.contractTotal),
    );
    const executed = sumStrings(
      parsed.ks2Columns.flatMap((c) => c.cells.map((x) => x.amount)),
    );
    const withNumber = parsed.ks2Columns.filter((c) => c.number).length;
    const withPeriod = parsed.ks2Columns.filter((c) => c.periodFrom ?? c.docDate ?? c.monthDate).length;

    console.log(`  лист: «${parsed.sheetName}»   (${Date.now() - started} мс)`);
    console.log(
      `  разделов: ${parsed.sections.length} (глубина до ${Math.max(0, ...parsed.sections.map((s) => s.level))})` +
        `   позиций: ${JSON.stringify(byKind)}`,
    );
    console.log(
      `  периодов: ${parsed.ks2Columns.length} (с номером ${withNumber}, с датой ${withPeriod})` +
        `   ячеек: ${parsed.ks2Columns.reduce((a, c) => a + c.cells.length, 0)}`,
    );
    console.log(`  НДС из файла: ставка ${parsed.vat.rate ?? '—'}, режим ${parsed.vat.mode ?? '—'}`);
    console.log(`  Σ номенклатур: ${nomTotal}   «Итого» файла: ${parsed.controls.contractTotal ?? '—'}`);
    console.log(`  Σ по периодам: ${executed}   «Выполнено» файла: ${parsed.controls.executedTotal ?? '—'}`);
    if (parsed.warnings.length) {
      console.log(`  предупреждений: ${parsed.warnings.length}`);
      for (const w of parsed.warnings.slice(0, 5)) console.log(`    · ${w}`);
      if (parsed.warnings.length > 5) console.log(`    · … ещё ${parsed.warnings.length - 5}`);
    }
  } catch (e) {
    console.log(`  ОШИБКА: ${(e as Error).message}`);
  }
}

async function main(): Promise<void> {
  const [, , target, sheet] = process.argv;
  if (!target) {
    console.error('Использование: tsx src/scripts/parse-report.ts <файл.xlsx|каталог> [лист]');
    process.exitCode = 2;
    return;
  }
  const stat = fs.statSync(target);
  const files = stat.isDirectory()
    ? fs
        .readdirSync(target)
        .filter((f) => /\.xlsx$/i.test(f))
        .map((f) => path.join(target, f))
    : [target];
  for (const f of files) await reportFile(f, sheet);
}

void main();
