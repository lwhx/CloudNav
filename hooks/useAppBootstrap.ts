import { useEffect } from 'react';
import { AIConfig, Category, CategoryGroup, DEFAULT_CATEGORIES, DEFAULT_CATEGORY_GROUP, LinkItem, SearchConfig, SiteSettings, WebDavConfig } from '../types';
import { createDefaultSearchSources } from './useSearchConfig';
import { saveLocalAppData } from '../services/appDataPersistence';
import { mergeAppData } from '../services/mergeAppData';
import { normalizeAIConfig } from '../services/aiConfigService';

const AUTH_KEY = 'cloudnav_auth_token';
const AUTH_TIME_KEY = 'lastLoginTime';
const WEBDAV_CONFIG_KEY = 'cloudnav_webdav_config';
const AI_CONFIG_KEY = 'cloudnav_ai_config';

const hasMeaningfulAppData = (dataLinks: LinkItem[], dataCategories: Category[], dataGroups: CategoryGroup[]) => {
  return dataLinks.length > 0
    || dataCategories.some(category => !DEFAULT_CATEGORIES.some(defaultCategory => defaultCategory.id === category.id && defaultCategory.name === category.name))
    || dataGroups.some(group => group.id !== DEFAULT_CATEGORY_GROUP.id);
};

interface UseAppBootstrapOptions {
  authToken: string;
  siteSettings: SiteSettings;
  links: LinkItem[];
  categories: Category[];
  setAuthToken: (token: string) => void;
  setRequiresAuth: (requiresAuth: boolean | null) => void;
  setIsCheckingAuth: (checking: boolean) => void;
  buildAuthHeaders: (token?: string | null, extraHeaders?: Record<string, string>) => Record<string, string>;
  clearAuthSession: () => void;
  setLinks: (links: LinkItem[]) => void;
  setCategories: (categories: Category[]) => void;
  setCategoryGroups: (categoryGroups: CategoryGroup[]) => void;
  loadFromLocal: () => void;
  loadLinkIcons: (links: LinkItem[], categories: Category[], token?: string) => void;
  setSearchMode: (mode: 'internal' | 'external') => void;
  setExternalSearchSources: (sources: SearchConfig['externalSources']) => void;
  setSelectedSearchSource: (source: SearchConfig['selectedSource']) => void;
  setIsLoadingSearchConfig: (loading: boolean) => void;
  setSiteSettings: (updater: SiteSettings | ((prev: SiteSettings) => SiteSettings)) => void;
  setAiConfig: (config: AIConfig) => void;
  setWebDavConfig: (config: WebDavConfig) => void;
  setPrefillLink: (link?: Partial<LinkItem>) => void;
  setEditingLink: (link?: LinkItem) => void;
  setIsModalOpen: (open: boolean) => void;
  setIsAuthOpen: (open: boolean) => void;
  fallbackApiKey?: string;
}

export const useAppBootstrap = ({
  authToken,
  siteSettings,
  setAuthToken,
  setRequiresAuth,
  setIsCheckingAuth,
  buildAuthHeaders,
  clearAuthSession,
  setLinks,
  setCategories,
  setCategoryGroups,
  loadFromLocal,
  loadLinkIcons,
  setSearchMode,
  setExternalSearchSources,
  setSelectedSearchSource,
  setIsLoadingSearchConfig,
  setSiteSettings,
  setAiConfig,
  setWebDavConfig,
  setPrefillLink,
  setEditingLink,
  setIsModalOpen,
  setIsAuthOpen,
  fallbackApiKey = '',
}: UseAppBootstrapOptions) => {
  useEffect(() => {
    let effectiveToken = localStorage.getItem(AUTH_KEY);
    const lastLoginTime = localStorage.getItem(AUTH_TIME_KEY);

    if (effectiveToken) {
      const currentTime = Date.now();
      const expiryDays = siteSettings.passwordExpiryDays || 7;
      const expiryTimeMs = expiryDays > 0 ? expiryDays * 24 * 60 * 60 * 1000 : 0;
      const lastLogin = lastLoginTime ? parseInt(lastLoginTime, 10) : 0;

      if (expiryTimeMs > 0 && lastLogin > 0 && currentTime - lastLogin > expiryTimeMs) {
        clearAuthSession();
        effectiveToken = null;
      } else {
        setAuthToken(effectiveToken);
      }
    }

    const savedWebDav = localStorage.getItem(WEBDAV_CONFIG_KEY);
    if (savedWebDav) {
      try {
        setWebDavConfig(JSON.parse(savedWebDav));
      } catch { /* ignore corrupted config */ }
    }

    const urlParams = new URLSearchParams(window.location.search);
    const addUrl = urlParams.get('add_url');
    if (addUrl) {
      const addTitle = urlParams.get('add_title') || '';
      window.history.replaceState({}, '', window.location.pathname);
      setPrefillLink({ title: addTitle, url: addUrl, categoryId: 'common' });
      setEditingLink(undefined);
      if (effectiveToken) {
        setIsModalOpen(true);
      } else {
        setIsAuthOpen(true);
      }
    }

    const applyWebsiteConfig = (websiteConfigData: Partial<SiteSettings>) => {
      setSiteSettings(prev => ({
        ...prev,
        title: websiteConfigData.title || prev.title,
        navTitle: websiteConfigData.navTitle || prev.navTitle,
        favicon: websiteConfigData.favicon || prev.favicon,
        cardStyle: websiteConfigData.cardStyle || prev.cardStyle,
        requirePasswordOnVisit: websiteConfigData.requirePasswordOnVisit !== undefined ? websiteConfigData.requirePasswordOnVisit : prev.requirePasswordOnVisit,
        passwordExpiryDays: websiteConfigData.passwordExpiryDays !== undefined ? websiteConfigData.passwordExpiryDays : prev.passwordExpiryDays,
      }));
    };

    const initData = async () => {
      try {
        const authRes = await fetch('/api/storage?checkAuth=true');
        if (authRes.ok) {
          const authData = await authRes.json();
          setRequiresAuth(authData.requiresAuth);

          if (authData.hasPassword && effectiveToken) {
            const validateRes = await fetch('/api/storage', {
              method: 'POST',
              headers: buildAuthHeaders(effectiveToken, { 'Content-Type': 'application/json' }),
              body: JSON.stringify({ authOnly: true }),
            });

            if (!validateRes.ok) {
              clearAuthSession();
              effectiveToken = null;
            } else {
              const validateData = await validateRes.json();
              if (validateData?.authenticatedAt) {
                localStorage.setItem(AUTH_TIME_KEY, String(validateData.authenticatedAt));
                setAuthToken(effectiveToken);
              }
            }
          }

          if (authData.requiresAuth && !effectiveToken) {
            setIsCheckingAuth(false);
            return;
          }
        }
      } catch (e) {
        console.warn('Failed to check auth requirement.', e);
      }

      let hasCloudData = false;
      let hasSearchConfig = false;
      const activeToken = effectiveToken || authToken;
      try {
        const res = await fetch('/api/storage', {
          headers: activeToken ? buildAuthHeaders(activeToken) : {},
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.links) || Array.isArray(data.categories)) {
            const cloudLinks = Array.isArray(data.links) ? data.links : [];
            const cloudCategories = Array.isArray(data.categories) ? data.categories : DEFAULT_CATEGORIES;
            const cloudCategoryGroups = Array.isArray(data.categoryGroups) ? data.categoryGroups : [DEFAULT_CATEGORY_GROUP];
            const cloudHasContent = hasMeaningfulAppData(cloudLinks, cloudCategories, cloudCategoryGroups);

            // 读取本地缓存与时间戳，避免云端空 envelope 抹掉本地新数据
            const localRaw = localStorage.getItem('cloudnav_data_cache');
            const localEnvelope = localRaw ? (() => { try { return JSON.parse(localRaw); } catch { return null; } })() : null;
            const localUpdatedAt = localEnvelope && typeof localEnvelope.updatedAt === 'number' ? localEnvelope.updatedAt : 0;
            const localLinks = Array.isArray(localEnvelope?.links) ? localEnvelope.links : [];
            const localCategories = Array.isArray(localEnvelope?.categories) ? localEnvelope.categories : [];
            const localGroups = Array.isArray(localEnvelope?.categoryGroups) ? localEnvelope.categoryGroups : [DEFAULT_CATEGORY_GROUP];
            const localHasContent = hasMeaningfulAppData(localLinks, localCategories, localGroups);
            const cloudUpdatedAt = typeof data.updatedAt === 'number' ? data.updatedAt : 0;

            // 决策：只有当云端有真实数据时，才考虑用云端覆盖；否则保留本地最新
            if (cloudHasContent || localHasContent) {
              // 任一侧有真实数据：按 id 合并，保留两侧全部未删除记录。
              // 不用整包 updatedAt 决定覆盖，因为 KV 最终一致性和客户端时钟偏差
              // 会让"刚新增的本地链接"被旧云端快照抹掉。
              const merged = mergeAppData({
                local: { links: localLinks, categories: localCategories, categoryGroups: localGroups, updatedAt: localUpdatedAt },
                cloud: { links: cloudLinks, categories: cloudCategories, categoryGroups: cloudCategoryGroups, updatedAt: cloudUpdatedAt },
              });
              setLinks(merged.links);
              setCategories(merged.categories);
              setCategoryGroups(merged.categoryGroups);
              saveLocalAppData(merged.links, merged.categories, merged.categoryGroups);
              loadLinkIcons(merged.links, merged.categories, activeToken || undefined);
              hasCloudData = true;
            }
            // 云端完全为空 + 本地有数据：什么都不做，hasCloudData 保持 false，loadFromLocal 会保留本地
          }
        } else if (res.status === 401) {
          const errorData = await res.json();
          if (errorData.error && errorData.error.includes('过期')) {
            clearAuthSession();
            setIsAuthOpen(true);
            setIsCheckingAuth(false);
            return;
          }
        }
      } catch (e) {
        console.warn('Failed to fetch from cloud, falling back to local.', e);
      }

      try {
        const [searchConfigResult, websiteConfigResult, aiConfigResult, webDavConfigResult] = await Promise.allSettled([
          fetch('/api/storage?getConfig=search'),
          fetch('/api/storage?getConfig=website'),
          activeToken ? fetch('/api/storage?getConfig=ai', { headers: buildAuthHeaders(activeToken) }) : Promise.resolve(null),
          activeToken ? fetch('/api/storage?getConfig=webdav', { headers: buildAuthHeaders(activeToken) }) : Promise.resolve(null),
        ]);

        if (searchConfigResult.status === 'fulfilled' && searchConfigResult.value?.ok) {
          const searchConfigData = await searchConfigResult.value.json();
          if (searchConfigData && (searchConfigData.mode || searchConfigData.externalSources || searchConfigData.selectedSource)) {
            hasSearchConfig = true;
            setSearchMode(searchConfigData.mode || 'internal');
            setExternalSearchSources(searchConfigData.externalSources || []);
            if (searchConfigData.selectedSource) {
              setSelectedSearchSource(searchConfigData.selectedSource);
            }
          }
        }

        if (websiteConfigResult.status === 'fulfilled' && websiteConfigResult.value?.ok) {
          const websiteConfigData = await websiteConfigResult.value.json();
          if (websiteConfigData) applyWebsiteConfig(websiteConfigData);
        }

        if (aiConfigResult.status === 'fulfilled' && aiConfigResult.value?.ok) {
          const aiConfigData = await aiConfigResult.value.json();
          if (aiConfigData && Object.keys(aiConfigData).length > 0) {
            const normalizedAIConfig = normalizeAIConfig(aiConfigData, fallbackApiKey);
            setAiConfig(normalizedAIConfig);
            localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(normalizedAIConfig));
          }
        }

        if (webDavConfigResult.status === 'fulfilled' && webDavConfigResult.value?.ok) {
          const webDavConfigData = await webDavConfigResult.value.json();
          if (webDavConfigData && (webDavConfigData.url || webDavConfigData.username || webDavConfigData.password || webDavConfigData.enabled !== undefined)) {
            setWebDavConfig(webDavConfigData);
            localStorage.setItem(WEBDAV_CONFIG_KEY, JSON.stringify(webDavConfigData));
          }
        }
      } catch (e) {
        console.warn('Failed to fetch configs from KV.', e);
      }

      if (!hasCloudData) {
        loadFromLocal();
        if (!hasSearchConfig) {
          setSearchMode('internal');
          setExternalSearchSources(createDefaultSearchSources());
        }
      }

      setIsLoadingSearchConfig(false);
      setIsCheckingAuth(false);
    };

    initData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};

export const fetchProtectedConfigsAfterLogin = async ({
  password,
  buildAuthHeaders,
  setAiConfig,
  setWebDavConfig,
  fallbackApiKey = '',
}: {
  password: string;
  buildAuthHeaders: (token?: string | null, extraHeaders?: Record<string, string>) => Record<string, string>;
  setAiConfig: (config: AIConfig) => void;
  setWebDavConfig: (config: WebDavConfig) => void;
  fallbackApiKey?: string;
}) => {
  try {
    const aiConfigRes = await fetch('/api/storage?getConfig=ai', { headers: buildAuthHeaders(password) });
    if (aiConfigRes.ok) {
      const aiConfigData = await aiConfigRes.json();
      if (aiConfigData && Object.keys(aiConfigData).length > 0) {
        const normalizedAIConfig = normalizeAIConfig(aiConfigData, fallbackApiKey);
        setAiConfig(normalizedAIConfig);
        localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(normalizedAIConfig));
      }
    }
  } catch (e) {
    console.warn('Failed to fetch AI config after login.', e);
  }

  try {
    const webDavConfigRes = await fetch('/api/storage?getConfig=webdav', { headers: buildAuthHeaders(password) });
    if (webDavConfigRes.ok) {
      const webDavConfigData = await webDavConfigRes.json();
      if (webDavConfigData && (webDavConfigData.url || webDavConfigData.username || webDavConfigData.password || webDavConfigData.enabled !== undefined)) {
        setWebDavConfig(webDavConfigData);
        localStorage.setItem(WEBDAV_CONFIG_KEY, JSON.stringify(webDavConfigData));
      }
    }
  } catch (e) {
    console.warn('Failed to fetch WebDAV config after login.', e);
  }
};
