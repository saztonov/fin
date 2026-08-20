import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { importFiles, importStaging } from '../db/schema/index.js';
import { createLocalStorage } from '../lib/storage/local.js';
import { childOutputSchema, PARSER_VERSION, type ParsedImport } from './parse-child/parsed-schema.js';

const STDOUT_LIMIT = 20 * 1024 * 1024;

/** Ошибка разбора, ретраи бессмысленны (не тот формат, шифрование и т.п.). */
export class PermanentParseError extends Error {}

const here = path.dirname(fileURLToPath(import.meta.url));
const isTsRuntime = import.meta.url.endsWith('.ts');

function childCommand(): { cmd: string; baseArgs: string[] } {
  const script = path.join(here, 'parse-child', isTsRuntime ? 'main.ts' : 'main.js');
  if (isTsRuntime) {
    // dev: tsx установлен в workspace
    return { cmd: process.execPath, baseArgs: ['--import', 'tsx', script] };
  }
  return { cmd: process.execPath, baseArgs: ['--max-old-space-size=512', script] };
}

/** Запуск изолированного parse-child: чистый env, SIGKILL по wall-clock, лимит stdout. */
export function runParseChild(filePath: string, kind: 'psdc' | 'ks6'): Promise<ParsedImport> {
  const cfg = loadConfig();
  const { cmd, baseArgs } = childCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...baseArgs, filePath, kind], {
      env: {
        // без секретов: только то, что нужно node для запуска
        PATH: process.env.PATH ?? '',
        SYSTEMROOT: process.env.SYSTEMROOT ?? '',
        TEMP: process.env.TEMP ?? '',
        TMP: process.env.TMP ?? '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let out = '';
    let err = '';
    let killedByLimit = false;
    const timer = setTimeout(() => {
      killedByLimit = true;
      child.kill('SIGKILL');
    }, cfg.PARSE_TIMEOUT_MS);

    child.stdout.on('data', (d: Buffer) => {
      out += d.toString('utf8');
      if (out.length > STDOUT_LIMIT) {
        killedByLimit = true;
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      if (err.length < 8192) err += d.toString('utf8');
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killedByLimit) {
        return reject(
          new PermanentParseError('Разбор прерван: превышен лимит времени или объёма результата'),
        );
      }
      if (code !== 0 && !out) {
        return reject(new Error(`parse-child завершился с кодом ${code}: ${err.slice(0, 500)}`));
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(out);
      } catch {
        return reject(new PermanentParseError('parse-child вернул некорректный JSON'));
      }
      const validated = childOutputSchema.safeParse(parsed);
      if (!validated.success) {
        return reject(new PermanentParseError(`Результат разбора не прошёл валидацию: ${validated.error.issues[0]?.message}`));
      }
      if (!validated.data.ok) {
        return reject(new PermanentParseError(validated.data.error));
      }
      resolve(validated.data.data);
    });
  });
}

export interface ImportParsePayload {
  importFileId: string;
}

/** Обработчик job type=import_parse: файл → parse-child → staging. */
export async function handleImportParse(db: Db, payload: ImportParsePayload): Promise<void> {
  const [file] = await db
    .select()
    .from(importFiles)
    .where(eq(importFiles.id, payload.importFileId));
  if (!file) throw new PermanentParseError(`import_file ${payload.importFileId} не найден`);
  if (file.status === 'applied' || file.status === 'discarded') return;

  await db
    .update(importFiles)
    .set({ status: 'parsing', updatedAt: new Date() })
    .where(eq(importFiles.id, file.id));

  const storage = createLocalStorage();
  const localPath = storage.localPath(file.storageKey);
  if (!localPath) throw new PermanentParseError('Файл недоступен в локальном хранилище');

  try {
    const data = await runParseChild(localPath, file.kind);
    const summary = {
      sections: data.sections.length,
      kvrItems: data.items.filter((i) => i.kind === 'kvr').length,
      nomenclatureItems: data.items.filter((i) => i.kind === 'nomenclature').length,
      ks2Columns: data.ks2Columns.length,
      controls: data.controls,
      warnings: data.warnings,
    };
    await db.transaction(async (tx) => {
      await tx.delete(importStaging).where(eq(importStaging.importFileId, file.id));
      await tx.insert(importStaging).values({
        importFileId: file.id,
        payload: data,
        summary,
      });
      await tx
        .update(importFiles)
        .set({ status: 'parsed', parserVersion: PARSER_VERSION, error: null, updatedAt: new Date() })
        .where(eq(importFiles.id, file.id));
    });
  } catch (e) {
    const message = (e as Error).message;
    if (e instanceof PermanentParseError) {
      await db
        .update(importFiles)
        .set({ status: 'parse_failed', error: message, updatedAt: new Date() })
        .where(eq(importFiles.id, file.id));
    }
    throw e;
  }
}
