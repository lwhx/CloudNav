import { useCallback, useState } from 'react';
import { Category, DEFAULT_CATEGORIES, INITIAL_LINKS, LinkItem } from '../types';

type SyncStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

type BuildAuthHeaders = (token?: string | null, extraHeaders?: Record<string, string>) => Record<string, string>;

interface UseAppDataSyncOptions {
  authToken: string;
  buildAuthHeaders: BuildAuthHeaders;
  onAuthExpired: () => void;
  onSyncError: () => void;
}

const LOCAL_STORAGE_KEY = 'cloudnav_data_cache';

const normalizeLocalData = (links: LinkItem[], categories: Category[]) => {
  let loadedCategories = categories;

  if (!loadedCategories.some(c => c.id === 'common')) {
    loadedCategories = [
      { id: 'common', name: '常用推荐', icon: 'Star' },
      ...loadedCategories,
    ];
  } else {
    const commonIndex = loadedCategories.findIndex(c => c.id === 'common');
    if (commonIndex > 0) {
      const commonCategory = loadedCategories[commonIndex];
      loadedCategories = [
        commonCategory,
        ...loadedCategories.slice(0, commonIndex),
        ...loadedCategories.slice(commonIndex + 1),
      ];
    }
  }

  const validCategoryIds = new Set(loadedCategories.map(c => c.id));
  const loadedLinks = links.map(link => {
    if (!validCategoryIds.has(link.categoryId)) {
      return { ...link, categoryId: 'common' };
    }
    return link;
  });

  return { links: loadedLinks, categories: loadedCategories };
};

export const useAppDataSync = ({ authToken, buildAuthHeaders, onAuthExpired, onSyncError }: UseAppDataSyncOptions) => {
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');

  const loadFromLocal = useCallback(() => {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const normalized = normalizeLocalData(parsed.links || INITIAL_LINKS, parsed.categories || DEFAULT_CATEGORIES);
        setLinks(normalized.links);
        setCategories(normalized.categories);
      } catch (e) {
        setLinks(INITIAL_LINKS);
        setCategories(DEFAULT_CATEGORIES);
      }
    } else {
      setLinks(INITIAL_LINKS);
      setCategories(DEFAULT_CATEGORIES);
    }
  }, []);

  const syncToCloud = useCallback(async (newLinks: LinkItem[], newCategories: Category[], token: string) => {
    setSyncStatus('saving');
    try {
      const response = await fetch('/api/storage', {
        method: 'POST',
        headers: buildAuthHeaders(token, {
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ links: newLinks, categories: newCategories }),
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
  }, [buildAuthHeaders, onAuthExpired, onSyncError]);

  const updateData = useCallback((newLinks: LinkItem[], newCategories: Category[]) => {
    setLinks(newLinks);
    setCategories(newCategories);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ links: newLinks, categories: newCategories }));

    if (authToken) {
      syncToCloud(newLinks, newCategories, authToken);
    }
  }, [authToken, syncToCloud]);

  const loadLinkIcons = useCallback(async (linksToLoad: LinkItem[], categoriesToUse: Category[], token?: string) => {
    const activeToken = token || authToken;
    if (!activeToken) return;

    const updatedLinks = [...linksToLoad];
    const domainsToFetch = new Set<string>();

    for (const link of updatedLinks) {
      if (link.url) {
        try {
          let domain = link.url;
          if (!link.url.startsWith('http://') && !link.url.startsWith('https://')) {
            domain = 'https://' + link.url;
          }

          if (domain.startsWith('http://') || domain.startsWith('https://')) {
            const urlObj = new URL(domain);
            domain = urlObj.hostname;
            if (!link.icon || !link.icon.startsWith('data:')) {
              domainsToFetch.add(domain);
            }
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
          if (data.cached && data.icon) {
            return { domain, icon: data.icon };
          }
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
          if (!linkToUpdate.url.startsWith('http://') && !linkToUpdate.url.startsWith('https://')) {
            domain = 'https://' + linkToUpdate.url;
          }

          if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
            return;
          }

          const urlObj = new URL(domain);
          if (urlObj.hostname !== result.domain) {
            return;
          }

          if (linkToUpdate.icon !== result.icon) {
            linkToUpdate.icon = result.icon;
            hasChanges = true;
          }
        } catch (e) {
          return;
        }
      });
    });

    if (hasChanges) {
      setLinks(updatedLinks);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ links: updatedLinks, categories: categoriesToUse }));
      syncToCloud(updatedLinks, categoriesToUse, activeToken);
    }
  }, [authToken, syncToCloud]);

  return {
    links,
    setLinks,
    categories,
    setCategories,
    syncStatus,
    setSyncStatus,
    loadFromLocal,
    syncToCloud,
    updateData,
    loadLinkIcons,
  };
};
