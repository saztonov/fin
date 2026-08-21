import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadConfig } from '../config.js';
import { pgConnectionOptions } from './pg-ssl.js';
import * as schema from './schema/index.js';

export type Db = ReturnType<typeof createDb>['db'];

/**
 * Транзакционный хэндл. Нужен там, где операцию вызывают и самостоятельно, и как
 * шаг чужой транзакции (например, apply одной части внутри batch-импорта).
 */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb() {
  const cfg = loadConfig();
  const pool = new pg.Pool({
    ...pgConnectionOptions(cfg.DATABASE_URL, cfg.DB_CA_CERT_PATH),
    max: cfg.DB_POOL_MAX,
  });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool };
}
