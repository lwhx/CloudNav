import { useCallback, useEffect, useRef, useState } from 'react';
import { Category, CategoryGroup, DEFAULT_CATEGORIES, DEFAULT_CATEGORY_GROUP, INITIAL_LINKS, LinkItem } from '../types';
import { createAppDataEnvelope, loadLocalAppData, normalizeAppData, saveLocalAppData } from '../services/appDataPersistence';

type SyncStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

type BuildAuthHeaders = (token?: string | null, extraHeaders?: Record<string, string>) => Record<string, string>;

interface UseAppDataSyncOptions {
  authToken: string;
  buildAuthHeaders: BuildAuthHeaders;
  onAuthExpired: () => void;
  onSyncError: () => void;
}

const SYNC_DEBOUNCE_MS = 800;

type PendingSyncPayload = {
  links: LinkItem[];
  categories: Category[];
  categoryGroups: CategoryGroup[];
  token: string;
};

export const useAppDataSync = ({ authToken, buildAuthHeaders, onAuthExpired, onSyncError }: UseAppDataSyncOptions) => {
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([DEFAULT_CATEGORY_GROUP]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const debounceTimerRef = useRef<number | null>(null);
  const pendingSyncRef = useRef<PendingSyncPayload | null>(null);
  const isSyncingRef = useRef(false);

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
  ) => {
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
        return false;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Cloud sync failed with status ${response.status}`);
      }

      setSyncStatus('saved');
      return true;
    } catch (error) {
      console.error('Sync failed', error);
      setSyncStatus('error');
      onSyncError();
      return false;
    }
  }, [buildAuthHeaders, categoryGroups, onAuthExpired, onSyncError]);

  const flushSyncQueue = useCallback(async () => {
    if (isSyncingRef.current || !pendingSyncRef.current) return;

    const payload = pendingSyncRef.current;
    pendingSyncRef.current = null;
    isSyncingRef.current = true;

    try {
      await syncToCloud(payload.links, payload.categories, payload.token, payload.categoryGroups);
    } finally {
      isSyncingRef.current = false;
      if (pendingSyncRef.current) void flushSyncQueue();
    }
  }, [syncToCloud]);

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

    if (authToken) {
      scheduleSync(normalized.links, normalized.categories, authToken, normalizedGroups);
    }
  }, [applyData, authToken, scheduleSync]);

  const loadLinkIcons = useCallback(async (linksToLoad: LinkItem[], categoriesToUse: Category[], token?: string) => {
    const activeToken = token || authToken;
    if (!activeToken) return;

    const updatedLinks = [...linksToLoad];
    const domainsToFetch = new Set<string>();

    for (const link of updatedLinks) {
      if (link.url && !link.deletedAt) {
        try {
          let domain = link.url;
          if (!link.url.startsWith('http://') && !link.url.startsWith('https://')) domain = 'https://' + link.url;

          if (domain.startsWith('http://') || domain.startsWith('https://')) {
            const urlObj = new URL(domain);
            domain = urlObj.hostname;
            if (!link.icon || !link.icon.startsWith('data:')) domainsToFetch.add(domain);
          }
        } catch (e) {
          console.error('Failed to parse URL for icon loading', e);
        }
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
    let hasChanges = false;

    iconResults.forEach(result => {
      if (!result) return;

      updatedLinks.forEach(linkToUpdate => {
        if (!linkToUpdate.url) return;

        try {
          let domain = linkToUpdate.url;
          if (!linkToUpdate.url.startsWith('http://') && !linkToUpdate.url.startsWith('https://')) domain = 'https://' + linkToUpdate.url;
          if (!domain.startsWith('http://') && !domain.startsWith('https://')) return;

          const urlObj = new URL(domain);
          if (urlObj.hostname !== result.domain) return;

          if (linkToUpdate.icon !== result.icon) {
            linkToUpdate.icon = result.icon;
            hasChanges = true;
          }
        } catch {
          return;
        }
      });
    });

    if (hasChanges) {
      const normalized = applyData(updatedLinks, categoriesToUse, categoryGroups);
      saveLocalAppData(normalized.links, normalized.categories, normalized.categoryGroups);
      scheduleSync(normalized.links, normalized.categories, activeToken, normalized.categoryGroups || [DEFAULT_CATEGORY_GROUP]);
    }
  }, [applyData, authToken, categoryGroups, scheduleSync]);

  useEffect(() => () => {
    if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
  }, []);

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
