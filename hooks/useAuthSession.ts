import { useCallback, useState } from 'react';

const AUTH_KEY = 'cloudnav_auth_token';
const AUTH_TIME_KEY = 'lastLoginTime';

export const useAuthSession = () => {
  const [authToken, setAuthToken] = useState<string>('');
  const [requiresAuth, setRequiresAuth] = useState<boolean | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  const buildAuthHeaders = useCallback((token?: string | null, extraHeaders: Record<string, string> = {}) => {
    const headers: Record<string, string> = { ...extraHeaders };
    const resolvedToken = token ?? authToken ?? localStorage.getItem(AUTH_KEY);
    const authIssuedAt = localStorage.getItem(AUTH_TIME_KEY);

    if (resolvedToken) {
      headers['x-auth-password'] = resolvedToken;
    }
    if (authIssuedAt) {
      headers['x-auth-issued-at'] = authIssuedAt;
    }

    return headers;
  }, [authToken]);

  const clearAuthSession = useCallback(() => {
    setAuthToken('');
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(AUTH_TIME_KEY);
  }, []);

  const requireAuth = useCallback((onRequired: () => void) => {
    if (authToken) return true;
    onRequired();
    return false;
  }, [authToken]);

  return {
    authToken,
    setAuthToken,
    requiresAuth,
    setRequiresAuth,
    isCheckingAuth,
    setIsCheckingAuth,
    buildAuthHeaders,
    clearAuthSession,
    requireAuth,
  };
};
