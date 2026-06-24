import { useCallback, useEffect, useRef, useState } from 'react';
import { Category, CategoryGroup, DEFAULT_CATEGORIES, DEFAULT_CATEGORY_GROUP, INITIAL_LINKS, LinkItem } from '../types';
import { createAppDataEnvelope, loadLocalAppData, normalizeAppData, saveLocalAppData } from '../services/appDataPersistence';
import { mergeAppData } from '../services/mergeAppData';

type SyncStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

type BuildAuthHeaders = (token?: string | null, extraHeaders?: Record<string, string>) => Record<string, string>;

interface UseAppDataSyncOptions {
  authToken: string;
  buildAuthHeaders: BuildAuthHeaders;
  onAuthExpired: () => void;
  onSyncError: () => void;
  onSyncOffline?: () => void;
  onSyncRetrying?: (attempt: number, nextDelayMs: number) => void;
  onSyncGiveUp?: () => void;
}

const SYNC_DEBOUNCE_MS = 800;
const SYNC_RETRY_BASE_MS = 1000;
const SYNC_RETRY_MAX_MS = 30000;
const SYNC_RETRY_MAX_ATTEMPTS = 6;

type PendingSyncPayload = {
  links: LinkItem[];
  categories: Category[];
  categoryGroups: CategoryGroup[];
  token: string;
};

export const useAppDataSync = ({ authToken, buildAuthHeaders, onAuthExpired, onSyncError, onSyncOffline, onSyncRetrying, onSyncGiveUp }: UseAppDataSyncOptions) => {
  const [links, setLinks] = useState<LinkItem[]>([]);
  // 镜像最新 links，供异步回调（如 loadLinkIcons）读取当前 state，
  // 避免覆盖期间发生的编辑。useEffect 保证任意 setter 路径都同步。
  const linksRef = useRef<LinkItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([DEFAULT_CATEGORY_GROUP]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const debounceTimerRef = useRef<number | null>(null);
  const pendingSyncRef = useRef<PendingSyncPayload | null>(null);
  const isSyncingRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const lastFailedPayloadRef = useRef<PendingSyncPayload | null>(null);
  const flushSyncQueueRef = useRef<() => Promise<void>>(async () => {});
  const scheduleRetryRef = useRef<(payload: PendingSyncPayload) => void>(() => {});

  // 保持 linksRef 与 links state 同步（所有 setter 路径都覆盖）。
  // loadLinkIcons 通过 linksRef 读取当前 state，避免覆盖加载期间发生的用户编辑。
  useEffect(() => {
    linksRef.current = links;
  }, [links]);

  const applyData = useCallback((newLinks: LinkItem[], newCategories: Category[], newCategoryGroups?: CategoryGroup[]) => {
    const normalized = normalizeAppData({
      links: newLinks,
      categories: newCategories,
      categoryGroups: newCategoryGroups || categoryGroups,
    });
    setLinks(normalized.links);
    setCategories(normalized.categories);
    setCategoryGroups(normalized.categoryGroups || [DEFAULT_CATEGORY_GROUP]);
    return normalized;
  }, [categoryGroups]);

  const loadFromLocal = useCallback(() => {
    try {
      const stored = loadLocalAppData();
      applyData(stored.links || INITIAL_LINKS, stored.categories || DEFAULT_CATEGORIES, stored.categoryGroups);
    } catch {
      applyData(INITIAL_LINKS, DEFAULT_CATEGORIES, [DEFAULT_CATEGORY_GROUP]);
    }
  }, [applyData]);

  const syncToCloud = useCallback(async (
    newLinks: LinkItem[],
    newCategories: Category[],
    token: string,
    newCategoryGroups?: CategoryGroup[],
  ): Promise<{ ok: boolean; authExpired: boolean }> => {
    setSyncStatus('saving');
    try {
      const response = await fetch('/api/storage', {
        method: 'POST',
        headers: buildAuthHeaders(token, {
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(createAppDataEnvelope(newLinks, newCategories, newCategoryGroups || categoryGroups)),
      });

      if (response.status === 401) {
        onAuthExpired();
        setSyncStatus('error');
        return { ok: false, authExpired: true };
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Cloud sync failed with status ${response.status}`);
      }

      setSyncStatus('saved');
      return { ok: true, authExpired: false };
    } catch (error) {
      console.error('Sync failed', error);
      setSyncStatus('error');
      return { ok: false, authExpired: false };
    }
  }, [buildAuthHeaders, categoryGroups, onAuthExpired]);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const flushSyncQueue = useCallback(async () => {
    if (isSyncingRef.current || !pendingSyncRef.current) return;

    const payload = pendingSyncRef.current;
    pendingSyncRef.current = null;
    isSyncingRef.current = true;

    try {
      const result = await syncToCloud(payload.links, payload.categories, payload.token, payload.categoryGroups);
      if (result.ok) {
        retryAttemptRef.current = 0;
        lastFailedPayloadRef.current = null;
        clearRetryTimer();
      } else if (result.authExpired) {
        // 鉴权失效：保留 pending，等待重新登录后由 updateData 重新 schedule
        retryAttemptRef.current = 0;
        lastFailedPayloadRef.current = null;
        clearRetryTimer();
        onSyncError?.();
      } else {
        // 网络或服务端错误：按指数退避重试
        scheduleRetryRef.current(payload);
      }
    } finally {
      isSyncingRef.current = false;
      if (pendingSyncRef.current) void flushSyncQueueRef.current();
    }
  }, [clearRetryTimer, onSyncError, syncToCloud]);

  // 同步保存到 ref，使 scheduleRetry / online 事件可调用最新版本
  flushSyncQueueRef.current = flushSyncQueue;

  const scheduleRetry = useCallback((payload: PendingSyncPayload) => {
    clearRetryTimer();
    lastFailedPayloadRef.current = payload;
    const attempt = retryAttemptRef.current + 1;
    if (attempt > SYNC_RETRY_MAX_ATTEMPTS) {
      retryAttemptRef.current = 0;
      lastFailedPayloadRef.current = null;
      onSyncGiveUp?.();
      onSyncError?.();
      return;
    }
    retryAttemptRef.current = attempt;
    const delay = Math.min(SYNC_RETRY_BASE_MS * 2 ** (attempt - 1), SYNC_RETRY_MAX_MS);
    onSyncRetrying?.(attempt, delay);
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      pendingSyncRef.current = payload;
      void flushSyncQueueRef.current();
    }, delay);
  }, [clearRetryTimer, onSyncError, onSyncGiveUp, onSyncRetrying]);

  // 同步保存到 ref，使 flushSyncQueue 可调用最新版本
  scheduleRetryRef.current = scheduleRetry;

  const scheduleSync = useCallback((newLinks: LinkItem[], newCategories: Category[], token: string, newCategoryGroups: CategoryGroup[]) => {
    pendingSyncRef.current = { links: newLinks, categories: newCategories, categoryGroups: newCategoryGroups, token };

    if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      void flushSyncQueue();
    }, SYNC_DEBOUNCE_MS);
  }, [flushSyncQueue]);

  const updateData = useCallback((newLinks: LinkItem[], newCategories: Category[], newCategoryGroups?: CategoryGroup[]) => {
    const normalized = applyData(newLinks, newCategories, newCategoryGroups);
    const normalizedGroups = normalized.categoryGroups || [DEFAULT_CATEGORY_GROUP];
    saveLocalAppData(normalized.links, normalized.categories, normalizedGroups);

    // 云端写入接口需要有效 token；未登录时只保存本地，避免无 token 写入反复失败。
    if (authToken) {
      scheduleSync(normalized.links, normalized.categories, authToken, normalizedGroups);
    } else {
      setSyncStatus('offline');
      onSyncOffline?.();
    }
  }, [applyData, authToken, onSyncOffline, scheduleSync]);

  const loadLinkIcons = useCallback(async (linksToLoad: LinkItem[], categoriesToUse: Category[], token?: string) => {
    const activeToken = token || authToken;
    if (!activeToken) return;

    // 不 mutate 传入的 link 对象，否则会污染当前 React state 的共享引用。
    const domainOf = (rawUrl: string): string | null => {
      try {
        let domain = rawUrl;
        if (!domain.startsWith('http://') && !domain.startsWith('https://')) domain = 'https://' + domain;
        if (!domain.startsWith('http://') && !domain.startsWith('https://')) return null;
        return new URL(domain).hostname;
      } catch {
        return null;
      }
    };

    const domainsToFetch = new Set<string>();
    for (const link of linksToLoad) {
      if (link.url && !link.deletedAt && (!link.icon || !link.icon.startsWith('data:'))) {
        const domain = domainOf(link.url);
        if (domain) domainsToFetch.add(domain);
      }
    }

    if (domainsToFetch.size === 0) return;

    const iconPromises = Array.from(domainsToFetch).map(async (domain) => {
      try {
        const response = await fetch(`/api/storage?getConfig=favicon&domain=${encodeURIComponent(domain)}&fetch=true`);
        if (response.ok) {
          const data = await response.json();
          if (data.cached && data.icon) return { domain, icon: data.icon };
        }
      } catch (error) {
        console.log(`Failed to fetch cached icon for ${domain}`, error);
      }
      return null;
    });

    const iconResults = await Promise.all(iconPromises);
    const iconByDomain = new Map<string, string>();
    iconResults.forEach(result => {
      if (result) iconByDomain.set(result.domain, result.icon);
    });

    if (iconByDomain.size === 0) return;

    // 在当前最新 state 上打补丁（用 ref 读取，避免覆盖图标加载期间发生的用户编辑）。
    // 副作用放在 updater 外执行，避免 React StrictMode 双调用导致重复写入/同步。
    const currentLinks = linksRef.current;
    let changed = false;
    const nextLinks = currentLinks.map(link => {
      if (!link.url || link.deletedAt) return link;
      const domain = domainOf(link.url);
      if (!domain) return link;
      const newIcon = iconByDomain.get(domain);
      if (!newIcon || newIcon === link.icon) return link;
      changed = true;
      return { ...link, icon: newIcon };
    });
    if (!changed) return;

    setLinks(nextLinks);
    saveLocalAppData(nextLinks, categoriesToUse, categoryGroups);
    if (activeToken) {
      scheduleSync(nextLinks, categoriesToUse, activeToken, categoryGroups);
    }
  }, [authToken, categoryGroups, scheduleSync]);

  // 监听页面隐藏/卸载：把待同步的本地最新数据通过 keepalive fetch 推到云端，
  // 避免 800 ms 防抖窗口内刷新导致云端仍是旧数据、刷新后被回写覆盖。
  useEffect(() => {
    const flushWithKeepalive = () => {
      const payload = pendingSyncRef.current;
      if (!payload) return;

      const envelope = createAppDataEnvelope(payload.links, payload.categories, payload.categoryGroups);
      const body = JSON.stringify(envelope);

      try {
        const headers = buildAuthHeaders(payload.token, { 'Content-Type': 'application/json' });
        fetch('/api/storage', { method: 'POST', headers, body, keepalive: true }).catch(() => {});
        pendingSyncRef.current = null;
        if (debounceTimerRef.current) {
          window.clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
      } catch {
        // 静默失败，下次启动时由 useAppBootstrap 用本地最新数据反向同步
      }
    };

    // 网络恢复时立即重试未完成的同步（重置退避计数，避免反复抖动）
    const handleOnline = () => {
      if (retryTimerRef.current) {
        clearRetryTimer();
      }
      retryAttemptRef.current = 0;
      const failed = lastFailedPayloadRef.current;
      const pending = pendingSyncRef.current;
      if (failed && pending) {
        // 离线期间又有了新编辑：合并失败 payload 和最新 pending，避免新编辑被旧 payload 覆盖丢弃
        const merged = mergeAppData({
          local: { links: pending.links, categories: pending.categories, categoryGroups: pending.categoryGroups },
          cloud: { links: failed.links, categories: failed.categories, categoryGroups: failed.categoryGroups },
        });
        pendingSyncRef.current = { links: merged.links, categories: merged.categories, categoryGroups: merged.categoryGroups || [DEFAULT_CATEGORY_GROUP], token: pending.token };
        lastFailedPayloadRef.current = null;
        void flushSyncQueueRef.current();
        return;
      }
      if (failed) {
        pendingSyncRef.current = failed;
        lastFailedPayloadRef.current = null;
        void flushSyncQueueRef.current();
        return;
      }
      if (pending) {
        void flushSyncQueueRef.current();
      }
    };

    window.addEventListener('pagehide', flushWithKeepalive);
    window.addEventListener('beforeunload', flushWithKeepalive);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('pagehide', flushWithKeepalive);
      window.removeEventListener('beforeunload', flushWithKeepalive);
      window.removeEventListener('online', handleOnline);
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
      clearRetryTimer();
    };
  }, [buildAuthHeaders, clearRetryTimer]);

  return {
    links,
    setLinks,
    categories,
    setCategories,
    categoryGroups,
    setCategoryGroups,
    syncStatus,
    setSyncStatus,
    loadFromLocal,
    syncToCloud,
    updateData,
    loadLinkIcons,
  };
};
