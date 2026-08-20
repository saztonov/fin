/** Интерфейс файлового хранилища. Этап 1 — локальный volume, этап 2 — S3. */
export interface Storage {
  save(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  /** Абсолютный путь к файлу, если хранилище локальное (для передачи в parse-child). */
  localPath(key: string): string | null;
  delete(key: string): Promise<void>;
}
