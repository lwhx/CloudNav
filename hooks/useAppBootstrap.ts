import { useEffect } from 'react';
import { AIConfig, Category, CategoryGroup, DEFAULT_CATEGORIES, DEFAULT_CATEGORY_GROUP, LinkItem, SearchConfig, SiteSettings, WebDavConfig } from '../types';
import { createDefaultSearchSources } from './useSearchConfig';
import { saveLocalAppData } from '../services/appDataPersistence';

const AUTH_KEY = 'cloudnav_auth_token';
const AUTH_TIME_KEY = 'lastLoginTime';
const WEBDAV_CONFIG_KEY = 'cloudnav_webdav_config';
const AI_CONFIG_KEY = 'cloudnav_ai_config';

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
  setWebDavConfig: (config: WebDavConfig) => void;
  setPrefillLink: (link?: Partial<LinkItem>) => void;
  setEditingLink: (link?: LinkItem) => void;
  setIsModalOpen: (open: boolean) => void;
  setIsAuthOpen: (open: boolean) => void;
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
  setWebDavConfig,
  setPrefillLink,
  setEditingLink,
  setIsModalOpen,
  setIsAuthOpen,
}: UseAppBootstrapOptions) => {
  useEffect(() => {
    const savedToken = localStorage.getItem(AUTH_KEY);
    const lastLoginTime = localStorage.getItem(AUTH_TIME_KEY);

    if (savedToken) {
      const currentTime = Date.now();
      const expiryDays = siteSettings.passwordExpiryDays || 7;
      const expiryTimeMs = expiryDays > 0 ? expiryDays * 24 * 60 * 60 * 1000 : 0;
      const lastLogin = lastLoginTime ? parseInt(lastLoginTime, 10) : 0;

      if (expiryTimeMs > 0 && lastLogin > 0 && currentTime - lastLogin > expiryTimeMs) {
        clearAuthSession();
      } else {
        setAuthToken(savedToken);
      }
    }

    const savedWebDav = localStorage.getItem(WEBDAV_CONFIG_KEY);
    if (savedWebDav) {
      try {
        setWebDavConfig(JSON.parse(savedWebDav));
      } catch {}
    }

    const urlParams = new URLSearchParams(window.location.search);
    const addUrl = urlParams.get('add_url');
    if (addUrl) {
      const addTitle = urlParams.get('add_title') || '';
      window.history.replaceState({}, '', window.location.pathname);
      setPrefillLink({ title: addTitle, url: addUrl, categoryId: 'common' });
      setEditingLink(undefined);
      if (savedToken) {
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

          if (authData.hasPassword && savedToken) {
            const validateRes = await fetch('/api/storage', {
              method: 'POST',
              headers: buildAuthHeaders(savedToken, { 'Content-Type': 'application/json' }),
              body: JSON.stringify({ authOnly: true }),
            });

            if (!validateRes.ok) {
              clearAuthSession();
            } else {
              const validateData = await validateRes.json();
              if (validateData?.authenticatedAt) {
                localStorage.setItem(AUTH_TIME_KEY, String(validateData.authenticatedAt));
                setAuthToken(savedToken);
              }
            }
          }

          if (authData.requiresAuth && !savedToken) {
            setIsCheckingAuth(false);
            return;
          }
        }
      } catch (e) {
        console.warn('Failed to check auth requirement.', e);
      }

      let hasCloudData = false;
      const activeToken = savedToken || authToken;
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
            setLinks(cloudLinks);
            setCategories(cloudCategories);
            setCategoryGroups(cloudCategoryGroups);
            saveLocalAppData(cloudLinks, cloudCategories, cloudCategoryGroups);
            loadLinkIcons(cloudLinks, cloudCategories, activeToken || undefined);
            hasCloudData = true;
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
        const searchConfigRes = await fetch('/api/storage?getConfig=search');
        if (searchConfigRes.ok) {
          const searchConfigData = await searchConfigRes.json();
          if (searchConfigData && (searchConfigData.mode || searchConfigData.externalSources || searchConfigData.selectedSource)) {
            setSearchMode(searchConfigData.mode || 'internal');
            setExternalSearchSources(searchConfigData.externalSources || []);
            if (searchConfigData.selectedSource) {
              setSelectedSearchSource(searchConfigData.selectedSource);
            }
          }
        }

        const websiteConfigRes = await fetch('/api/storage?getConfig=website');
        if (websiteConfigRes.ok) {
          const websiteConfigData = await websiteConfigRes.json();
          if (websiteConfigData) applyWebsiteConfig(websiteConfigData);
        }

        if (savedToken) {
          const webDavConfigRes = await fetch('/api/storage?getConfig=webdav', {
            headers: buildAuthHeaders(savedToken),
          });
          if (webDavConfigRes.ok) {
            const webDavConfigData = await webDavConfigRes.json();
            if (webDavConfigData && (webDavConfigData.url || webDavConfigData.username || webDavConfigData.password || webDavConfigData.enabled !== undefined)) {
              setWebDavConfig(webDavConfigData);
              localStorage.setItem(WEBDAV_CONFIG_KEY, JSON.stringify(webDavConfigData));
            }
          }
        }
      } catch (e) {
        console.warn('Failed to fetch configs from KV.', e);
      }

      if (!hasCloudData) {
        loadFromLocal();
        setSearchMode('internal');
        setExternalSearchSources(createDefaultSearchSources());
      }

      setIsLoadingSearchConfig(false);
      setIsCheckingAuth(false);
    };

    initData();
  }, []);
};

export const fetchProtectedConfigsAfterLogin = async ({
  password,
  buildAuthHeaders,
  setAiConfig,
  setWebDavConfig,
}: {
  password: string;
  buildAuthHeaders: (token?: string | null, extraHeaders?: Record<string, string>) => Record<string, string>;
  setAiConfig: (config: AIConfig) => void;
  setWebDavConfig: (config: WebDavConfig) => void;
}) => {
  try {
    const aiConfigRes = await fetch('/api/storage?getConfig=ai', { headers: buildAuthHeaders(password) });
    if (aiConfigRes.ok) {
      const aiConfigData = await aiConfigRes.json();
      if (aiConfigData && Object.keys(aiConfigData).length > 0) {
        setAiConfig(aiConfigData);
        localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(aiConfigData));
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
