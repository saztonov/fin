import { useCallback, useState } from 'react';

/**
 * Состояние UI, переживающее перезагрузку страницы.
 * Только для настроек интерфейса — данные авторизации в localStorage не кладём.
 */
export function useLocalStorageState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (value: T) => {
      setState(value);
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // приватный режим / переполненное хранилище — молча игнорируем
      }
    },
    [key],
  );

  return [state, set];
}
