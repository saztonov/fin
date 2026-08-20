import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onAuthChange, setSession, tryRefresh } from '../api/client';
import type { CurrentUser } from '../api/types';

interface AuthContextValue {
  user: CurrentUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => onAuthChange(setUser), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const restored = await tryRefresh().catch(() => null);
      if (!cancelled) {
        setUser(restored);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      ready,
      login: async (email, password) => {
        const res = await api<{ accessToken: string; user: CurrentUser }>('/auth/login', {
          body: { email, password },
        });
        setSession(res.accessToken, res.user);
      },
      logout: async () => {
        await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
        setSession(null, null);
      },
    }),
    [user, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth вне AuthProvider');
  return ctx;
}
