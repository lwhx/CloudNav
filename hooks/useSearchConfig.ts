import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalSearchSource, SearchConfig, SearchMode } from '../types';

interface UseSearchConfigOptions {
  authToken: string;
  buildAuthHeaders: (token?: string | null, extraHeaders?: Record<string, string>) => Record<string, string>;
  requireAuth: () => boolean;
  searchQuery: string;
}

export const createDefaultSearchSources = (): ExternalSearchSource[] => [
  { id: 'bing', name: '必应', url: 'https://www.bing.com/search?q={query}', icon: 'Search', enabled: true, createdAt: Date.now() },
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q={query}', icon: 'Search', enabled: true, createdAt: Date.now() },
  { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd={query}', icon: 'Globe', enabled: true, createdAt: Date.now() },
  { id: 'sogou', name: '搜狗', url: 'https://www.sogou.com/web?query={query}', icon: 'Globe', enabled: true, createdAt: Date.now() },
  { id: 'yandex', name: 'Yandex', url: 'https://yandex.com/search/?text={query}', icon: 'Globe', enabled: true, createdAt: Date.now() },
  { id: 'github', name: 'GitHub', url: 'https://github.com/search?q={query}', icon: 'Github', enabled: true, createdAt: Date.now() },
  { id: 'linuxdo', name: 'Linux.do', url: 'https://linux.do/search?q={query}', icon: 'Terminal', enabled: true, createdAt: Date.now() },
  { id: 'bilibili', name: 'B站', url: 'https://search.bilibili.com/all?keyword={query}', icon: 'Play', enabled: true, createdAt: Date.now() },
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/results?search_query={query}', icon: 'Video', enabled: true, createdAt: Date.now() },
  { id: 'wikipedia', name: '维基', url: 'https://zh.wikipedia.org/wiki/Special:Search?search={query}', icon: 'BookOpen', enabled: true, createdAt: Date.now() },
];

export const useSearchConfig = ({ authToken, buildAuthHeaders, requireAuth, searchQuery }: UseSearchConfigOptions) => {
  const [searchMode, setSearchMode] = useState<SearchMode>('internal');
  const [externalSearchSources, setExternalSearchSources] = useState<ExternalSearchSource[]>([]);
  const [isLoadingSearchConfig, setIsLoadingSearchConfig] = useState(true);
  const [showSearchSourcePopup, setShowSearchSourcePopup] = useState(false);
  const [hoveredSearchSource, setHoveredSearchSource] = useState<ExternalSearchSource | null>(null);
  const [selectedSearchSource, setSelectedSearchSource] = useState<ExternalSearchSource | null>(null);
  const [isIconHovered, setIsIconHovered] = useState(false);
  const [isPopupHovered, setIsPopupHovered] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isIconHovered || isPopupHovered) {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      setShowSearchSourcePopup(true);
    } else {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      hideTimeoutRef.current = setTimeout(() => {
        setShowSearchSourcePopup(false);
        setHoveredSearchSource(null);
      }, 100);
    }

    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [isIconHovered, isPopupHovered]);

  const handleSaveSearchConfig = useCallback(async (
    sources: ExternalSearchSource[],
    mode: SearchMode,
    selectedSource?: ExternalSearchSource | null,
    persistToCloud: boolean = true,
  ) => {
    const searchConfig: SearchConfig = {
      mode,
      externalSources: sources,
      selectedSource: selectedSource !== undefined ? selectedSource : selectedSearchSource,
    };

    setExternalSearchSources(sources);
    setSearchMode(mode);
    if (selectedSource !== undefined) {
      setSelectedSearchSource(selectedSource);
    }

    if (!persistToCloud || !authToken) {
      return;
    }

    try {
      const response = await fetch('/api/storage', {
        method: 'POST',
        headers: buildAuthHeaders(authToken, {
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          saveConfig: 'search',
          config: searchConfig,
        }),
      });

      if (!response.ok) {
        console.error('Failed to save search config to KV:', response.statusText);
      }
    } catch (error) {
      console.error('Error saving search config to KV:', error);
    }
  }, [authToken, buildAuthHeaders, selectedSearchSource]);

  const handleSearchSourceSelect = useCallback(async (source: ExternalSearchSource) => {
    setSelectedSearchSource(source);
    await handleSaveSearchConfig(externalSearchSources, searchMode, source);

    if (searchQuery.trim()) {
      const searchUrl = source.url.replace('{query}', encodeURIComponent(searchQuery));
      window.open(searchUrl, '_blank');
    }
    setShowSearchSourcePopup(false);
    setHoveredSearchSource(null);
  }, [externalSearchSources, handleSaveSearchConfig, searchMode, searchQuery]);

  const openSearchConfigModal = useCallback((openModal: () => void) => {
    if (!requireAuth()) return;
    openModal();
  }, [requireAuth]);

  const handleSearchConfigModalSave = useCallback(async (sources: ExternalSearchSource[]) => {
    if (!requireAuth()) return;
    await handleSaveSearchConfig(sources, searchMode, undefined, true);
  }, [handleSaveSearchConfig, requireAuth, searchMode]);

  const handleSearchModeChange = useCallback((mode: SearchMode) => {
    setSearchMode(mode);

    if (mode === 'external' && externalSearchSources.length === 0) {
      handleSaveSearchConfig(createDefaultSearchSources(), mode);
    } else {
      handleSaveSearchConfig(externalSearchSources, mode);
    }
  }, [externalSearchSources, handleSaveSearchConfig]);

  const handleExternalSearch = useCallback(() => {
    if (!searchQuery.trim() || searchMode !== 'external') return;

    if (externalSearchSources.length === 0) {
      const defaultSources = createDefaultSearchSources();
      handleSaveSearchConfig(defaultSources, 'external');
      const searchUrl = defaultSources[0].url.replace('{query}', encodeURIComponent(searchQuery));
      window.open(searchUrl, '_blank');
      return;
    }

    let source = selectedSearchSource;
    if (!source) {
      const enabledSources = externalSearchSources.filter(s => s.enabled);
      if (enabledSources.length > 0) {
        source = enabledSources[0];
      }
    }

    if (source) {
      const searchUrl = source.url.replace('{query}', encodeURIComponent(searchQuery));
      window.open(searchUrl, '_blank');
    }
  }, [externalSearchSources, handleSaveSearchConfig, searchMode, searchQuery, selectedSearchSource]);

  return {
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
    openSearchConfigModal,
    handleSearchConfigModalSave,
    handleSearchModeChange,
    handleExternalSearch,
  };
};
