import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { jobs, type Job } from '../../db/schema/index.js';

/**
 * PostgreSQL-очередь (корпстандарт §16): атомарный захват через
 * FOR UPDATE SKIP LOCKED, аренда locked_until, fencing token,
 * retry с экспоненциальным backoff и jitter, dead-state.
 */

export async function enqueue(db: Db, type: string, payload: unknown): Promise<number> {
  const [row] = await db
    .insert(jobs)
    .values({ type, payload: payload as object })
    .returning({ id: jobs.id });
  return row!.id;
}

export async function claimNext(
  db: Db,
  workerId: string,
  types: string[],
  leaseMs: number,
): Promise<Job | null> {
  const typeList = sql.join(
    types.map((t) => sql`${t}`),
    sql`, `,
  );
  const rows = await db.execute(sql`
    UPDATE jobs SET
      status = 'running',
      locked_by = ${workerId},
      locked_until = now() + make_interval(secs => ${leaseMs / 1000}),
      attempts = attempts + 1,
      fencing_token = fencing_token + 1,
      updated_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE type IN (${typeList})
        AND (
          (status = 'pending' AND next_run_at <= now())
          OR (status = 'running' AND locked_until < now())
        )
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, type, payload, status, attempts, max_attempts, next_run_at,
              locked_by, locked_until, fencing_token, last_error, created_at, updated_at
  `);
  const r = rows.rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    type: r.type as string,
    payload: r.payload,
    status: r.status as Job['status'],
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    nextRunAt: new Date(r.next_run_at as string),
    lockedBy: r.locked_by as string | null,
    lockedUntil: r.locked_until ? new Date(r.locked_until as string) : null,
    fencingToken: Number(r.fencing_token),
    lastError: r.last_error as string | null,
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
  };
}

/** Запись результата только при совпадении fencing token (защита от «зомби»-воркера). */
export async function complete(db: Db, jobId: number, fencingToken: number): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE jobs SET status = 'done', locked_by = NULL, locked_until = NULL, updated_at = now()
    WHERE id = ${jobId} AND fencing_token = ${fencingToken}
  `);
  return (res.rowCount ?? 0) > 0;
}

export async function fail(
  db: Db,
  job: Job,
  error: string,
  opts: { permanent?: boolean } = {},
): Promise<void> {
  const isDead = opts.permanent || job.attempts >= job.maxAttempts;
  if (isDead) {
    await db.execute(sql`
      UPDATE jobs SET status = 'dead', last_error = ${error.slice(0, 4000)},
        locked_by = NULL, locked_until = NULL, updated_at = now()
      WHERE id = ${job.id} AND fencing_token = ${job.fencingToken}
    `);
    return;
  }
  // экспоненциальный backoff с jitter: 30s * 2^attempts ± 20%
  const baseSec = 30 * 2 ** job.attempts;
  const jitter = baseSec * 0.2 * (Math.random() * 2 - 1);
  const delaySec = Math.round(baseSec + jitter);
  await db.execute(sql`
    UPDATE jobs SET status = 'pending', last_error = ${error.slice(0, 4000)},
      next_run_at = now() + make_interval(secs => ${delaySec}),
      locked_by = NULL, locked_until = NULL, updated_at = now()
    WHERE id = ${job.id} AND fencing_token = ${job.fencingToken}
  `);
}
