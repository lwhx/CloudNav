import { useCallback, useState } from 'react';
import { clearAllUnlocked, getUnlockedCategoriesHeader } from '../services/categoryUnlockRegistry';

const AUTH_KEY = 'cloudnav_auth_token';
const AUTH_TIME_KEY = 'lastLoginTime';

export const useAuthSession = () => {
  // authToken 现在存的是服务端签发的会话令牌，而非原始主密码。
  const [authToken, setAuthToken] = useState<string>('');
  const [requiresAuth, setRequiresAuth] = useState<boolean | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  const buildAuthHeaders = useCallback((token?: string | null, extraHeaders: Record<string, string> = {}) => {
    const headers: Record<string, string> = { ...extraHeaders };
    const resolvedToken = token ?? authToken ?? localStorage.getItem(AUTH_KEY);
    const authIssuedAt = localStorage.getItem(AUTH_TIME_KEY);

    // 优先以会话令牌走 Bearer；原始密码回退路径由需要它的调用方自行设置 x-auth-password。
    if (resolvedToken && !headers['Authorization'] && !headers['x-auth-password']) {
      headers['Authorization'] = `Bearer ${resolvedToken}`;
    }
    if (authIssuedAt) {
      headers['x-auth-issued-at'] = authIssuedAt;
    }
    // 附带当前会话内已解锁的分类，使服务端 GET 返回这些受锁分类的链接（#11）。
    const unlockedHeader = getUnlockedCategoriesHeader();
    if (unlockedHeader) {
      headers['x-unlocked-categories'] = unlockedHeader;
    }

    return headers;
  }, [authToken]);

  const clearAuthSession = useCallback(() => {
    setAuthToken('');
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(AUTH_TIME_KEY);
    clearAllUnlocked(); // 登出时清空已解锁分类
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
