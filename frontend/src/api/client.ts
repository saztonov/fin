import type { CurrentUser } from './types';

const BASE = '/api/v1';

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

let accessToken: string | null = null;

type AuthListener = (user: CurrentUser | null) => void;
const authListeners = new Set<AuthListener>();

export function onAuthChange(cb: AuthListener): () => void {
  authListeners.add(cb);
  return () => authListeners.delete(cb);
}

export function setSession(token: string | null, user: CurrentUser | null): void {
  accessToken = token;
  for (const cb of authListeners) cb(user);
}

async function parseError(res: Response): Promise<ApiClientError> {
  let message = `Ошибка запроса (${res.status})`;
  let code = 'request_error';
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    if (body.error?.message) message = body.error.message;
    if (body.error?.code) code = body.error.code;
  } catch {
    /* нет тела */
  }
  return new ApiClientError(message, code, res.status);
}

let refreshInFlight: Promise<CurrentUser | null> | null = null;

/**
 * Тихое обновление access-токена по refresh-cookie.
 * Параллельные вызовы (StrictMode, одновременные 401 у нескольких запросов)
 * делят один HTTP-запрос: повторная отправка того же refresh-токена сработала бы
 * как reuse detection на сервере и погасила бы сессию.
 */
export function tryRefresh(): Promise<CurrentUser | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'x-requested-with': 'ks-portal' },
        credentials: 'same-origin',
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { accessToken: string; user: CurrentUser };
      accessToken = body.accessToken;
      return body.user;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  formData?: FormData;
  raw?: boolean;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const doFetch = () => {
    const headers: Record<string, string> = { 'x-requested-with': 'ks-portal' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    let body: BodyInit | undefined;
    if (opts.formData) {
      body = opts.formData;
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    return fetch(`${BASE}${path}`, {
      method: opts.method ?? (opts.body !== undefined || opts.formData ? 'POST' : 'GET'),
      headers,
      body,
      credentials: 'same-origin',
    });
  };

  let res = await doFetch();
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const user = await tryRefresh();
    if (user) {
      res = await doFetch();
    } else {
      setSession(null, null);
    }
  }
  if (!res.ok) throw await parseError(res);
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Скачивание файла с авторизацией: fetch → blob → ссылка. */
export async function downloadFile(path: string): Promise<void> {
  const res = await api<Response>(path, { raw: true });
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/);
  const plainMatch = disposition.match(/filename="([^"]+)"/);
  const filename = utf8Match?.[1]
    ? decodeURIComponent(utf8Match[1])
    : (plainMatch?.[1] ?? 'export.xlsx');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
