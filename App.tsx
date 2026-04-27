
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Search, Plus, Upload, Moon, Sun, Menu, 
  Trash2, Edit2, Loader2, Cloud, CheckCircle2, AlertCircle,
  Pin, Settings, Lock, CloudCog, Github, GitFork, GripVertical, Save, CheckSquare, LogOut, ExternalLink, X, Info
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  closestCorners,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { LinkItem, Category, DEFAULT_CATEGORIES, INITIAL_LINKS, WebDavConfig, AIConfig, SearchMode, ExternalSearchSource, SearchConfig } from './types';
import { parseBookmarks } from './services/bookmarkParser';
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
import ToastContainer from './components/ToastContainer';
import { useToast } from './hooks/useToast';
import { useTheme } from './hooks/useTheme';
import { useSiteSettings } from './hooks/useSiteSettings';
import { useContextMenu } from './hooks/useContextMenu';
import { useAppDataSync } from './hooks/useAppDataSync';
import { useAuthSession } from './hooks/useAuthSession';
import { createDefaultSearchSources, useSearchConfig } from './hooks/useSearchConfig';
import { useCategoryAccess } from './hooks/useCategoryAccess';
import { useLinkOrganizer } from './hooks/useLinkOrganizer';
import LinkCard from './components/links/LinkCard';
import SortableLinkCard from './components/links/SortableLinkCard';

// --- 配置项 ---
// 项目核心仓库地址
const GITHUB_REPO_URL = 'https://github.com/Aaowu/CloudNav-Oorz';

const LOCAL_STORAGE_KEY = 'cloudnav_data_cache';
const AUTH_KEY = 'cloudnav_auth_token';
const AUTH_TIME_KEY = 'lastLoginTime';
const WEBDAV_CONFIG_KEY = 'cloudnav_webdav_config';
const AI_CONFIG_KEY = 'cloudnav_ai_config';
const SEARCH_CONFIG_KEY = 'cloudnav_search_config';


function App() {
  const { darkMode, themeTransition, themeButtonRef, toggleTheme } = useTheme();
  const { siteSettings, setSiteSettings, handleViewModeChange } = useSiteSettings();

  // --- State ---
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
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
              return JSON.parse(saved);
          } catch (e) {}
      }
      return {
          provider: 'gemini',
          apiKey: process.env.API_KEY || '', 
          baseUrl: '',
          model: 'gemini-2.5-flash'
      };
  });

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isCatManagerOpen, setIsCatManagerOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSearchConfigModalOpen, setIsSearchConfigModalOpen] = useState(false);
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
  });

  const {
    searchMode,
    setSearchMode,
    externalSearchSources,
    setExternalSearchSources,
    isLoadingSearchConfig,
    setIsLoadingSearchConfig,
    showSearchSourcePopup,
    setShowSearchSourcePopup,
    hoveredSearchSource,
    setHoveredSearchSource,
    selectedSearchSource,
    setSelectedSearchSource,
    isIconHovered,
    setIsIconHovered,
    isPopupHovered,
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
    unlockedCategoryIds,
    catAuthModalData,
    setCatAuthModalData,
    pendingProtectedCategoryId,
    setPendingProtectedCategoryId,
    categoryActionAuth,
    handleCategoryClick,
    handleUnlockCategory,
    handleUpdateCategories,
    handleDeleteCategory,
    handleCategoryActionAuth,
    openCategoryActionAuth,
    closeCategoryActionAuth,
    requiresGlobalCategoryAuth,
    isCategoryLocked,
  } = useCategoryAccess({
    authToken,
    categories,
    links,
    updateData,
    requireAuth,
    showToast,
    buildAuthHeaders,
    setSelectedCategory,
    setSidebarOpen,
    setIsAuthOpen,
  });

  // --- Effects ---

  useEffect(() => {
    // Load Token and check expiry
    const savedToken = localStorage.getItem(AUTH_KEY);
    const lastLoginTime = localStorage.getItem(AUTH_TIME_KEY);
    
    if (savedToken) {
      const currentTime = Date.now();
      
      if (lastLoginTime) {
        const lastLogin = parseInt(lastLoginTime);
        const timeDiff = currentTime - lastLogin;
        
        const expiryDays = siteSettings.passwordExpiryDays || 7;
        const expiryTimeMs = expiryDays > 0 ? expiryDays * 24 * 60 * 60 * 1000 : 0;
        
        if (expiryTimeMs > 0 && timeDiff > expiryTimeMs) {
          clearAuthSession();
        } else {
          setAuthToken(savedToken);
        }
      } else {
        setAuthToken(savedToken);
      }
    }

    // Load WebDAV Config
    const savedWebDav = localStorage.getItem(WEBDAV_CONFIG_KEY);
    if (savedWebDav) {
        try {
            setWebDavConfig(JSON.parse(savedWebDav));
        } catch (e) {}
    }

    // Handle URL Params for Bookmarklet (Add Link)
    const urlParams = new URLSearchParams(window.location.search);
    const addUrl = urlParams.get('add_url');
    if (addUrl) {
        const addTitle = urlParams.get('add_title') || '';
        // Clean URL params to avoid re-triggering on refresh
        window.history.replaceState({}, '', window.location.pathname);
        
        setPrefillLink({
            title: addTitle,
            url: addUrl,
            categoryId: 'common' // Default, Modal will handle selection
        });
        setEditingLink(undefined);
        if (savedToken) {
            setIsModalOpen(true);
        } else {
            setIsAuthOpen(true);
        }
    }

    // Initial Data Fetch
    const initData = async () => {
        // 首先检查是否需要认证
        try {
            const authRes = await fetch('/api/storage?checkAuth=true');
            if (authRes.ok) {
                const authData = await authRes.json();
                setRequiresAuth(authData.requiresAuth);
                if (authData.hasPassword && savedToken) {
                    const validateRes = await fetch('/api/storage', {
                        method: 'POST',
                        headers: buildAuthHeaders(savedToken, {
                            'Content-Type': 'application/json',
                        }),
                        body: JSON.stringify({ authOnly: true })
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
            console.warn("Failed to check auth requirement.", e);
        }
        
        // 获取数据
        let hasCloudData = false;
        const activeToken = savedToken || authToken;
        try {
            const res = await fetch('/api/storage', {
                headers: activeToken ? buildAuthHeaders(activeToken) : {}
            });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.links) || Array.isArray(data.categories)) {
                    const cloudLinks = Array.isArray(data.links) ? data.links : [];
                    const cloudCategories = Array.isArray(data.categories) ? data.categories : DEFAULT_CATEGORIES;
                    setLinks(cloudLinks);
                    setCategories(cloudCategories);
                    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
                        links: cloudLinks,
                        categories: cloudCategories
                    }));
                    
                    // 加载链接图标缓存
                    loadLinkIcons(cloudLinks, cloudCategories);
                    hasCloudData = true;
                }
            } else if (res.status === 401) {
                // 如果返回401，可能是密码过期，清除本地token并要求重新登录
                const errorData = await res.json();
                if (errorData.error && errorData.error.includes('过期')) {
                    clearAuthSession();
                    setIsAuthOpen(true);
                    setIsCheckingAuth(false);
                    return;
                }
            }
        } catch (e) {
            console.warn("Failed to fetch from cloud, falling back to local.", e);
        }
        
        // 无论是否有云端数据，都尝试从KV空间加载搜索配置和网站配置
        try {
            const searchConfigRes = await fetch('/api/storage?getConfig=search');
            if (searchConfigRes.ok) {
                const searchConfigData = await searchConfigRes.json();
                // 检查搜索配置是否有效（包含必要的字段）
                if (searchConfigData && (searchConfigData.mode || searchConfigData.externalSources || searchConfigData.selectedSource)) {
                    setSearchMode('internal');
                    setExternalSearchSources(searchConfigData.externalSources || []);
                    // 加载已保存的选中搜索源
                    if (searchConfigData.selectedSource) {
                        setSelectedSearchSource(searchConfigData.selectedSource);
                    }
                }
            }
            
            // 获取网站配置（包括密码过期时间设置）
            const websiteConfigRes = await fetch('/api/storage?getConfig=website');
            if (websiteConfigRes.ok) {
                const websiteConfigData = await websiteConfigRes.json();
                if (websiteConfigData) {
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

            if (savedToken) {
                const webDavConfigRes = await fetch('/api/storage?getConfig=webdav', {
                    headers: buildAuthHeaders(savedToken)
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
            console.warn("Failed to fetch configs from KV.", e);
        }
        
        // 如果有云端数据，则不需要加载本地数据
        if (hasCloudData) {
            setIsCheckingAuth(false);
            return;
        }
        
        // 如果没有云端数据，则加载本地数据
        loadFromLocal();
        
        // 如果从KV空间加载搜索配置失败，直接使用默认配置（不使用localStorage回退）
        setSearchMode('internal');
        setExternalSearchSources(createDefaultSearchSources());
        
        setIsLoadingSearchConfig(false);
        setIsCheckingAuth(false);
    };

    initData();
  }, []);

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
            setAuthToken(password);
            localStorage.setItem(AUTH_KEY, password);
            setIsAuthOpen(false);
            setSyncStatus('saved');
            
            // 登录成功后，获取网站配置（包括密码过期时间设置）
            try {
                const websiteConfigRes = await fetch('/api/storage?getConfig=website');
                if (websiteConfigRes.ok) {
                    const websiteConfigData = await websiteConfigRes.json();
                    if (websiteConfigData) {
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
                
                const expiryTimeMs = (siteSettings.passwordExpiryDays || 7) > 0 ? (siteSettings.passwordExpiryDays || 7) * 24 * 60 * 60 * 1000 : 0;
                
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
                    headers: buildAuthHeaders(password)
                });
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data.links) || Array.isArray(data.categories)) {
                        const cloudLinks = Array.isArray(data.links) ? data.links : [];
                        const cloudCategories = Array.isArray(data.categories) ? data.categories : DEFAULT_CATEGORIES;

                        setLinks(cloudLinks);
                        setCategories(cloudCategories);
                        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
                            links: cloudLinks,
                            categories: cloudCategories
                        }));
                        loadLinkIcons(cloudLinks, cloudCategories);
                    } else {
                        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ links, categories }));
                        syncToCloud(links, categories, password);
                        loadLinkIcons(links, categories);
                    }
                } 
            } catch (e) {
                console.warn("Failed to fetch data after login.", e);
                loadFromLocal();
                // 尝试将本地数据同步到服务器
                syncToCloud(links, categories, password);
            }
            
            // 登录成功后，从KV空间加载AI配置
            try {
                const aiConfigRes = await fetch('/api/storage?getConfig=ai', {
                    headers: buildAuthHeaders(password)
                });
                if (aiConfigRes.ok) {
                    const aiConfigData = await aiConfigRes.json();
                    if (aiConfigData && Object.keys(aiConfigData).length > 0) {
                        setAiConfig(aiConfigData);
                        localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(aiConfigData));
                    }
                }
            } catch (e) {
                console.warn("Failed to fetch AI config after login.", e);
            }

            try {
                const webDavConfigRes = await fetch('/api/storage?getConfig=webdav', {
                    headers: buildAuthHeaders(password)
                });
                if (webDavConfigRes.ok) {
                    const webDavConfigData = await webDavConfigRes.json();
                    if (webDavConfigData && (webDavConfigData.url || webDavConfigData.username || webDavConfigData.password || webDavConfigData.enabled !== undefined)) {
                        setWebDavConfig(webDavConfigData);
                        localStorage.setItem(WEBDAV_CONFIG_KEY, JSON.stringify(webDavConfigData));
                    }
                }
            } catch (e) {
                console.warn("Failed to fetch WebDAV config after login.", e);
            }

            if (pendingProtectedCategoryId) {
                setSelectedCategory(pendingProtectedCategoryId);
                setPendingProtectedCategoryId(null);
            }
            
            return true;
        }
        return false;
      } catch (e) {
          return false;
      }
  };

  const handleLogout = () => {
      clearAuthSession();
      setPendingProtectedCategoryId(null);
      setSyncStatus('offline');
      // 退出后重新加载本地数据
      loadFromLocal();
  };

  const handleImportConfirm = (newLinks: LinkItem[], newCategories: Category[]) => {
      // Merge categories: Avoid duplicate names/IDs
      const mergedCategories = [...categories];
      
      // 确保"常用推荐"分类始终存在
      if (!mergedCategories.some(c => c.id === 'common')) {
        mergedCategories.push({ id: 'common', name: '常用推荐', icon: 'Star' });
      }
      
      newCategories.forEach(nc => {
          if (!mergedCategories.some(c => c.id === nc.id || c.name === nc.name)) {
              mergedCategories.push(nc);
          }
      });

      const mergedLinks = [...links, ...newLinks];
      updateData(mergedLinks, mergedCategories);
      setIsImportModalOpen(false);
      showToast(`成功导入 ${newLinks.length} 个新书签`, 'success');
  };

  const handleSaveAIConfig = async (config: AIConfig, newSiteSettings?: any) => {
      setAiConfig(config);
      localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
      
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
                      config: config
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
      setAiConfig(config);
      localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
      
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
                      config: config
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

 const handleRestoreBackup = (restoredLinks: LinkItem[], restoredCategories: Category[]) => {
      updateData(restoredLinks, restoredCategories);
      setIsBackupModalOpen(false);
  };

  const handleRestoreSearchConfig = (restoredSearchConfig: SearchConfig) => {
      handleSaveSearchConfig(restoredSearchConfig.externalSources, restoredSearchConfig.mode);
  };

  // --- Filtering & Memo ---

  const pinnedLinks = useMemo(() => {
      // Don't show pinned links if they belong to a locked category
      const filteredPinnedLinks = links.filter(l => l.pinned && !isCategoryLocked(l.categoryId));
      // 按照pinnedOrder字段排序，如果没有pinnedOrder字段则按创建时间排序
      return filteredPinnedLinks.sort((a, b) => {
        // 如果有pinnedOrder字段，则使用pinnedOrder排序
        if (a.pinnedOrder !== undefined && b.pinnedOrder !== undefined) {
          return a.pinnedOrder - b.pinnedOrder;
        }
        // 如果只有一个有pinnedOrder字段，有pinnedOrder的排在前面
        if (a.pinnedOrder !== undefined) return -1;
        if (b.pinnedOrder !== undefined) return 1;
        // 如果都没有pinnedOrder字段，则按创建时间排序
        return a.createdAt - b.createdAt;
      });
  }, [links, categories, unlockedCategoryIds]);

  const displayedLinks = useMemo(() => {
    let result = links;
    
    // Security Filter: Always hide links from locked categories
    result = result.filter(l => !isCategoryLocked(l.categoryId));

    // Search Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(l => 
        l.title.toLowerCase().includes(q) || 
        l.url.toLowerCase().includes(q) ||
        (l.description && l.description.toLowerCase().includes(q))
      );
    }

    // Category Filter
    if (selectedCategory !== 'all') {
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
  }, [links, selectedCategory, searchQuery, categories, unlockedCategoryIds]);

  // 计算其他目录的搜索结果
  const otherCategoryResults = useMemo<Record<string, LinkItem[]>>(() => {
    if (!searchQuery.trim() || selectedCategory === 'all') {
      return {};
    }

    const q = searchQuery.toLowerCase();
    
    // 获取其他目录中匹配的链接
    const otherLinks = links.filter(link => {
      // 排除当前目录的链接
      if (link.categoryId === selectedCategory) {
        return false;
      }
      
      // 排除锁定的目录
      if (isCategoryLocked(link.categoryId)) {
        return false;
      }
      
      // 搜索匹配
      return (
        link.title.toLowerCase().includes(q) || 
        link.url.toLowerCase().includes(q) ||
        (link.description && link.description.toLowerCase().includes(q))
      );
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
      groupedByCategory[categoryId].sort((a, b) => {
        const aOrder = a.order !== undefined ? a.order : a.createdAt;
        const bOrder = b.order !== undefined ? b.order : b.createdAt;
        return aOrder - bOrder;
      });
    });

    return groupedByCategory;
  }, [links, selectedCategory, searchQuery, categories, unlockedCategoryIds]);


  const {
    isSortingMode,
    setIsSortingMode,
    isSortingPinned,
    setIsSortingPinned,
    isBatchEditMode,
    selectedLinks,
    toggleBatchEditMode,
    toggleLinkSelection,
    handleBatchDelete,
    handleBatchMove,
    handleSelectAll,
    handleAddLink,
    handleEditLink,
    handleDragEnd,
    handlePinnedDragEnd,
    startSorting,
    saveSorting,
    cancelSorting,
    savePinnedSorting,
    cancelPinnedSorting,
    sensors,
    handleDeleteLink,
    togglePin,
    togglePinFromLink,
  } = useLinkOrganizer({
    links,
    categories,
    selectedCategory,
    displayedLinks,
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
  } = useContextMenu({
    isBatchEditMode,
    requireAuth,
    onEditLink: (link) => { setEditingLink(link); setIsModalOpen(true); },
    onDeleteLink: (linkId) => { const newLinks = links.filter(l => l.id !== linkId); updateData(newLinks, categories); },
    onTogglePin: togglePinFromLink,
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
        onUpdateCategories={handleUpdateCategories}
        onDeleteCategory={handleDeleteCategory}
        onVerifyPassword={handleCategoryActionAuth}
      />

      <BackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        links={links}
        categories={categories}
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
        onUpdateLinks={(newLinks) => updateData(newLinks, categories)}
        authToken={authToken}
        onNotify={showToast}
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

      {/* Sidebar */}
      <aside 
        className={`
          fixed lg:static inset-y-0 left-0 z-30 w-64 transform transition-transform duration-300 ease-in-out
          bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-slate-100 dark:border-slate-700 shrink-0">
            <span className="text-xl font-bold bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
              {siteSettings.navTitle || 'CloudNav'}
            </span>
        </div>

        {/* Categories List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1 scrollbar-hide">
            <button
              onClick={() => { setSelectedCategory('all'); setSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                selectedCategory === 'all' 
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium' 
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <div className="p-1"><Icon name="LayoutGrid" size={18} /></div>
              <span>置顶网站</span>
            </button>
            
            <div className="flex items-center justify-between pt-4 pb-2 px-4">
               <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">分类目录</span>
               <button 
                  onClick={() => { if(!authToken) setIsAuthOpen(true); else setIsCatManagerOpen(true); }}
                  className="p-1 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                  title="管理分类"
               >
                  <Settings size={14} />
               </button>
            </div>

            {categories.map(cat => {
                const isLocked = isCategoryLocked(cat.id);
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleCategoryClick(cat)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all group ${
                      selectedCategory === cat.id 
                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium' 
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    <div className={`p-1.5 rounded-lg transition-colors flex items-center justify-center ${selectedCategory === cat.id ? 'bg-blue-100 dark:bg-blue-800' : 'bg-slate-100 dark:bg-slate-800'}`}>
                      {isLocked ? <Lock size={16} className="text-amber-500" /> : <Icon name={cat.icon} size={16} />}
                    </div>
                    <span className="truncate flex-1 text-left">{cat.name}</span>
                    {requiresGlobalCategoryAuth(cat.id) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                        需登录
                      </span>
                    )}
                    {selectedCategory === cat.id && <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>}
                  </button>
                );
            })}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 shrink-0">
            
            <div className="grid grid-cols-3 gap-2 mb-2">
                <button 
                    onClick={() => { if(!authToken) setIsAuthOpen(true); else setIsImportModalOpen(true); }}
                    className="flex flex-col items-center justify-center gap-1 p-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600 transition-all"
                    title="导入书签"
                >
                    <Upload size={14} />
                    <span>导入</span>
                </button>
                
                <button 
                    onClick={() => { if(!authToken) setIsAuthOpen(true); else setIsBackupModalOpen(true); }}
                    className="flex flex-col items-center justify-center gap-1 p-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600 transition-all"
                    title="备份与恢复"
                >
                    <CloudCog size={14} />
                    <span>备份</span>
                </button>

                <button 
                    onClick={() => { if(!authToken) setIsAuthOpen(true); else setIsSettingsModalOpen(true); }}
                    className="flex flex-col items-center justify-center gap-1 p-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600 transition-all"
                    title="AI 设置"
                >
                    <Settings size={14} />
                    <span>设置</span>
                </button>
            </div>
            
            <div className="flex items-center justify-between text-xs px-2 mt-2">
               <div className={`flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors ${
                 syncStatus === 'error'
                   ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                   : syncStatus === 'saving'
                     ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                     : authToken
                       ? 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                       : 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400'
               }`}>
                 {syncStatus === 'saving' && <Loader2 className="animate-spin w-3 h-3" />}
                 {syncStatus === 'saved' && <CheckCircle2 className="w-3 h-3" />}
                 {syncStatus === 'error' && <AlertCircle className="w-3 h-3" />}
                 {syncStatus !== 'saving' && syncStatus !== 'saved' && syncStatus !== 'error' && <Cloud className="w-3 h-3" />}
                 <span>{getSyncStatusText()}</span>
               </div>

               <a 
                 href={GITHUB_REPO_URL} 
                 target="_blank" 
                 rel="noopener noreferrer"
                 className="flex items-center gap-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                 title="Fork this project on GitHub"
               >
                 <GitFork size={14} />
                 <span>Fork 项目 v1.7.1</span>
               </a>
            </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full bg-slate-50 dark:bg-slate-900 overflow-hidden relative">
        
        {/* Header */}
        <header className="h-16 px-4 lg:px-8 flex items-center justify-between bg-white/80 dark:bg-slate-800/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-4 flex-1">
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
                    className="absolute left-0 top-full mt-2 w-full bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 p-3 z-50"
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

                <div 
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 cursor-pointer"
                  onMouseEnter={() => searchMode === 'external' && setIsIconHovered(true)}
                  onMouseLeave={() => setIsIconHovered(false)}
                  onClick={() => {
                    if (searchMode === 'external') {
                      setShowSearchSourcePopup(!showSearchSourcePopup);
                    }
                  }}
                >
                  {searchMode === 'internal' ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-search">
                      <path d="m21 21-4.35-4.35"></path>
                      <circle cx="11" cy="11" r="8"></circle>
                    </svg>
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
                </div>
                
                <input
                  type="text"
                  placeholder={
                    searchMode === 'internal' 
                      ? "搜索站内内容..." 
                      : selectedSearchSource 
                        ? `在${selectedSearchSource.name}搜索内容` 
                        : "搜索站外内容..."
                  }
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
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
                
                {searchQuery.trim() && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-300 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-500 dark:hover:text-red-400 transition-all"
                    title="清空搜索"
                  >
                    <X size={12} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 视图切换控制器 - 移动端：搜索框展开时隐藏，桌面端始终显示 */}
            <div className={`${isMobileSearchOpen ? 'hidden' : 'flex'} lg:flex items-center bg-slate-100 dark:bg-slate-700 rounded-full p-1`}>
              <button
                onClick={() => handleViewModeChange('simple')}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${
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
                className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${
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
                onClick={() => { if(!authToken) setIsAuthOpen(true); else { setEditingLink(undefined); setIsModalOpen(true); }}}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-full text-sm font-medium shadow-lg shadow-blue-500/30"
              >
                <Plus size={16} /> <span className="hidden sm:inline">添加</span>
              </button>
            </div>
          </div>
        </header>

        {/* Content Scroll Area */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-8">
            
            {/* 1. Pinned Area (Custom Top Area) */}
            {pinnedLinks.length > 0 && !searchQuery && (selectedCategory === 'all') && (
                <section>
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <Pin size={16} className="text-blue-500 fill-blue-500" />
                            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                置顶 / 常用
                            </h2>
                            <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 rounded-full">
                                {pinnedLinks.length}
                            </span>
                        </div>
                        {isSortingPinned ? (
                            <div className="flex gap-2">
                                <button 
                                    onClick={savePinnedSorting}
                                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-full transition-colors"
                                    title="保存顺序"
                                >
                                    <Save size={14} />
                                    <span>保存顺序</span>
                                </button>
                                <button 
                                    onClick={cancelPinnedSorting}
                                    className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium rounded-full hover:bg-slate-300 dark:hover:bg-slate-600 transition-all"
                                    title="取消排序"
                                >
                                    取消
                                </button>
                            </div>
                        ) : (
                            <button 
                                onClick={() => { if(!requireAuth()) return; setIsSortingPinned(true); }}
                                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-full transition-colors"
                                title="排序"
                            >
                                <GripVertical size={14} />
                                <span>排序</span>
                            </button>
                        )}
                    </div>
                    {isSortingPinned ? (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCorners}
                            onDragEnd={handlePinnedDragEnd}
                        >
                            <SortableContext
                                items={pinnedLinks.map(link => link.id)}
                                strategy={rectSortingStrategy}
                            >
                                <div className={`grid gap-3 ${
                                  siteSettings.cardStyle === 'detailed' 
                                    ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6' 
                                    : 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
                                }`}>
                                    {pinnedLinks.map(link => React.createElement(SortableLinkCard, { key: link.id, link }))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    ) : (
                        <div className={`grid gap-3 ${
                          siteSettings.cardStyle === 'detailed' 
                            ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6' 
                            : 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
                        }`}>
                            {pinnedLinks.map(link => renderLinkCard(link))}
                        </div>
                    )}
                </section>
            )}

            {/* 2. Main Grid */}
            {(selectedCategory !== 'all' || searchQuery) && (
            <section>
                 {(!pinnedLinks.length && !searchQuery && selectedCategory === 'all') && (
                    <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg flex items-center justify-between">
                         <div>
                            <h1 className="text-xl font-bold">早安 👋</h1>
                            <p className="text-sm opacity-90 mt-1">
                                {links.length} 个链接 · {categories.length} 个分类
                            </p>
                         </div>
                         <Icon name="Compass" size={48} className="opacity-20" />
                    </div>
                 )}

                 <div className="flex items-center justify-between mb-4">
                     <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                         {selectedCategory === 'all' 
                            ? (searchQuery ? '搜索结果' : '所有链接') 
                            : (
                                <>
                                    {categories.find(c => c.id === selectedCategory)?.name}
                                    {isCategoryLocked(selectedCategory) && <Lock size={14} className="text-amber-500" />}
                                    <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 rounded-full">
                                        {displayedLinks.length}
                                    </span>
                                </>
                            )
                         }
                     </h2>
                     {selectedCategory !== 'all' && !isCategoryLocked(selectedCategory) && (
                         isSortingMode === selectedCategory ? (
                             <div className="flex gap-2">
                                 <button 
                                     onClick={saveSorting}
                                     className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-full transition-colors"
                                     title="保存顺序"
                                 >
                                     <Save size={14} />
                                     <span>保存顺序</span>
                                 </button>
                                 <button 
                                     onClick={cancelSorting}
                                     className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium rounded-full hover:bg-slate-300 dark:hover:bg-slate-600 transition-all"
                                     title="取消排序"
                                 >
                                     取消
                                 </button>
                             </div>
                         ) : (
                             <div className="flex gap-2">
                                 <button 
                                     onClick={toggleBatchEditMode}
                                     className={`flex items-center gap-1 px-3 py-1.5 text-white text-xs font-medium rounded-full transition-colors ${
                                         isBatchEditMode 
                                             ? 'bg-red-600 hover:bg-red-700' 
                                             : 'bg-blue-600 hover:bg-blue-700'
                                     }`}
                                     title={isBatchEditMode ? "退出批量编辑" : "批量编辑"}
                                 >
                                     {isBatchEditMode ? '取消' : '批量编辑'}
                                 </button>
                                 {isBatchEditMode ? (
                                     <>
                                         <button 
                                             onClick={handleBatchDelete}
                                             className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-full transition-colors"
                                             title="批量删除"
                                         >
                                             <Trash2 size={14} />
                                             <span>批量删除</span>
                                         </button>
                                         <button 
                                             onClick={handleSelectAll}
                                             className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-full transition-colors"
                                             title="全选/取消全选"
                                         >
                                             <CheckSquare size={14} />
                                             <span>{selectedLinks.size === displayedLinks.length ? '取消全选' : '全选'}</span>
                                         </button>
                                         <div className="relative group">
                                              <button 
                                                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-full transition-colors"
                                                  title="批量移动"
                                              >
                                                  <Upload size={14} />
                                                  <span>批量移动</span>
                                              </button>
                                              <div className="absolute top-full right-0 mt-1 w-48 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 z-20 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                                                  {categories.filter(cat => cat.id !== selectedCategory).map(cat => (
                                                      <button
                                                          key={cat.id}
                                                          onClick={() => handleBatchMove(cat.id)}
                                                          className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 first:rounded-t-lg last:rounded-b-lg"
                                                      >
                                                          {cat.name}
                                                      </button>
                                                  ))}
                                              </div>
                                          </div>
                                     </>
                                 ) : (
                                     <button 
                                         onClick={() => startSorting(selectedCategory)}
                                         className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-full transition-colors"
                                         title="排序"
                                     >
                                         <GripVertical size={14} />
                                         <span>排序</span>
                                     </button>
                                 )}
                             </div>
                         )
                     )}
                 </div>

                 {displayedLinks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                        {isCategoryLocked(selectedCategory) ? (
                            <>
                                <Lock size={40} className="text-amber-400 mb-4" />
                                <p>该目录已锁定</p>
                                <button onClick={() => setCatAuthModalData(categories.find(c => c.id === selectedCategory) || null)} className="mt-4 px-4 py-2 bg-amber-500 text-white rounded-lg">输入密码解锁</button>
                            </>
                        ) : (
                            <></>
                        )}
                    </div>
                 ) : (
                    isSortingMode === selectedCategory ? (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCorners}
                            onDragEnd={handleDragEnd}
                        >
                            <SortableContext
                                items={displayedLinks.map(link => link.id)}
                                strategy={rectSortingStrategy}
                            >
                                <div className={`grid gap-3 ${
                                  siteSettings.cardStyle === 'detailed' 
                                    ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6' 
                                    : 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
                                }`}>
                                    {displayedLinks.map(link => React.createElement(SortableLinkCard, { key: link.id, link }))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    ) : (
                        <div className={`grid gap-3 ${
                          siteSettings.cardStyle === 'detailed' 
                            ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6' 
                            : 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
                        }`}>
                            {displayedLinks.map(link => renderLinkCard(link))}
                        </div>
                    )
                 )}
            </section>
            )}

            {/* 其他目录搜索结果区域 */}
            {searchQuery.trim() && selectedCategory !== 'all' && (
              <section className="mt-8 pt-8 border-t-2 border-slate-200 dark:border-slate-700">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2 mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-folder-search">
                    <circle cx="11" cy="11" r="8"></circle>
                    <path d="m21 21-4.35-4.35"></path>
                    <path d="M11 11h.01"></path>
                  </svg>
                  其他目录搜索结果
                  <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 rounded-full">
                    {Object.values(otherCategoryResults).flat().length}
                  </span>
                </h2>

                {Object.keys(otherCategoryResults).length > 0 ? (
                  (Object.entries(otherCategoryResults) as [string, LinkItem[]][]).map(([categoryId, categoryLinks]) => {
                    const category = categories.find(c => c.id === categoryId);
                    if (!category) return null;

                    return (
                      <div key={categoryId} className="mb-6 last:mb-0">
                        <div className="flex items-center gap-2 mb-3">
                          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                            {category.name}
                          </h3>
                          <span className="px-2 py-0.5 text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 rounded-full">
                            {categoryLinks.length}
                          </span>
                        </div>

                        <div className={`grid gap-3 ${
                          siteSettings.cardStyle === 'detailed' 
                            ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6' 
                            : 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
                        }`}>
                          {categoryLinks.map(link => renderLinkCard(link))}
                        </div>
                      </div>
                    );
                  })
                ) : null}
              </section>
            )}
        </div>
      </main>

          <LinkModal
            isOpen={isModalOpen}
            onClose={() => { setIsModalOpen(false); setEditingLink(undefined); setPrefillLink(undefined); }}
            onSave={editingLink ? handleEditLink : handleAddLink}
            onDelete={editingLink ? handleDeleteLink : undefined}
            categories={categories}
            initialData={editingLink || (prefillLink as LinkItem)}
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

