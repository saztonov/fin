/**
 * Одноразовый процесс разбора Excel (skill office-documents):
 * запускается worker'ом БЕЗ секретов в env, без доступа к БД и сети.
 * argv: <путь к файлу> <psdc|ks6> [имя листа]. stdout: JSON {ok, data|error}.
 * Жёсткий таймаут и лимит вывода контролирует worker снаружи.
 *
 * Книга читается потоково (xlsx-reader), а не через объектную модель exceljs:
 * реальные КС-6 на 6–14 тыс. строк иначе не укладываются в таймаут разбора.
 */
import { parseKs6, parseSheet } from './ks6-parser.js';
import { selectSheet } from './sheet-select.js';
import { XlsxBook } from './xlsx-reader.js';

async function main(): Promise<void> {
  const [, , filePath, kind, sheetName] = process.argv;
  if (!filePath || (kind !== 'psdc' && kind !== 'ks6')) {
    process.stdout.write(JSON.stringify({ ok: false, error: 'Некорректные аргументы parse-child' }));
    process.exitCode = 2;
    return;
  }
  try {
    const book = await XlsxBook.open(filePath);
    const { ws, candidates } = await selectSheet(book, sheetName || null);
    const data = kind === 'psdc' ? parseSheet(ws, 'psdc') : parseKs6(ws);
    data.sheetCandidates = candidates;
    process.stdout.write(JSON.stringify({ ok: true, data }));
  } catch (e) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: (e as Error).message || 'Ошибка разбора файла' }),
    );
  }
}

void main();
