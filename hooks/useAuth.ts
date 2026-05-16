import { useEffect, useState } from 'react';

export type AuthStatus = 'checking' | 'authenticated' | 'anonymous' | 'blocked';

export type AuthState = {
  status: AuthStatus;
  email?: string;
  message?: string;
  localBypass?: boolean;
};

type MeResponse = {
  authenticated?: boolean;
  email?: string;
  error?: string;
  localBypass?: boolean;
};

const normalizeEmail = (email: unknown) => String(email || '').trim();

export const useAuth = (): AuthState => {
  const [authState, setAuthState] = useState<AuthState>({ status: 'checking' });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;

    fetch('/api/me', { credentials: 'same-origin' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as MeResponse | null;
        if (cancelled) return;

        if (response.ok && payload?.authenticated) {
          setAuthState({
            status: 'authenticated',
            email: normalizeEmail(payload.email),
            localBypass: Boolean(payload.localBypass)
          });
          return;
        }

        if (response.status === 401 || response.status === 403) {
          setAuthState({
            status: 'blocked',
            email: normalizeEmail(payload?.email),
            message: payload?.error || 'Access denied'
          });
          return;
        }

        setAuthState({ status: 'anonymous' });
      })
      .catch(() => {
        if (!cancelled) setAuthState({ status: 'anonymous' });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return authState;
};
