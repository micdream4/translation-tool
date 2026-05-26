import { useEffect, useState } from 'react';

export type AuthStatus = 'checking' | 'authenticated' | 'anonymous' | 'blocked';

export type TranslationCapabilities = {
  cloudflareAi: boolean;
  openrouter: boolean;
  deepseek: boolean;
  gemini: boolean;
};

export type AuthState = {
  status: AuthStatus;
  email?: string;
  message?: string;
  localBypass?: boolean;
  translationCapabilities?: TranslationCapabilities;
};

type MeResponse = {
  authenticated?: boolean;
  email?: string;
  error?: string;
  localBypass?: boolean;
  translationCapabilities?: Partial<TranslationCapabilities>;
};

const normalizeEmail = (email: unknown) => String(email || '').trim();
const normalizeCapabilities = (
  capabilities: Partial<TranslationCapabilities> | undefined
): TranslationCapabilities | undefined => {
  if (!capabilities) return undefined;
  return {
    cloudflareAi: Boolean(capabilities.cloudflareAi),
    openrouter: Boolean(capabilities.openrouter),
    deepseek: Boolean(capabilities.deepseek),
    gemini: Boolean(capabilities.gemini)
  };
};

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
            localBypass: Boolean(payload.localBypass),
            translationCapabilities: normalizeCapabilities(payload.translationCapabilities)
          });
          return;
        }

        if (response.status === 401 || response.status === 403) {
          setAuthState({
            status: 'blocked',
            email: normalizeEmail(payload?.email),
            message: payload?.error || 'Access denied',
            translationCapabilities: normalizeCapabilities(payload?.translationCapabilities)
          });
          return;
        }

        setAuthState({
          status: 'anonymous',
          translationCapabilities: normalizeCapabilities(payload?.translationCapabilities)
        });
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
