/**
 * Одноразовый процесс разбора Excel (skill office-documents):
 * запускается worker'ом БЕЗ секретов в env, без доступа к БД и сети.
 * argv: <путь к файлу> <psdc|ks6>. stdout: JSON {ok, data|error}.
 * Жёсткий таймаут и лимит вывода контролирует worker снаружи.
 */
import ExcelJS from 'exceljs';
import { parseKs6 } from './ks6-parser.js';
import { parsePsdc } from './psdc-parser.js';

async function main() {
  const [, , filePath, kind] = process.argv;
  if (!filePath || (kind !== 'psdc' && kind !== 'ks6')) {
    process.stdout.write(JSON.stringify({ ok: false, error: 'Некорректные аргументы parse-child' }));
    process.exitCode = 2;
    return;
  }
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const data = kind === 'psdc' ? parsePsdc(wb) : parseKs6(wb);
    process.stdout.write(JSON.stringify({ ok: true, data }));
  } catch (e) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: (e as Error).message || 'Ошибка разбора файла' }),
    );
  }
}

void main();
