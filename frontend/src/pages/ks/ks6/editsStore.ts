/**
 * Хранилище несохранённых правок объёмов вне React-дерева таблицы:
 * ввод в ячейке не ре-рендерит таблицу, подписка точечная через
 * useSyncExternalStore (ячейка — на свой ключ, панель сохранения — на счётчик).
 */
export class EditsStore {
  private map = new Map<string, string>();
  private listeners = new Set<() => void>();

  readonly subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  private emit() {
    for (const cb of this.listeners) cb();
  }

  get(itemId: string): string | undefined {
    return this.map.get(itemId);
  }

  set(itemId: string, qty: string | null): void {
    if (qty === null) this.map.delete(itemId);
    else this.map.set(itemId, qty);
    this.emit();
  }

  /** снимок для панели сохранения: количество правок */
  size(): number {
    return this.map.size;
  }

  entries(): [string, string][] {
    return [...this.map.entries()];
  }

  clear(): void {
    if (this.map.size === 0) return;
    this.map.clear();
    this.emit();
  }
}
