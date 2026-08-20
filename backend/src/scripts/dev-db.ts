/**
 * Dev-БД без Docker: реальный PostgreSQL из пакета @embedded-postgres/*.
 * Запуск через pg_ctl (он создаёт ограниченный токен — прямой запуск postgres.exe
 * под администратором Windows запрещён самим PostgreSQL).
 * Скрипт идемпотентен: initdb при первом запуске, затем start + create db + extensions.
 * Сервер остаётся работать в фоне; остановка: `npm run db:stop`.
 * В production используется Yandex Managed PostgreSQL (корпстандарт §7).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';

const require = createRequire(import.meta.url);

const PORT = 5439;
const USER = 'ks';
const PASSWORD = 'ks';
const DB = 'ks';

const repoRoot = path.resolve(process.cwd(), '..');
const DATA_DIR = path.join(repoRoot, '.data', 'pg');
const LOG_FILE = path.join(repoRoot, '.data', 'pg.log');

function binDir(): string {
  const platformPkg = `@embedded-postgres/${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
  // exports-карта пакета не отдаёт package.json — идём от main-модуля вверх до папки пакета
  let dir = path.dirname(require.resolve(platformPkg));
  while (!fs.existsSync(path.join(dir, 'native', 'bin')) && path.dirname(dir) !== dir) {
    dir = path.dirname(dir);
  }
  const result = path.join(dir, 'native', 'bin');
  if (!fs.existsSync(result)) {
    throw new Error(`Не найден каталог бинарников PostgreSQL для ${platformPkg}`);
  }
  return result;
}

function run(
  cmd: string,
  args: string[],
  okCodes: number[] = [0],
  opts: { detachedIo?: boolean } = {},
): { code: number; out: string } {
  // detachedIo: демон postgres наследует пайпы pg_ctl — с 'pipe' spawnSync
  // блокируется до остановки сервера, поэтому вывод не перехватываем
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: opts.detachedIo ? 'ignore' : 'pipe',
  });
  const out = opts.detachedIo ? '' : `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const code = res.status ?? -1;
  if (!okCodes.includes(code)) {
    throw new Error(`${path.basename(cmd)} ${args[args.length - 1]} завершился с кодом ${code}:\n${out}`);
  }
  return { code, out };
}

async function main() {
  const bin = binDir();
  const exe = (name: string) => path.join(bin, process.platform === 'win32' ? `${name}.exe` : name);
  fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true });

  const isMode = process.argv[2] ?? 'start';
  if (isMode === 'stop') {
    run(exe('pg_ctl'), ['-D', DATA_DIR, '-m', 'fast', 'stop'], [0, 1]);
    console.log('PostgreSQL остановлен');
    return;
  }

  if (!fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
    console.log('Инициализация кластера (UTF-8) в', DATA_DIR);
    const pwfile = path.join(os.tmpdir(), `ks-pg-pw-${process.pid}.txt`);
    fs.writeFileSync(pwfile, PASSWORD, 'utf8');
    try {
      run(exe('initdb'), [
        '-D',
        DATA_DIR,
        '-U',
        USER,
        '-A',
        'scram-sha-256',
        '--pwfile',
        pwfile,
        '--encoding=UTF8',
        '--no-locale',
      ]);
    } finally {
      fs.rmSync(pwfile, { force: true });
    }
  }

  // уже запущен? pg_ctl status: 0 — работает, 3 — нет
  const status = run(exe('pg_ctl'), ['-D', DATA_DIR, 'status'], [0, 3, 4]);
  if (status.code !== 0) {
    run(exe('pg_ctl'), ['-D', DATA_DIR, '-l', LOG_FILE, '-o', `-p ${PORT}`, '-w', 'start'], [0], {
      detachedIo: true,
    });
  }

  const admin = new pg.Client({
    host: '127.0.0.1',
    port: PORT,
    user: USER,
    password: PASSWORD,
    database: 'postgres',
  });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE ${DB}`);
  }
  await admin.end();

  // расширения включаются вне миграций приложения (корпстандарт §8)
  const client = new pg.Client({
    host: '127.0.0.1',
    port: PORT,
    user: USER,
    password: PASSWORD,
    database: DB,
  });
  await client.connect();
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await client.query('CREATE EXTENSION IF NOT EXISTS citext');
  await client.end();

  console.log(`PostgreSQL работает: postgres://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB}`);
  console.log('Остановка: npm run db:stop');
}

main().catch((e) => {
  console.error('Ошибка dev-БД:', (e as Error).message ?? e);
  process.exit(1);
});
