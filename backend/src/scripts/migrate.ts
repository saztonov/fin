/**
 * SQL-first миграции (корпстандарт §8): versioned SQL-файлы из backend/drizzle
 * применяются по порядку, каждая в транзакции, факт применения — в _migrations.
 * Запускается отдельным шагом деплоя, НЕ из api/worker.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadConfig } from '../config.js';
import { pgConnectionOptions } from '../db/pg-ssl.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(here, '..', '..', 'drizzle');

export async function runMigrations(databaseUrl?: string): Promise<string[]> {
  const cfg = loadConfig();
  const client = new pg.Client(
    pgConnectionOptions(databaseUrl ?? cfg.DATABASE_URL, cfg.DB_CA_CERT_PATH),
  );
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const done = new Set(
      (await client.query('SELECT name FROM _migrations')).rows.map((r) => r.name as string),
    );
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Миграция ${file} не применилась: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  runMigrations()
    .then((applied) => {
      console.log(applied.length > 0 ? `Применены: ${applied.join(', ')}` : 'Новых миграций нет');
      process.exit(0);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
