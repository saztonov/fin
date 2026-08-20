import fs from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadConfig } from '../config.js';
import * as schema from './schema/index.js';

export type Db = ReturnType<typeof createDb>['db'];

export function createDb() {
  const cfg = loadConfig();
  const pool = new pg.Pool({
    connectionString: cfg.DATABASE_URL,
    max: cfg.DB_POOL_MAX,
    ssl: cfg.DB_CA_CERT_PATH
      ? { ca: fs.readFileSync(cfg.DB_CA_CERT_PATH, 'utf8'), rejectUnauthorized: true }
      : undefined,
  });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool };
}
