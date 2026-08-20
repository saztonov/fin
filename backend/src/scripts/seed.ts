/** Создание первого администратора из env (SEED_ADMIN_*). Идемпотентно. */
import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { users } from '../db/schema/index.js';

async function main() {
  const cfg = loadConfig();
  if (!cfg.SEED_ADMIN_EMAIL || !cfg.SEED_ADMIN_PASSWORD) {
    console.error('Задайте SEED_ADMIN_EMAIL и SEED_ADMIN_PASSWORD в .env');
    process.exit(1);
  }
  const { db, pool } = createDb();
  const existing = await db.select().from(users).where(eq(users.email, cfg.SEED_ADMIN_EMAIL));
  if (existing.length > 0) {
    console.log(`Администратор ${cfg.SEED_ADMIN_EMAIL} уже существует`);
  } else {
    await db.insert(users).values({
      email: cfg.SEED_ADMIN_EMAIL,
      fullName: cfg.SEED_ADMIN_NAME ?? 'Администратор',
      passwordHash: await hash(cfg.SEED_ADMIN_PASSWORD),
      role: 'admin',
      isActive: true,
    });
    console.log(`Создан администратор ${cfg.SEED_ADMIN_EMAIL}`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
