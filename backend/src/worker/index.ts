/**
 * Worker-процесс: опрашивает PostgreSQL-очередь и обрабатывает задачи.
 * Разбор Excel выполняется в дочернем parse-child, не в этом процессе.
 */
import crypto from 'node:crypto';
import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { claimNext, complete, fail } from '../lib/jobs/queue.js';
import { createLogger } from '../lib/logger.js';
import { handleImportParse, PermanentParseError, type ImportParsePayload } from './import-parse.job.js';

const cfg = loadConfig();
const log = createLogger('worker');
const { db, pool } = createDb();
const workerId = `worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;

const LEASE_MS = 5 * 60 * 1000;
let stopping = false;

async function tick(): Promise<boolean> {
  const job = await claimNext(db, workerId, ['import_parse'], LEASE_MS);
  if (!job) return false;
  log.info({ jobId: job.id, type: job.type, attempt: job.attempts }, 'задача взята');
  try {
    if (job.type === 'import_parse') {
      await handleImportParse(db, job.payload as unknown as ImportParsePayload);
    } else {
      throw new PermanentParseError(`Неизвестный тип задачи: ${job.type}`);
    }
    const ok = await complete(db, job.id, job.fencingToken);
    log.info({ jobId: job.id, ok }, 'задача выполнена');
  } catch (e) {
    const permanent = e instanceof PermanentParseError;
    log.error({ jobId: job.id, err: (e as Error).message, permanent }, 'ошибка задачи');
    await fail(db, job, (e as Error).message, { permanent });
  }
  return true;
}

async function loop() {
  log.info({ workerId }, 'worker запущен');
  while (!stopping) {
    try {
      const had = await tick();
      if (!had) await new Promise((r) => setTimeout(r, cfg.WORKER_POLL_MS));
    } catch (e) {
      log.error({ err: (e as Error).message }, 'ошибка цикла worker');
      await new Promise((r) => setTimeout(r, cfg.WORKER_POLL_MS * 5));
    }
  }
  await pool.end();
  log.info('worker остановлен');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

void loop();
