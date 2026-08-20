import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../../config.js';
import type { Storage } from './storage.js';

/**
 * Локальное хранилище в STORAGE_DIR. Ключи генерирует backend
 * (uuid + фиксированное расширение), пользовательский ввод в путь не попадает.
 */
export function createLocalStorage(): Storage {
  const root = path.resolve(process.cwd(), '..', loadConfig().STORAGE_DIR);

  const resolveKey = (key: string): string => {
    if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes('..')) {
      throw new Error(`Недопустимый ключ хранилища: ${key}`);
    }
    const full = path.resolve(root, key);
    if (!full.startsWith(root)) throw new Error('Ключ выходит за пределы хранилища');
    return full;
  };

  return {
    async save(key, data) {
      const full = resolveKey(key);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, data);
    },
    async read(key) {
      return fs.readFile(resolveKey(key));
    },
    localPath(key) {
      return resolveKey(key);
    },
    async delete(key) {
      // повторное удаление отсутствующего объекта — успех (корпстандарт §15)
      await fs.rm(resolveKey(key), { force: true });
    },
  };
}
