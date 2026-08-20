import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// .env ищем в текущем каталоге и в корне репозитория (запуск из backend/)
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_CA_CERT_PATH: z.string().optional(),
  JWT_SECRET: z.string().min(16),
  ACCESS_TTL_SEC: z.coerce.number().int().min(60).default(900),
  REFRESH_TTL_SEC: z.coerce.number().int().min(3600).default(2_592_000),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
  SEED_ADMIN_NAME: z.string().optional(),
  STORAGE_DIR: z.string().default('.data/uploads'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).default(26_214_400),
  WORKER_POLL_MS: z.coerce.number().int().min(100).default(1000),
  // потоковый разбор укладывается в единицы секунд даже на книгах 15 МБ,
  // но запас нужен: у заказчиков встречаются листы на 14 тыс. строк × 180 колонок
  PARSE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(180_000),
});

export type Config = z.infer<typeof envSchema>;

/**
 * Production startup checks (корпстандарт §25): сервис не должен стартовать
 * с placeholder-значениями или dev-настройками.
 */
function assertProductionSafety(cfg: Config): void {
  if (cfg.NODE_ENV !== 'production') return;
  const problems: string[] = [];
  if (cfg.JWT_SECRET.length < 32 || cfg.JWT_SECRET.includes('dev-secret')) {
    problems.push('JWT_SECRET: placeholder или короче 32 символов');
  }
  if (/@(example\.com|localhost)/i.test(cfg.SEED_ADMIN_EMAIL ?? '')) {
    problems.push('SEED_ADMIN_EMAIL: placeholder-домен');
  }
  if (!/sslmode=|ssl=true/.test(cfg.DATABASE_URL) && !cfg.DB_CA_CERT_PATH) {
    problems.push('DATABASE_URL без TLS и не задан DB_CA_CERT_PATH');
  }
  if (cfg.DB_CA_CERT_PATH && !fs.existsSync(cfg.DB_CA_CERT_PATH)) {
    problems.push(`DB_CA_CERT_PATH не существует: ${cfg.DB_CA_CERT_PATH}`);
  }
  if (problems.length > 0) {
    throw new Error(`Небезопасная production-конфигурация:\n- ${problems.join('\n- ')}`);
  }
}

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Некорректная конфигурация окружения: ${detail}`);
  }
  assertProductionSafety(parsed.data);
  cached = parsed.data;
  return cached;
}
