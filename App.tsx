
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Search, Plus, Moon, Sun, Menu, Loader2, Cloud,
  Settings, GitFork, LogOut, ExternalLink, X, FolderPlus
} from 'lucide-react';
import { LinkItem, Category, CategoryGroup, DEFAULT_CATEGORIES, DEFAULT_CATEGORY_GROUP, DEFAULT_CATEGORY_GROUP_ID, WebDavConfig, AIConfig, SearchConfig, AICategorySuggestion, SiteSettings } from './types';
import Icon from './components/Icon';
import LinkModal from './components/LinkModal';
import AuthModal from './components/AuthModal';
import CategoryManagerModal from './components/CategoryManagerModal';
import BackupModal from './components/BackupModal';
import CategoryAuthModal from './components/CategoryAuthModal';
import ImportModal from './components/ImportModal';
import SettingsModal from './components/SettingsModal';
import SearchConfigModal from './components/SearchConfigModal';
import ContextMenu from './components/ContextMenu';
import QRCodeModal from './components/QRCodeModal';
import TrashModal from './components/TrashModal';
import ToastContainer from './components/ToastContainer';
import { useToast } from './hooks/useToast';
import { useTheme } from './hooks/useTheme';
import { useSiteSettings } from './hooks/useSiteSettings';
import { useContextMenu } from './hooks/useContextMenu';
import { useAppDataSync } from './hooks/useAppDataSync';
import { useAuthSession } from './hooks/useAuthSession';
import { useSearchConfig } from './hooks/useSearchConfig';
import { useCategoryAccess } from './hooks/useCategoryAccess';
import { useLinkOrganizer } from './hooks/useLinkOrganizer';
import { fetchProtectedConfigsAfterLogin, useAppBootstrap } from './hooks/useAppBootstrap';
import { saveLocalAppData, normalizeTags } from './services/appDataPersistence';
import { getDefaultAIConfig, normalizeAIConfig } from './services/aiConfigService';
import { sortCategoryLinks } from './services/linkOrdering';
import LinkCard from './components/links/LinkCard';
import GroupSidebar from './components/navigation/GroupSidebar';
import CategorySection from './components/navigation/CategorySection';

// --- 配置项 ---
// 项目核心仓库地址
const GITHUB_REPO_URL = 'https://github.com/Aaowu/CloudNav-Oorz';

const AUTH_KEY = 'cloudnav_auth_token';
const AUTH_TIME_KEY = 'lastLoginTime';
const WEBDAV_CONFIG_KEY = 'cloudnav_webdav_config';
const AI_CONFIG_KEY = 'cloudnav_ai_config';
const ACTIVE_GROUP_KEY = 'cloudnav_active_group';

const mergeCategoryGroups = (currentGroups: CategoryGroup[], incomingGroups: CategoryGroup[] = []) => {
  const map = new Map<string, CategoryGroup>();
  [...currentGroups, ...incomingGroups].forEach(group => {
    if (group?.id) map.set(group.id, group);
  });
  if (!map.has(DEFAULT_CATEGORY_GROUP.id)) map.set(DEFAULT_CATEGORY_GROUP.id, DEFAULT_CATEGORY_GROUP);
  return Array.from(map.values()).sort((a, b) => (a.order || 0) - (b.order || 0));
};

import { buildPinyinIndex, PinyinIndex } from './services/pinyinIndex';
import { useDebouncedValue } from './hooks/useDebouncedValue';

const matchesLinkQuery = (link: LinkItem, rawQuery: string, pinyinMap?: Map<string, PinyinIndex>) => {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  const tags = link.tags || [];
  if (query.startsWith('#')) {
    const tagQuery = query.slice(1);
    return tags.some(tag => tag.toLowerCase() === tagQuery || tag.toLowerCase().includes(tagQuery));
  }
  const baseMatch = link.title.toLowerCase().includes(query)
    || link.url.toLowerCase().includes(query)
    || !!link.description?.toLowerCase().includes(query)
    || tags.some(tag => tag.toLowerCase().includes(query));
  if (baseMatch) return true;
  // 拼音匹配：让 "kaifa" 命中 "开发"。仅对标题做（URL/描述/标签多为英文，拼音收益小）。
  const py = pinyinMap?.get(link.id);
  if (py) {
    return py.full.includes(query) || py.initial.includes(query);
  }
  return false;
};

const buildGroupedCategories = (groups: CategoryGroup[], categories: Category[]) => {
  const activeGroups = groups.filter(group => !group.deletedAt);
  const groupMap = new Map(activeGroups.map(group => [group.id, { ...group, categories: [] as Category[] }]));

  if (!groupMap.has(DEFAULT_CATEGORY_GROUP_ID)) {
    groupMap.set(DEFAULT_CATEGORY_GROUP_ID, { ...DEFAULT_CATEGORY_GROUP, categories: [] });
  }

  categories.filter(category => !category.deletedAt).forEach(category => {
    const groupId = category.groupId && groupMap.has(category.groupId) ? category.groupId : DEFAULT_CATEGORY_GROUP_ID;
    groupMap.get(groupId)?.categories.push(category);
  });

  groupMap.forEach(group => {
    group.categories.sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  });

  return Array.from(groupMap.values()).sort((a, b) => (a.order || 0) - (b.order || 0));
};

const mergeTags = (currentTags: string[] | undefined, rawTags: string, remove = false) => {
  const parsedTags = normalizeTags(rawTags.split(/[，,\n]/));
  if (parsedTags.length === 0) return currentTags || [];
  if (remove) {
    const removeSet = new Set(parsedTags.map(tag => tag.toLowerCase()));
    return (currentTags || []).filter(tag => !removeSet.has(tag.toLowerCase()));
  }
  return normalizeTags([...(currentTags || []), ...parsedTags]);
};

const compareLinksByImportanceAndOrder = (a: LinkItem, b: LinkItem) => {
  if (a.important && !b.important) return -1;
  if (!a.important && b.important) return 1;
  const aOrder = a.order !== undefined ? a.order : a.createdAt;
  const bOrder = b.order !== undefined ? b.order : b.createdAt;
  return aOrder - bOrder;
};


function App() {
  const { darkMode, themeTransition, themeButtonRef, toggleTheme } = useTheme();
  const { siteSettings, setSiteSettings, handleViewModeChange } = useSiteSettings();

  // --- State ---
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [activeGroupId, setActiveGroupId] = useState(() => localStorage.getItem(ACTIVE_GROUP_KEY) || '');
  const [activeAnchorId, setActiveAnchorId] = useState('');
  const [managementMode, setManagementMode] = useState(false);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<Set<string>>(new Set());
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(new Set());
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const browsingScrollTopRef = useRef(0);
  const wasSearchingRef = useRef(false);
  const [searchInput, setSearchInput] = useState('');
  const searchQuery = useDebouncedValue(searchInput, 200);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // WebDAV Config State
  const [webDavConfig, setWebDavConfig] = useState<WebDavConfig>({
      url: '',
      username: '',
      password: '',
      enabled: false
  });

  // AI Config State
  const [aiConfig, setAiConfig] = useState<AIConfig>(() => {
      const saved = localStorage.getItem(AI_CONFIG_KEY);
      if (saved) {
          try {
              return normalizeAIConfig(JSON.parse(saved), process.env.API_KEY || '');
          } catch { /* ignore corrupted local config */ }
      }
      return getDefaultAIConfig(process.env.API_KEY || '');
  });

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isCatManagerOpen, setIsCatManagerOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSearchConfigModalOpen, setIsSearchConfigModalOpen] = useState(false);
  const [isTrashModalOpen, setIsTrashModalOpen] = useState(false);
  const [batchTagText, setBatchTagText] = useState('');
  const [editingLink, setEditingLink] = useState<LinkItem | undefined>(undefined);
  // State for data pre-filled from Bookmarklet
  const [prefillLink, setPrefillLink] = useState<Partial<LinkItem> | undefined>(undefined);
  
  // Sync State
  const { toasts, showToast, removeToast } = useToast();
  const {
    authToken,
    setAuthToken,
    requiresAuth,
    setRequiresAuth,
    isCheckingAuth,
    setIsCheckingAuth,
    buildAuthHeaders,
    clearAuthSession,
    requireAuth: requireAuthSession,
  } = useAuthSession();
  
  // Mobile Search State
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);

  const getSyncStatusText = () => {
    if (!authToken) return '离线模式';
    if (syncStatus === 'saving') return '正在同步';
    if (syncStatus === 'saved') return '已同步';
    if (syncStatus === 'error') return '同步失败';
    return '云端已连接';
  };

  const requireAuth = () => requireAuthSession(() => setIsAuthOpen(true));

  const {
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
  } = useAppDataSync({
    authToken,
    buildAuthHeaders,
    onAuthExpired: () => {
      clearAuthSession();
      setIsAuthOpen(true);
      showToast('登录已过期，请重新登录', 'warning');
    },
    onSyncError: () => {
      showToast('云端同步失败，本机已保存', 'error');
    },
    onSyncOffline: () => {
      showToast('当前未连接云端，本地修改暂存本机', 'warning');
    },
    onSyncRetrying: (attempt, nextDelayMs) => {
      const seconds = Math.round(nextDelayMs / 1000);
      showToast(`云端同步失败，${seconds}秒后重试（第 ${attempt} 次）`, 'warning');
    },
    onSyncGiveUp: () => {
      showToast('云端同步多次失败，请检查网络后手动重试', 'error');
    },
  });

  const {
    searchMode,
    setSearchMode,
    externalSearchSources,
    setExternalSearchSources,
    setIsLoadingSearchConfig,
    showSearchSourcePopup,
    toggleSearchSourcePopup,
    popupRef,
    hoveredSearchSource,
    setHoveredSearchSource,
    selectedSearchSource,
    setSelectedSearchSource,
    setIsIconHovered,
    setIsPopupHovered,
    handleSearchSourceSelect,
    handleSaveSearchConfig,
    openSearchConfigModal: openSearchConfigModalFromHook,
    handleSearchConfigModalSave,
    handleSearchModeChange,
    handleExternalSearch,
  } = useSearchConfig({
    authToken,
    buildAuthHeaders,
    requireAuth,
    searchQuery,
  });

  const openSearchConfigModal = () => openSearchConfigModalFromHook(() => setIsSearchConfigModalOpen(true));

  const {
    catAuthModalData,
    setCatAuthModalData,
    handleUnlockCategory,
    handleDeleteCategory,
    handleCategoryActionAuth,
    isCategoryLocked,
  } = useCategoryAccess({
    categories,
    links,
    updateData,
    requireAuth,
    showToast,
    buildAuthHeaders,
    setSelectedCategory,
    setSidebarOpen,
    onUnlocked: async () => {
      const response = await fetch('/api/storage', { headers: buildAuthHeaders() });
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data.links)) setLinks(previous => {
        const linkById = new Map(data.links.map((link: LinkItem) => [link.id, link]));
        previous.forEach(link => linkById.set(link.id, link));
        return Array.from(linkById.values());
      });
      if (Array.isArray(data.categories)) setCategories(data.categories);
      if (Array.isArray(data.categoryGroups)) setCategoryGroups(data.categoryGroups);
    },
  });

  // --- Effects ---

  useAppBootstrap({
    authToken,
    siteSettings,
    links,
    categories,
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
    fallbackApiKey: process.env.API_KEY || '',
  });

  const handleLogin = async (password: string): Promise<boolean> => {
      try {
        // 首先验证密码
        const authResponse = await fetch('/api/storage', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-password': password
            },
            body: JSON.stringify({ authOnly: true }) // 只用于验证密码，不更新数据
        });
        
        if (authResponse.ok) {
            const authPayload = await authResponse.json();
            // 服务端签发会话令牌；客户端只存令牌，不再持久化原始主密码。
            const sessionToken = authPayload.sessionToken || '';
            if (sessionToken) {
                setAuthToken(sessionToken);
                localStorage.setItem(AUTH_KEY, sessionToken);
            }
            setIsAuthOpen(false);
            setSyncStatus('saved');
            
            // 登录成功后，获取网站配置（包括密码过期时间设置）
            // 提到 try 外，使后续过期判断能用本次拉取的最新值（而非闭包里的旧 siteSettings）
            let fetchedExpiryDays: number | undefined;
            try {
                const websiteConfigRes = await fetch('/api/storage?getConfig=website');
                if (websiteConfigRes.ok) {
                    const websiteConfigData = await websiteConfigRes.json();
                    if (websiteConfigData) {
                        if (websiteConfigData.passwordExpiryDays !== undefined) {
                            fetchedExpiryDays = websiteConfigData.passwordExpiryDays;
                        }
                        setSiteSettings(prev => ({
                            ...prev,
                            title: websiteConfigData.title || prev.title,
                            navTitle: websiteConfigData.navTitle || prev.navTitle,
                            favicon: websiteConfigData.favicon || prev.favicon,
                            cardStyle: websiteConfigData.cardStyle || prev.cardStyle,
                            requirePasswordOnVisit: websiteConfigData.requirePasswordOnVisit !== undefined ? websiteConfigData.requirePasswordOnVisit : prev.requirePasswordOnVisit,
                            passwordExpiryDays: websiteConfigData.passwordExpiryDays !== undefined ? websiteConfigData.passwordExpiryDays : prev.passwordExpiryDays
                        }));
                    }
                }
            } catch (e) {
                console.warn("Failed to fetch website config after login.", e);
            }

            // 检查密码是否过期
            const lastLoginTime = localStorage.getItem(AUTH_TIME_KEY);
            const currentTime = Date.now();

            if (lastLoginTime) {
                const lastLogin = parseInt(lastLoginTime);
                const timeDiff = currentTime - lastLogin;

                // 优先用本次刚拉取的配置，避免管理员在云端改了过期天数后仍按旧值判断
                const expiryDays = fetchedExpiryDays ?? siteSettings.passwordExpiryDays ?? 7;
                const expiryTimeMs = expiryDays > 0 ? expiryDays * 24 * 60 * 60 * 1000 : 0;
                
                if (expiryTimeMs > 0 && timeDiff > expiryTimeMs) {
                    clearAuthSession();
                    setIsAuthOpen(true);
                    showToast('登录已过期，请重新登录', 'warning');
                    return false;
                }
            }
            
            localStorage.setItem(AUTH_TIME_KEY, String(authPayload.authenticatedAt || currentTime));
            
            // 登录成功后，从服务器获取数据
            try {
                const res = await fetch('/api/storage', {
                    headers: buildAuthHeaders(sessionToken)
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
                        loadLinkIcons(cloudLinks, cloudCategories);
                    } else {
                        saveLocalAppData(links, categories, categoryGroups);
                        syncToCloud(links, categories, password, categoryGroups);
                        loadLinkIcons(links, categories);
                    }
                } 
            } catch (e) {
                console.warn("Failed to fetch data after login.", e);
                loadFromLocal();
                // 尝试将本地数据同步到服务器
                syncToCloud(links, categories, password, categoryGroups);
            }
            
            // 登录成功后，从KV空间加载AI配置
            await fetchProtectedConfigsAfterLogin({
                password: sessionToken,
                buildAuthHeaders,
                setAiConfig,
                setWebDavConfig,
                                fallbackApiKey: process.env.API_KEY || '',
            });

            // 来自书签小工具（?add_url=...）的登录：认证成功后打开链接编辑弹窗，
            // 否则 prefillLink 数据会悬而未用，用户无感知。
            if (prefillLink) setIsModalOpen(true);

            return true;
        }
        return false;
      } catch {
          return false;
      }
  };

  const handleLogout = () => {
      clearAuthSession();

      setSyncStatus('offline');
      // 退出后重新加载本地数据
      loadFromLocal();
  };

  const handleImportConfirm = (newLinks: LinkItem[], newCategories: Category[], newCategoryGroups?: CategoryGroup[]) => {
      // Merge categories: 同名或同 id 视为重复；id 撞但 name 不同则重新生成 id 并 remap 链接，
      // 避免该分类被静默丢弃、其链接变成指向错误分类的孤儿。
      const mergedCategories = [...categories];
      const existingNameSet = new Set(mergedCategories.map(c => c.name));
      const existingIdSet = new Set(mergedCategories.map(c => c.id));
      const categoryIdRemap = new Map<string, string>();
      let importedLinks = [...newLinks];

      // 确保"常用推荐"分类始终存在
      if (!mergedCategories.some(c => c.id === 'common')) {
        mergedCategories.push({ id: 'common', name: '常用推荐', icon: 'Star' });
        existingIdSet.add('common');
        existingNameSet.add('常用推荐');
      }

      newCategories.forEach(nc => {
          // 软删除的分类直接保留（恢复场景）
          if (nc.deletedAt) {
              mergedCategories.push(nc);
              return;
          }
          // 同名：保留现有分类，把导入链接 remap 到现有同名分类
          if (existingNameSet.has(nc.name)) {
              const existing = mergedCategories.find(c => c.name === nc.name);
              if (existing && existing.id !== nc.id) {
                  categoryIdRemap.set(nc.id, existing.id);
              }
              return;
          }
          // 同 id 但不同 name：保留为新分类，重新生成 id 避免覆盖
          if (existingIdSet.has(nc.id)) {
              const newId = crypto.randomUUID();
              categoryIdRemap.set(nc.id, newId);
              const remapped = { ...nc, id: newId };
              mergedCategories.push(remapped);
              existingIdSet.add(newId);
              existingNameSet.add(nc.name);
              return;
          }
          // 全新分类
          mergedCategories.push(nc);
          existingIdSet.add(nc.id);
          existingNameSet.add(nc.name);
      });

      if (categoryIdRemap.size > 0) {
          importedLinks = importedLinks.map(link => {
              const remapped = categoryIdRemap.get(link.categoryId);
              return remapped ? { ...link, categoryId: remapped } : link;
          });
      }

      const mergedLinks = [...links, ...importedLinks];
      const mergedGroups = newCategoryGroups?.length ? mergeCategoryGroups(categoryGroups, newCategoryGroups) : categoryGroups;
      updateData(mergedLinks, mergedCategories, mergedGroups);
      setIsImportModalOpen(false);
      showToast(`成功导入 ${importedLinks.length} 个新书签`, 'success');
  };

  const handleSaveAIConfig = async (config: AIConfig, newSiteSettings?: SiteSettings) => {
      const normalizedConfig = normalizeAIConfig(config, process.env.API_KEY || '');
      setAiConfig(normalizedConfig);
      localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(normalizedConfig));
      
      if (newSiteSettings) {
          setSiteSettings(newSiteSettings);
          localStorage.setItem('cloudnav_site_settings', JSON.stringify(newSiteSettings));
      }
      
      if (authToken) {
          try {
              const response = await fetch('/api/storage', {
                  method: 'POST',
                  headers: buildAuthHeaders(authToken, {
                      'Content-Type': 'application/json',
                  }),
                  body: JSON.stringify({
                      saveConfig: 'ai',
                      config: normalizedConfig
                  })
              });
              
              if (!response.ok) {
                  console.error('Failed to save AI config to KV:', response.statusText);
              }
          } catch (error) {
              console.error('Error saving AI config to KV:', error);
          }
          
          if (newSiteSettings) {
              try {
                  const response = await fetch('/api/storage', {
                      method: 'POST',
                      headers: buildAuthHeaders(authToken, {
                          'Content-Type': 'application/json',
                      }),
                      body: JSON.stringify({
                          saveConfig: 'website',
                          config: newSiteSettings
                      })
                  });
                  
                  if (!response.ok) {
                      console.error('Failed to save website config to KV:', response.statusText);
                  }
              } catch (error) {
                  console.error('Error saving website config to KV:', error);
              }
          }
      }
  };

  const handleRestoreAIConfig = async (config: AIConfig) => {
      const normalizedConfig = normalizeAIConfig(config, process.env.API_KEY || '');
      setAiConfig(normalizedConfig);
      localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(normalizedConfig));
      
      // 同时保存到KV空间
      if (authToken) {
          try {
              const response = await fetch('/api/storage', {
                  method: 'POST',
                  headers: buildAuthHeaders(authToken, {
                      'Content-Type': 'application/json',
                  }),
                  body: JSON.stringify({
                      saveConfig: 'ai',
                      config: normalizedConfig
                  })
              });
              
              if (!response.ok) {
                  console.error('Failed to restore AI config to KV:', response.statusText);
              }
          } catch (error) {
              console.error('Error restoring AI config to KV:', error);
          }
      }
  };

  // --- WebDAV Config ---
  const handleSaveWebDavConfig = (config: WebDavConfig) => {
      setWebDavConfig(config);
      localStorage.setItem(WEBDAV_CONFIG_KEY, JSON.stringify(config));

      if (authToken) {
          fetch('/api/storage', {
              method: 'POST',
              headers: buildAuthHeaders(authToken, {
                  'Content-Type': 'application/json',
              }),
              body: JSON.stringify({
                  saveConfig: 'webdav',
                  config,
              })
          }).catch((error) => {
              console.error('Error saving WebDAV config to KV:', error);
          });
      }
  };

  const handleRestoreWebDavConfig = (config: WebDavConfig) => {
      handleSaveWebDavConfig(config);
  };

 const handleRestoreBackup = (restoredLinks: LinkItem[], restoredCategories: Category[], restoredCategoryGroups?: CategoryGroup[]) => {
      updateData(restoredLinks, restoredCategories, restoredCategoryGroups);
      setIsBackupModalOpen(false);
  };

  const handleRestoreSearchConfig = (restoredSearchConfig: SearchConfig) => {
      handleSaveSearchConfig(restoredSearchConfig.externalSources, restoredSearchConfig.mode);
  };

  const handleApplyCategorySuggestions = (suggestions: AICategorySuggestion[]) => {
    if (!suggestions.length) return;
    const now = Date.now();
    const existingNames = new Set(categories.filter(category => !category.deletedAt).map(category => category.name.trim().toLowerCase()));
    const nextCategories = [...categories];
    const linkCategoryMap = new Map<string, string>();

    suggestions.forEach((suggestion, index) => {
      const name = suggestion.name.trim();
      if (!name || existingNames.has(name.toLowerCase())) return;
      const categoryId = `ai-cat-${now}-${index}`;
      existingNames.add(name.toLowerCase());
      nextCategories.push({
        id: categoryId,
        name,
        icon: suggestion.icon || 'Folder',
        groupId: DEFAULT_CATEGORY_GROUP_ID,
      });
      suggestion.linkIds.forEach(linkId => linkCategoryMap.set(linkId, categoryId));
    });

    if (linkCategoryMap.size === 0) {
      showToast('没有可应用的新分类建议', 'info');
      return;
    }

    const nextLinks = links.map(link => {
      const targetCategoryId = linkCategoryMap.get(link.id);
      return targetCategoryId ? { ...link, categoryId: targetCategoryId } : link;
    });
    updateData(nextLinks, nextCategories, categoryGroups);
    showToast(`已创建 ${suggestions.length} 个 AI 建议分类并移动匹配链接`, 'success');
  };

  const groupedCategories = useMemo(() => buildGroupedCategories(categoryGroups, categories), [categoryGroups, categories]);

  const navigationGroups = useMemo(() => groupedCategories.map(group => {
    const groupCategoryIds = new Set(group.categories.map(category => category.id));
    const linkCount = links.filter(link => !link.deletedAt && groupCategoryIds.has(link.categoryId) && !isCategoryLocked(link.categoryId)).length;
    return { ...group, categoryCount: group.categories.length, linkCount };
  }).filter(group => group.categoryCount > 0), [groupedCategories, isCategoryLocked, links]);

  useEffect(() => {
    const fallbackGroup = navigationGroups[0];
    if (!fallbackGroup) return;
    if (!navigationGroups.some(group => group.id === activeGroupId)) {
      setActiveGroupId(fallbackGroup.id);
      localStorage.setItem(ACTIVE_GROUP_KEY, fallbackGroup.id);
    }
  }, [activeGroupId, navigationGroups]);

  const activeGroup = useMemo(() => navigationGroups.find(group => group.id === activeGroupId) || navigationGroups[0], [activeGroupId, navigationGroups]);
  const activeGroupCategories = useMemo(() => activeGroup?.categories || [], [activeGroup]);

  useEffect(() => {
    if (!activeGroupCategories.length) {
      setActiveAnchorId('');
      return;
    }
    setActiveAnchorId(activeGroupCategories[0].id);
    const root = contentScrollRef.current;
    if (!root || searchQuery.trim()) return;
    const sections = activeGroupCategories.map(category => document.getElementById(`category-${category.id}`)).filter((section): section is HTMLElement => !!section);
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActiveAnchorId((visible.target as HTMLElement).dataset.categorySection || '');
    }, { root, rootMargin: '-120px 0px -65% 0px', threshold: [0, 0.1] });
    sections.forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, [activeGroupId, activeGroupCategories, searchQuery]);

  const selectGroup = (groupId: string) => {
    setActiveGroupId(groupId);
    localStorage.setItem(ACTIVE_GROUP_KEY, groupId);
    setSidebarOpen(false);
    setSelectedCategory('all');
    setManagementMode(false);
    closeBatchEditMode();
    contentScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openGroupManager = () => {
    if (!requireAuth()) return;
    setSidebarOpen(false);
    setIsCatManagerOpen(true);
  };

  const handleCategoryManagerUpdate = (newCategories: Category[], newCategoryGroups?: CategoryGroup[]) => {
    const nextGroups = newCategoryGroups || categoryGroups;
    const previousGroupIds = new Set(categoryGroups.filter(group => !group.deletedAt).map(group => group.id));
    const addedGroup = nextGroups.find(group => !group.deletedAt && !previousGroupIds.has(group.id));
    updateData(links, newCategories, nextGroups);
    if (addedGroup) {
      setActiveGroupId(addedGroup.id);
      localStorage.setItem(ACTIVE_GROUP_KEY, addedGroup.id);
    }
  };

  useEffect(() => {
    if (!sidebarOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [sidebarOpen]);

  const scrollToCategory = (categoryId: string) => {
    setActiveAnchorId(categoryId);
    document.getElementById(`category-${categoryId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    const searching = !!searchQuery.trim();
    const scrollContainer = contentScrollRef.current;
    if (!scrollContainer) return;
    if (searching && !wasSearchingRef.current) {
      browsingScrollTopRef.current = scrollContainer.scrollTop;
      scrollContainer.scrollTo({ top: 0 });
    } else if (!searching && wasSearchingRef.current) {
      window.requestAnimationFrame(() => contentScrollRef.current?.scrollTo({ top: browsingScrollTopRef.current }));
    }
    wasSearchingRef.current = searching;
  }, [searchQuery]);

  const toggleCategorySet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, categoryId: string) => setter(previous => {
    const next = new Set(previous);
    if (next.has(categoryId)) next.delete(categoryId);
    else next.add(categoryId);
    return next;
  });

  const linksByCategory = useMemo(() => {
    const map = new Map<string, LinkItem[]>();
    categories.filter(category => !category.deletedAt).forEach(category => map.set(category.id, []));
    links.filter(link => !link.deletedAt).forEach(link => map.get(link.categoryId)?.push(link));
    map.forEach((categoryLinks, categoryId) => map.set(categoryId, sortCategoryLinks(categoryLinks)));
    return map;
  }, [categories, links]);

  const handleBatchTagChange = (remove = false) => {
    if (!authToken) {
      setIsAuthOpen(true);
      return;
    }
    if (selectedLinks.size === 0) {
      showToast('请先选择要处理的链接', 'warning');
      return;
    }
    const parsedTags = normalizeTags(batchTagText.split(/[，,\n]/));
    if (parsedTags.length === 0) {
      showToast('请先输入标签，多个标签用逗号分隔', 'warning');
      return;
    }
    const newLinks = links.map(link => selectedLinks.has(link.id) ? { ...link, tags: mergeTags(link.tags, batchTagText, remove) } : link);
    updateData(newLinks, categories, categoryGroups);
    setBatchTagText('');
    showToast(remove ? '已批量移除标签' : '已批量添加标签', 'success');
  };

  // --- Filtering & Memo ---

  // 拼音索引：仅在 links 变化时重算，供搜索匹配使用。
  const pinyinIndex = useMemo(() => buildPinyinIndex(links), [links]);

  const displayedLinks = useMemo(() => {
    let result = links.filter(link => !link.deletedAt);
    
    // Security Filter: Always hide links from locked categories
    result = result.filter(l => !isCategoryLocked(l.categoryId));

    // Search Filter
    if (searchQuery.trim()) {
      result = result.filter(l => matchesLinkQuery(l, searchQuery, pinyinIndex));
    }

    // Category Filter
    if (!searchQuery.trim() && selectedCategory !== 'all') {
      result = result.filter(l => l.categoryId === selectedCategory);
    }
    
    // 按照order字段排序，如果没有order字段则按创建时间排序
    // 修改排序逻辑：order值越大排在越前面，新增的卡片order值最大，会排在最前面
    // 我们需要反转这个排序，让新增的卡片(order值最大)排在最后面
    return result.sort((a, b) => {
      const aOrder = a.order !== undefined ? a.order : a.createdAt;
      const bOrder = b.order !== undefined ? b.order : b.createdAt;
      // 改为升序排序，这样order值小(旧卡片)的排在前面，order值大(新卡片)的排在后面
      return aOrder - bOrder;
    });
  }, [isCategoryLocked, links, pinyinIndex, searchQuery, selectedCategory]);

  const activeGroupLinks = useMemo(() => activeGroupCategories.flatMap(category => isCategoryLocked(category.id) ? [] : (linksByCategory.get(category.id) || [])), [activeGroupCategories, isCategoryLocked, linksByCategory]);

  // 计算其他目录的搜索结果
  const _otherCategoryResults = useMemo<Record<string, LinkItem[]>>(() => {
    if (!searchQuery.trim() || selectedCategory === 'all') {
      return {};
    }

    // 获取其他目录中匹配的链接
    const otherLinks = links.filter(link => {
      if (link.deletedAt) return false;
      // 排除当前目录的链接
      if (link.categoryId === selectedCategory) {
        return false;
      }
      
      // 排除锁定的目录
      if (isCategoryLocked(link.categoryId)) {
        return false;
      }
      
      // 搜索匹配
      return matchesLinkQuery(link, searchQuery, pinyinIndex);
    });

    // 按目录分组
    const groupedByCategory = otherLinks.reduce((acc, link) => {
      if (!acc[link.categoryId]) {
        acc[link.categoryId] = [];
      }
      acc[link.categoryId].push(link);
      return acc;
    }, {} as Record<string, LinkItem[]>);

    // 对每个目录内的链接进行排序
    Object.keys(groupedByCategory).forEach(categoryId => {
      groupedByCategory[categoryId].sort(compareLinksByImportanceAndOrder);
    });

    return groupedByCategory;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links, selectedCategory, searchQuery, categories, isCategoryLocked, pinyinIndex]);


  const {
    isSortingMode,
    isBatchEditMode,
    selectedLinks,
    toggleBatchEditMode,
    closeBatchEditMode,
    toggleLinkSelection,
    handleBatchDelete,
    handleBatchMove,
    handleSelectAll,
    handleAddLink,
    handleEditLink,
    handleDragEnd,
    startSorting,
    saveSorting,
    cancelSorting,
    sensors,
    handleDeleteLink,
    togglePinFromLink,
    toggleImportantFromLink,
  } = useLinkOrganizer({
    links,
    categories,
    selectedCategory,
    setSelectedCategory,
    displayedLinks: searchQuery.trim() ? displayedLinks : activeGroupLinks,
    authToken,
    requireAuth,
    updateData,
    showToast,
    editingLink,
    setEditingLink,
    setPrefillLink,
    setIsAuthOpen,
  });

  // --- Context Menu Hook ---
  const {
    contextMenu, qrCodeModal,
    handleContextMenu, closeContextMenu, copyLinkToClipboard,
    showQRCode, editLinkFromContextMenu, deleteLinkFromContextMenu,
    togglePinFromContextMenu, closeQrCodeModal,
    toggleImportantFromContextMenu,
  } = useContextMenu({
    isBatchEditMode,
    requireAuth,
    onEditLink: (link) => { setEditingLink(link); setIsModalOpen(true); },
    onDeleteLink: (linkId) => { const now = Date.now(); const newLinks = links.map(l => l.id === linkId ? { ...l, deletedAt: now, deletedFromCategoryId: l.categoryId, pinned: false } : l); updateData(newLinks, categories, categoryGroups); },
    onTogglePin: togglePinFromLink,
    onToggleImportant: toggleImportantFromLink,
  });



  // --- Render Components ---

  const renderLinkCard = (link: LinkItem) => (
    <LinkCard
      link={link}
      isSelected={selectedLinks.has(link.id)}
      isBatchEditMode={isBatchEditMode}
      siteSettings={siteSettings}
      onToggleSelection={toggleLinkSelection}
      onContextMenu={handleContextMenu}
      onToggleImportant={(targetLink, event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!requireAuth()) return;
        toggleImportantFromLink(targetLink);
      }}
      onEdit={(targetLink, event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!requireAuth()) return;
        setEditingLink(targetLink);
        setIsModalOpen(true);
      }}
    />
  );


  if (isCheckingAuth && requiresAuth === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden text-slate-900 dark:text-slate-50">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[120] will-change-[clip-path,opacity,background-color] transition-[clip-path,opacity,background-color] duration-[620ms]"
        style={{
          backgroundColor: themeTransition.targetDark ? '#020617' : '#f8fafc',
          opacity: themeTransition.visible ? 1 : 0,
          clipPath: `circle(${themeTransition.radius}px at ${themeTransition.x}px ${themeTransition.y}px)`,
          transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      />
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AuthModal
        isOpen={isAuthOpen}
        onLogin={handleLogin}
        onClose={() => setIsAuthOpen(false)}
        canClose={true}
        description="输入部署时设置的 PASSWORD，验证后就能继续操作。"
      />
      {requiresAuth && !authToken && (
        <AuthModal
          isOpen={true}
          onLogin={handleLogin}
          description="这个站点开了访问验证，先输密码才能看。"
        />
      )}
      {(!requiresAuth || authToken) && (
      <>
      <CategoryAuthModal 
        isOpen={!!catAuthModalData}
        category={catAuthModalData}
        onClose={() => setCatAuthModalData(null)}
        onUnlock={handleUnlockCategory}
      />

      <CategoryManagerModal 
        isOpen={isCatManagerOpen} 
        onClose={() => setIsCatManagerOpen(false)}
        categories={categories}
        categoryGroups={categoryGroups}
        onUpdateCategories={handleCategoryManagerUpdate}
        onDeleteCategory={handleDeleteCategory}
        onVerifyPassword={handleCategoryActionAuth}
      />

      <BackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        links={links}
        categories={categories}
        categoryGroups={categoryGroups}
        onRestore={handleRestoreBackup}
        webDavConfig={webDavConfig}
        onSaveWebDavConfig={handleSaveWebDavConfig}
        onRestoreWebDavConfig={handleRestoreWebDavConfig}
        searchConfig={{ mode: searchMode, externalSources: externalSearchSources }}
        onRestoreSearchConfig={handleRestoreSearchConfig}
        aiConfig={aiConfig}
        onRestoreAIConfig={handleRestoreAIConfig}
      />

      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        existingLinks={links}
        categories={categories}
        onImport={handleImportConfirm}
        onImportSearchConfig={handleRestoreSearchConfig}
        onImportAIConfig={handleRestoreAIConfig}
        onImportWebDavConfig={handleRestoreWebDavConfig}
        onNotify={showToast}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        config={aiConfig}
        siteSettings={siteSettings}
        onSave={handleSaveAIConfig}
        links={links}
        categories={categories}
        onUpdateLinks={(newLinks) => updateData(newLinks, categories, categoryGroups)}
        onApplyCategorySuggestions={handleApplyCategorySuggestions}
        authToken={authToken}
        onNotify={showToast}
      />

      <TrashModal
        isOpen={isTrashModalOpen}
        onClose={() => setIsTrashModalOpen(false)}
        links={links}
        categories={categories}
        categoryGroups={categoryGroups}
        onUpdateData={updateData}
      />

      <SearchConfigModal
        isOpen={isSearchConfigModalOpen}
        onClose={() => setIsSearchConfigModalOpen(false)}
        sources={externalSearchSources}
        onSave={handleSearchConfigModalSave}
      />

      {/* Sidebar Mobile Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-20 bg-black/50 lg:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <GroupSidebar
        groups={navigationGroups}
        activeGroupId={activeGroup?.id || ''}
        navTitle={siteSettings.navTitle}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelect={selectGroup}
        onManageGroups={openGroupManager}
        footer={<>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: '导入', icon: 'Upload', action: () => authToken ? setIsImportModalOpen(true) : setIsAuthOpen(true) },
              { label: '备份', icon: 'CloudCog', action: () => authToken ? setIsBackupModalOpen(true) : setIsAuthOpen(true) },
              { label: '回收', icon: 'Trash2', action: () => authToken ? setIsTrashModalOpen(true) : setIsAuthOpen(true) },
              { label: '设置', icon: 'Settings', action: () => authToken ? setIsSettingsModalOpen(true) : setIsAuthOpen(true) },
            ].map(item => <button key={item.label} onClick={item.action} className="flex flex-col items-center gap-1 rounded-lg border border-slate-200 bg-white p-2 text-[11px] text-slate-600 hover:border-blue-300 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"><Icon name={item.icon} size={14} />{item.label}</button>)}
          </div>
          <div className="mt-3 flex items-center justify-between px-1 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">{syncStatus === 'saving' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Cloud className="h-3 w-3" />}{getSyncStatusText()}</span>
            <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-blue-500"><GitFork size={12} />GitHub</a>
          </div>
        </>}
      />

      {/* Main Content */}
      <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-slate-50 dark:bg-slate-900">
        
        {/* Header */}
        <header className="sticky top-0 z-10 flex h-16 min-w-0 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white/80 px-4 backdrop-blur-md dark:border-slate-700 dark:bg-slate-800/80 lg:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 -ml-2 text-slate-600 dark:text-slate-300">
              <Menu size={24} />
            </button>

            {/* 搜索模式切换 + 搜索框 */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <button 
                onClick={() => {
                  setIsMobileSearchOpen(!isMobileSearchOpen);
                  if (searchMode !== 'external') {
                    handleSearchModeChange('external');
                  }
                }}
                className="sm:flex md:hidden lg:hidden p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
                title="搜索"
              >
                <Search size={20} />
              </button>

              {/* 搜索模式切换 - 平板端和桌面端显示，手机端隐藏 */}
              <div className="hidden sm:hidden md:flex lg:flex items-center gap-2 flex-shrink-0">
                <div className="flex items-center bg-slate-100 dark:bg-slate-700 rounded-full p-1">
                  <button
                    onClick={() => handleSearchModeChange('internal')}
                    className={`px-3 py-1 text-xs font-medium rounded-full transition-all flex items-center justify-center min-h-[24px] min-w-[40px] ${
                      searchMode === 'internal'
                        ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
                    }`}
                    title="站内搜索"
                  >
                    站内
                  </button>
                  <button
                    onClick={() => handleSearchModeChange('external')}
                    className={`px-3 py-1 text-xs font-medium rounded-full transition-all flex items-center justify-center min-h-[24px] min-w-[40px] ${
                      searchMode === 'external'
                        ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
                    }`}
                    title="站外搜索"
                  >
                    站外
                  </button>
                </div>
                {searchMode === 'external' && (
                  <button
                    onClick={openSearchConfigModal}
                    className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
                    title="管理搜索源"
                  >
                    <Settings size={14} />
                  </button>
                )}
              </div>

              {/* 搜索框 */}
              <div className={`relative w-full max-w-lg ${isMobileSearchOpen ? 'block' : 'hidden'} sm:block`}>
                {/* 搜索源选择弹出窗口 */}
                {searchMode === 'external' && showSearchSourcePopup && (
                  <div
                    ref={popupRef}
                    className="absolute left-0 top-full mt-2 w-full bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 p-3 z-50"
                    role="listbox"
                    aria-label="搜索源选择"
                    onMouseEnter={() => setIsPopupHovered(true)}
                    onMouseLeave={() => setIsPopupHovered(false)}
                  >
                    <div className="grid grid-cols-5 sm:grid-cols-5 gap-2">
                      {externalSearchSources
                        .filter(source => source.enabled)
                        .map((source, index) => (
                          <button
                            key={index}
                            onClick={() => handleSearchSourceSelect(source)}
                            onMouseEnter={() => setHoveredSearchSource(source)}
                            onMouseLeave={() => setHoveredSearchSource(null)}
                            className="px-2 py-2 text-sm rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 flex items-center gap-1 justify-center"
                            role="option"
                            aria-selected={selectedSearchSource?.id === source.id}
                            aria-label={`使用 ${source.name} 搜索`}
                          >
                            <img 
                              src={`https://www.faviconextractor.com/favicon/${new URL(source.url).hostname}?larger=true`}
                              alt={source.name}
                              className="w-4 h-4"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJsdWNpZGUgbHVjaWRlLXNlYXJjaCI+PHBhdGggZD0ibTIxIDIxLTQuMzQtNC4zNCI+PC9wYXRoPjxjaXJjbGUgY3g9IjExIiBjeT0iMTEiIHI9IjgiPjwvY2lyY2xlPjwvc3ZnPg==';
                              }}
                            />
                            <span className="truncate hidden sm:inline">{source.name}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 cursor-pointer bg-transparent border-0 p-0"
                  aria-haspopup="listbox"
                  aria-expanded={showSearchSourcePopup}
                  aria-label={selectedSearchSource ? `当前搜索源：${selectedSearchSource.name}，点击切换` : '选择搜索源'}
                  onMouseEnter={() => searchMode === 'external' && setIsIconHovered(true)}
                  onMouseLeave={() => setIsIconHovered(false)}
                  onClick={() => {
                    if (searchMode === 'external') {
                      toggleSearchSourcePopup();
                    }
                  }}
                >
                  {searchMode === 'internal' ? (
                    <Search size={16} />
                  ) : (hoveredSearchSource || selectedSearchSource) ? (
                    <img 
                      src={`https://www.faviconextractor.com/favicon/${new URL((hoveredSearchSource || selectedSearchSource).url).hostname}?larger=true`}
                      alt={(hoveredSearchSource || selectedSearchSource).name}
                      className="w-4 h-4"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJsdWNpZGUgbHVjaWRlLXNlYXJjaCI+PHBhdGggZD0ibTIxIDIxLTQuMzQtNC4zNCI+PC9wYXRoPjxjaXJjbGUgY3g9IjExIiBjeT0iMTEiIHI9IjgiPjwvY2lyY2xlPjwvc3ZnPg==';
                      }}
                    />
                  ) : (
                    <Search size={16} />
                  )}
                </button>

                <input
                  type="text"
                  aria-label="搜索框"
                  placeholder={
                    searchMode === 'internal' 
                      ? "搜索站内内容..." 
                      : selectedSearchSource 
                        ? `在${selectedSearchSource.name}搜索内容` 
                        : "搜索站外内容..."
                  }
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && searchMode === 'external') {
                      handleExternalSearch();
                    }
                  }}
                  className="w-full pl-9 pr-4 py-2 rounded-full bg-slate-100 dark:bg-slate-700/50 border-none text-sm focus:ring-2 focus:ring-blue-500 dark:text-white placeholder-slate-400 outline-none transition-all"
                  // 移动端优化：防止页面缩放
                  style={{ fontSize: '16px' }}
                  inputMode="search"
                  enterKeyHint="search"
                />

                {searchMode === 'external' && searchQuery.trim() && (
                  <button
                    onClick={handleExternalSearch}
                    className="absolute right-10 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-blue-500"
                    title="执行站外搜索"
                  >
                    <ExternalLink size={14} />
                  </button>
                )}
                
                {searchInput.trim() && (
                  <button
                    onClick={() => setSearchInput('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-300 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-500 dark:hover:text-red-400 transition-all"
                    title="清空搜索"
                  >
                    <X size={12} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {/* 视图切换控制器 - 移动端：搜索框展开时隐藏，桌面端始终显示 */}
            <div className={`${isMobileSearchOpen ? 'hidden' : 'flex'} items-center rounded-full bg-slate-100 p-1 dark:bg-slate-700`}>
              <button
                onClick={() => handleViewModeChange('simple')}
                className={`px-2 py-1 text-xs font-medium rounded-full transition-all sm:px-3 ${
                  siteSettings.cardStyle === 'simple'
                    ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
                }`}
                title="简约版视图"
              >
                简约
              </button>
              <button
                onClick={() => handleViewModeChange('detailed')}
                className={`px-2 py-1 text-xs font-medium rounded-full transition-all sm:px-3 ${
                  siteSettings.cardStyle === 'detailed'
                    ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
                }`}
                title="详情版视图"
              >
                详情
              </button>
            </div>

            {/* 主题切换按钮 - 移动端：搜索框展开时隐藏，桌面端始终显示 */}
            <button ref={themeButtonRef} onClick={toggleTheme} className={`${isMobileSearchOpen ? 'hidden' : 'flex'} lg:flex p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700`}>
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* 登录/退出按钮 - 移动端：搜索框展开时隐藏，桌面端始终显示 */}
            <div className={`${isMobileSearchOpen ? 'hidden' : 'flex'}`}>
              {!authToken ? (
                  <button onClick={() => setIsAuthOpen(true)} className="flex items-center gap-2 bg-slate-200 dark:bg-slate-700 px-3 py-1.5 rounded-full text-xs font-medium">
                      <Cloud size={14} /> <span className="hidden sm:inline">登录</span>
                  </button>
              ) : (
                  <button onClick={handleLogout} className="flex items-center gap-2 bg-slate-200 dark:bg-slate-700 px-3 py-1.5 rounded-full text-xs font-medium">
                      <LogOut size={14} /> <span className="hidden sm:inline">退出</span>
                  </button>
              )}
            </div>

            {/* 添加按钮 - 移动端：搜索框展开时隐藏，桌面端始终显示 */}
            <div className={`${isMobileSearchOpen ? 'hidden' : 'flex'}`}>
              <button
                onClick={() => { setEditingLink(undefined); setIsModalOpen(true); }}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-full text-sm font-medium shadow-lg shadow-blue-500/30"
              >
                <Plus size={16} /> <span className="hidden sm:inline">添加</span>
              </button>
            </div>
          </div>
        </header>

        {/* Content Scroll Area */}
        <div ref={contentScrollRef} className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-slate-50 px-4 pb-8 dark:bg-slate-900 sm:px-6 lg:px-8">
          {searchQuery.trim() ? (
            <section className="mx-auto max-w-[1800px]">
              <div className="mb-5 flex items-end justify-between gap-4">
                <div><p className="text-xs font-semibold uppercase tracking-wider text-blue-500">全站搜索</p><h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">“{searchQuery}” 的搜索结果</h1><p className="mt-1 text-sm text-slate-500">找到 {displayedLinks.length} 个可访问链接</p></div>
                <button onClick={() => setSearchInput('')} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">清空搜索</button>
              </div>
              {displayedLinks.length === 0 ? <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white py-20 text-slate-400 dark:border-slate-700 dark:bg-slate-800"><Search size={36} /><p className="mt-3">未找到匹配的链接</p></div> : <div className={`grid gap-3 ${siteSettings.cardStyle === 'detailed' ? 'grid-cols-1 xs:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'}`}>{displayedLinks.map(link => <div key={link.id} className="min-w-0"><div className="mb-1 flex items-center gap-1 px-1 text-[10px] text-slate-400"><span>{navigationGroups.find(group => group.categories.some(category => category.id === link.categoryId))?.name}</span><span>/</span><span>{categories.find(category => category.id === link.categoryId)?.name}</span></div>{renderLinkCard(link)}</div>)}</div>}
            </section>
          ) : activeGroup ? (
            <div className="mx-auto max-w-[1800px]">
              <section className="sticky top-0 z-[5] -mx-4 mb-6 border-b border-slate-200 bg-slate-50/95 px-4 pb-3 pt-5 shadow-[0_8px_18px_-18px_rgba(15,23,42,0.6)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
                <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
                  <div><p className="text-xs font-semibold uppercase tracking-wider text-blue-500">当前分组</p><h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white"><Icon name={activeGroup.icon || 'Folder'} size={24} />{activeGroup.name}</h1><p className="mt-1 text-sm text-slate-500">{activeGroup.categoryCount} 个分类 · {activeGroup.linkCount} 个可访问链接</p></div>
                  <div className="flex max-w-full items-center gap-2"><button onClick={() => { if (!managementMode && !requireAuth()) return; if (managementMode) closeBatchEditMode(); setManagementMode(previous => !previous); }} className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${managementMode ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:border-blue-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}><Settings size={15} className="mr-1 inline" />{managementMode ? '退出管理' : '管理模式'}</button>{managementMode && <button onClick={() => setIsCatManagerOpen(true)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:border-blue-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">管理分类</button>}</div>
                </div>
                <div className="scrollbar-hide mt-4 flex gap-1 overflow-x-auto border-t border-slate-200 pt-2 dark:border-slate-800">{activeGroupCategories.map(category => <button key={category.id} onClick={() => scrollToCategory(category.id)} className={`relative shrink-0 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${activeAnchorId === category.id ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300' : 'text-slate-500 hover:bg-white hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-800'}`}><Icon name={category.icon || 'Folder'} size={13} className="mr-1.5 inline" />{category.name}{activeAnchorId === category.id && <span className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-blue-600" />}</button>)}</div>
                {managementMode && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue-100 bg-blue-50/80 p-3 dark:border-blue-900/50 dark:bg-blue-950/30">
                  <button onClick={toggleBatchEditMode} className={`rounded-lg px-3 py-2 text-xs font-semibold ${isBatchEditMode ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'}`}>{isBatchEditMode ? '退出批量选择' : '批量选择'}</button>
                  {isBatchEditMode && <>
                    <button onClick={handleSelectAll} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-200">全选当前分组</button>
                    <select onChange={event => { if (event.target.value) handleBatchMove(event.target.value); event.target.value = ''; }} defaultValue="" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"><option value="" disabled>移动到分类</option>{categories.filter(category => !category.deletedAt).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
                    <input value={batchTagText} onChange={event => setBatchTagText(event.target.value)} placeholder="标签，逗号分隔" className="min-w-36 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800" />
                    <button onClick={() => handleBatchTagChange(false)} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-200">添加标签</button>
                    <button onClick={() => handleBatchTagChange(true)} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-200">移除标签</button>
                    <button onClick={handleBatchDelete} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white">删除所选（{selectedLinks.size}）</button>
                  </>}
                </div>}
              </section>
              {activeGroupCategories.length > 0 ? <div className="space-y-5">{activeGroupCategories.map(category => React.createElement(CategorySection, { key: category.id, category, links: linksByCategory.get(category.id) || [], locked: isCategoryLocked(category.id), collapsed: collapsedCategoryIds.has(category.id), expanded: expandedCategoryIds.has(category.id), managementMode, sorting: isSortingMode === category.id, siteSettings, sensors, renderLink: renderLinkCard, onUnlock: () => setCatAuthModalData(category), onToggleCollapse: () => toggleCategorySet(setCollapsedCategoryIds, category.id), onToggleExpanded: () => toggleCategorySet(setExpandedCategoryIds, category.id), onAdd: () => { setSelectedCategory(category.id); setEditingLink(undefined); setPrefillLink({ categoryId: category.id }); setIsModalOpen(true); }, onStartSorting: () => { setSelectedCategory(category.id); startSorting(category.id); }, onSaveSorting: saveSorting, onCancelSorting: cancelSorting, onDragEnd: handleDragEnd }))}</div> : <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center dark:border-slate-700 dark:bg-slate-800/60"><span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300"><FolderPlus size={24} /></span><h2 className="mt-4 text-base font-bold text-slate-800 dark:text-white">这个一级分类还没有二级分类</h2><p className="mt-1 text-sm text-slate-500">先创建二级分类，再向分类中添加网址。</p><button onClick={openGroupManager} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Plus size={15} className="mr-1.5 inline" />添加二级分类</button></div>}
            </div>
          ) : <div className="flex h-full items-center justify-center text-slate-400">暂无可用分组</div>}
        </div>
      </main>

          <LinkModal
            isOpen={isModalOpen}
            onClose={() => { setIsModalOpen(false); setEditingLink(undefined); setPrefillLink(undefined); }}
            onSave={editingLink ? handleEditLink : handleAddLink}
            onDelete={editingLink ? handleDeleteLink : undefined}
            categories={categories}
            initialData={editingLink || prefillLink}
            isEditing={!!editingLink}
            aiConfig={aiConfig}
            defaultCategoryId={selectedCategory !== 'all' ? selectedCategory : undefined}
            onNotify={showToast}
          />

          {/* 右键菜单 */}
          <ContextMenu
            isOpen={contextMenu.isOpen}
            position={contextMenu.position}
            onClose={closeContextMenu}
            onCopyLink={copyLinkToClipboard}
            onShowQRCode={showQRCode}
            onEditLink={editLinkFromContextMenu}
            onDeleteLink={deleteLinkFromContextMenu}
            onTogglePin={togglePinFromContextMenu}
            onToggleImportant={toggleImportantFromContextMenu}
          />

          {/* 二维码模态框 */}
          <QRCodeModal
            isOpen={qrCodeModal.isOpen}
            url={qrCodeModal.url || ''}
            title={qrCodeModal.title || ''}
            onClose={closeQrCodeModal}
          />
      </>
      )}
    </div>
  );
}

export default App;

