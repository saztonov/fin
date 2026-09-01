/**
 * Регрессия разбора на реальных книгах заказчиков.
 *
 *   npx tsx src/scripts/books-golden.ts          # сверить с эталоном
 *   npx tsx src/scripts/books-golden.ts --update # перезаписать эталон
 *
 * Сами книги лежат в `temp/КС/` и в репозиторий не попадают (temp/ в .gitignore),
 * поэтому коммитится только слепок чисел — `src/tests/fixtures/real-books.golden.json`.
 * Если каталога с книгами нет, скрипт молча выходит с успехом: на чужой машине и в
 * CI сверять не с чем, а падать из-за этого нельзя.
 *
 * Зачем отдельно от vitest: книги весят до 16 МБ и разбираются десятки секунд —
 * в обычный прогон тестов это не помещается. Синтетические кейсы на ту же логику
 * лежат в src/tests/code-hierarchy.test.ts и src/tests/import-controls.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sumStrings } from '../lib/money.js';
import { parseKs6 } from '../worker/parse-child/ks6-parser.js';
import { selectSheet } from '../worker/parse-child/sheet-select.js';
import { XlsxBook } from '../worker/parse-child/xlsx-reader.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOOKS_DIR = path.resolve(HERE, '../../../temp/КС');
const GOLDEN = path.resolve(HERE, '../tests/fixtures/real-books.golden.json');

interface Snapshot {
  sheet: string;
  sections: number;
  nomenclature: number;
  kvr: number;
  subline: number;
  /** Σ строк номенклатуры — главное число: именно оно уезжало при задвоении */
  nomTotal: string;
  contractTotal: string | null;
  vatTotal: string | null;
  executedTotal: string | null;
  vatMode: string | null;
  /** номер КС-2 → Σ строк этой колонки */
  periods: Record<string, string>;
  warnings: number;
}

async function snapshot(file: string): Promise<Snapshot> {
  const book = await XlsxBook.open(file);
  const { ws } = await selectSheet(book, null);
  const p = parseKs6(ws);
  const kinds = (k: string) => p.items.filter((i) => i.kind === k).length;
  const periods: Record<string, string> = {};
  for (const c of p.ks2Columns) {
    periods[c.number ?? `#${c.index}`] = sumStrings(c.cells.map((x) => x.amount));
  }
  return {
    sheet: p.sheetName,
    sections: p.sections.length,
    nomenclature: kinds('nomenclature'),
    kvr: kinds('kvr'),
    subline: kinds('subline'),
    nomTotal: sumStrings(
      p.items.filter((i) => i.kind === 'nomenclature').map((i) => i.contractTotal),
    ),
    contractTotal: p.controls.contractTotal,
    vatTotal: p.controls.vat,
    executedTotal: p.controls.executedTotal,
    vatMode: p.vat.mode,
    periods,
    warnings: p.warnings.length,
  };
}

function diff(a: unknown, b: unknown, at = ''): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) =>
      diff((a as never)[k], (b as never)[k], at ? `${at}.${k}` : k),
    );
  }
  return [`${at}: эталон ${JSON.stringify(a)} → сейчас ${JSON.stringify(b)}`];
}

async function main(): Promise<void> {
  const update = process.argv.includes('--update');
  if (!fs.existsSync(BOOKS_DIR)) {
    console.log(`Каталог книг ${BOOKS_DIR} не найден — сверка пропущена.`);
    return;
  }
  const files = fs
    .readdirSync(BOOKS_DIR)
    .filter((f) => /\.xlsx$/i.test(f))
    .sort();

  const actual: Record<string, Snapshot | { error: string }> = {};
  for (const f of files) {
    const started = Date.now();
    try {
      actual[f] = await snapshot(path.join(BOOKS_DIR, f));
    } catch (e) {
      actual[f] = { error: (e as Error).message };
    }
    console.log(`  разобрано: ${f} (${Date.now() - started} мс)`);
  }

  if (update) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 2)}\n`, 'utf8');
    console.log(`\nЭталон перезаписан: ${GOLDEN} (книг: ${files.length})`);
    return;
  }

  if (!fs.existsSync(GOLDEN)) {
    console.error(`\nЭталон ${GOLDEN} отсутствует — создайте его: --update`);
    process.exitCode = 2;
    return;
  }
  const expected = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) as typeof actual;

  let bad = 0;
  for (const name of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    if (!(name in actual)) {
      console.log(`\n? ${name}: книги нет на диске — пропущено`);
      continue;
    }
    if (!(name in expected)) {
      console.log(`\n+ ${name}: книги нет в эталоне — добавьте через --update`);
      continue;
    }
    const d = diff(expected[name], actual[name]);
    if (!d.length) {
      console.log(`\n✓ ${name}`);
      continue;
    }
    bad += 1;
    console.log(`\n✗ ${name}`);
    for (const line of d) console.log(`    ${line}`);
  }

  if (bad) {
    console.error(`\nРасхождений: ${bad}. Если изменения ожидаемы — обновите эталон: --update`);
    process.exitCode = 1;
  } else {
    console.log('\nВсе книги сходятся с эталоном.');
  }
}

void main();
