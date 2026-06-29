import React, { useState, useEffect, useRef } from 'react';
import { useModalA11y } from '../hooks/useModalA11y';
import { X, Sparkles, Loader2, Pin, Wand2, Trash2 } from 'lucide-react';
import { LinkItem, Category, AIConfig } from '../types';
import { normalizeTags } from '../services/appDataPersistence';
import { getActiveAIProvider } from '../services/aiConfigService';
import { NotifyHandler } from '../hooks/useToast';

interface LinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (link: Omit<LinkItem, 'id' | 'createdAt'>) => void;
  onDelete?: (id: string) => void;
  categories: Category[];
  initialData?: Partial<LinkItem>;
  isEditing?: boolean;
  aiConfig: AIConfig;
  defaultCategoryId?: string;
  onNotify?: NotifyHandler;
}

const parseTagInput = (value: string) => normalizeTags(value.split(/[，,\n]/));

const LinkModal: React.FC<LinkModalProps> = ({ isOpen, onClose, onSave, onDelete, categories, initialData, isEditing = false, aiConfig, defaultCategoryId, onNotify }) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id || 'common');
  const [pinned, setPinned] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [icon, setIcon] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFetchingIcon, setIsFetchingIcon] = useState(false);
  const [isFetchingTitle, setIsFetchingTitle] = useState(false);
  const [autoFetchIcon, setAutoFetchIcon] = useState(true);
  const [batchMode, setBatchMode] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const titleFetchControllerRef = useRef<AbortController | null>(null);
  const titleFetchUrlRef = useRef('');
  
  // 当模态框关闭时，重置批量模式为默认关闭状态
  useEffect(() => {
    if (!isOpen) {
      titleFetchControllerRef.current?.abort();
      titleFetchControllerRef.current = null;
      titleFetchUrlRef.current = '';
      setIsFetchingTitle(false);
      setBatchMode(false);
      setShowSuccessMessage(false);
    }
  }, [isOpen]);
  
  // 成功提示1秒后自动消失
  useEffect(() => {
    if (showSuccessMessage) {
      const timer = setTimeout(() => {
        setShowSuccessMessage(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [showSuccessMessage]);

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setTitle(initialData.title || '');
        setUrl(initialData.url || '');
        setDescription(initialData.description || '');
        setCategoryId(initialData.categoryId || defaultCategoryId || categories[0]?.id || 'common');
        setPinned(initialData.pinned || false);
        setTags(normalizeTags(initialData.tags));
        setTagInput('');
        setIcon(initialData.icon || '');
      } else {
        setTitle('');
        setUrl('');
        setDescription('');
        // 如果有默认分类ID且该分类存在，则使用默认分类，否则使用第一个分类
        const defaultCategory = defaultCategoryId && categories.find(cat => cat.id === defaultCategoryId);
        setCategoryId(defaultCategory ? defaultCategoryId : (categories[0]?.id || 'common'));
        setPinned(false);
        setTags([]);
        setTagInput('');
        setIcon('');
      }
    }
  }, [isOpen, initialData, categories, defaultCategoryId]);

  // 当URL变化且启用自动获取图标时，自动获取图标
  useEffect(() => {
    if (url && autoFetchIcon && !isEditing) {
      const timer = setTimeout(() => {
        handleFetchIcon();
      }, 500); // 延迟500ms执行，避免频繁请求
      
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, autoFetchIcon, isEditing]);

  useEffect(() => {
    if (url && !title.trim() && !isEditing) {
      const timer = setTimeout(() => {
        handleFetchTitle(url);
      }, 500);

      return () => clearTimeout(timer);
    }

    titleFetchControllerRef.current?.abort();
    titleFetchControllerRef.current = null;
    titleFetchUrlRef.current = '';
    setIsFetchingTitle(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, title, isEditing]);

  const handleDelete = () => {
    if (!initialData?.id) return;
    if (onDelete) onDelete(initialData.id);
    onClose();
  };

  const commitTagInput = () => {
    const nextTags = parseTagInput(tagInput);
    if (nextTags.length === 0) return;
    setTags(prev => normalizeTags([...prev, ...nextTags]));
    setTagInput('');
  };

  const removeTag = (targetTag: string) => {
    setTags(prev => prev.filter(tag => tag.toLowerCase() !== targetTag.toLowerCase()));
  };

  const handleTagKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commitTagInput();
    }
  };

  // 缓存自定义图标到KV空间
  const cacheCustomIcon = async (url: string, iconUrl: string) => {
    try {
      let domain = url;
      if (domain.startsWith('http://') || domain.startsWith('https://')) {
        const urlObj = new URL(domain);
        domain = urlObj.hostname;
      }
      
      // 将自定义图标保存到KV缓存
      const authToken = localStorage.getItem('cloudnav_auth_token');
      if (authToken) {
        const authIssuedAt = localStorage.getItem('lastLoginTime');
        const response = await fetch('/api/storage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
            ...(authIssuedAt ? { 'x-auth-issued-at': authIssuedAt } : {})
          },
          body: JSON.stringify({
            saveConfig: 'favicon',
            domain: domain,
            icon: iconUrl
          })
        });

        if (response.ok) {
          const data = await response.json();
          return data.icon || iconUrl;
        }
      }
    } catch (error) {
      console.log("Failed to cache custom icon", error);
    }

    return iconUrl;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title || !url) return;
    
    // 确保URL有协议前缀
    let finalUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      finalUrl = 'https://' + url;
    }

    let finalIcon = icon;
    if (finalIcon) {
      finalIcon = await cacheCustomIcon(finalUrl, finalIcon);
      setIcon(finalIcon);
    }
    
    // 保存链接数据
    // 注意：onSave 类型是 Omit<LinkItem, 'id' | 'createdAt'>，绝不能传 id——
    // handleEditLink 用 {...l, ...data} 展开，传 id:'' 会覆盖真实 id 导致链接失忆。
    onSave({
      title,
      url: finalUrl,
      icon: finalIcon,
      description,
      categoryId,
      pinned,
      tags: normalizeTags([...tags, ...parseTagInput(tagInput)])
    });
    
    // 批量模式下不关闭窗口，只显示成功提示
    if (batchMode) {
      titleFetchControllerRef.current?.abort();
      titleFetchControllerRef.current = null;
      titleFetchUrlRef.current = '';
      setIsFetchingTitle(false);
      setShowSuccessMessage(true);
      // 重置表单，但保留分类和批量模式设置
      setTitle('');
      setUrl('');
      setIcon('');
      setDescription('');
      setPinned(false);
      setTags([]);
      setTagInput('');
    } else {
      onClose();
    }
  };

  const handleAIAssist = async () => {
    if (!url) return;
    const activeAIProvider = getActiveAIProvider(aiConfig);
    if (!activeAIProvider.apiKey) {
        onNotify?.(`请先在 AI 设置里为 ${activeAIProvider.name} 配置 API Key`, 'warning');
        return;
    }

    setIsGenerating(true);

    // Parallel execution for speed
    try {
        const { organizeLink } = await import('../services/geminiService');
        // 标题为空时先抓页面 meta：既补标题，也给 AI 更多上下文，提升自动填写准确率。
        let pageMeta: { title?: string; description?: string } | undefined;
        if (!title.trim()) {
            try {
                const metaRes = await fetch(`/api/storage?getConfig=pageMeta&url=${encodeURIComponent(url)}`);
                if (metaRes.ok) {
                    const metaJson = await metaRes.json();
                    if (metaJson.success && (metaJson.title || metaJson.description)) {
                        pageMeta = { title: metaJson.title, description: metaJson.description };
                        if (metaJson.title) setTitle(metaJson.title);
                    }
                }
            } catch {
                // meta 抓取失败不阻塞 AI 填写，回退到现有 title/url。
            }
        }
        const effectiveTitle = title.trim() || pageMeta?.title || '';
        const result = await organizeLink(effectiveTitle, url, description, categories.filter(category => !category.deletedAt), tags, aiConfig, pageMeta);
        if (result.description) setDescription(result.description);
        if (result.categoryId && categories.some(category => !category.deletedAt && category.id === result.categoryId)) setCategoryId(result.categoryId);
        if (result.tags?.length) setTags(prev => normalizeTags([...prev, ...result.tags!].slice(0, 8)));

    } catch (e) {
        console.error("AI Assist failed:", e instanceof Error ? e.name : 'unknown');
    } finally {
        setIsGenerating(false);
    }
  };

  const handleFetchTitle = async (targetUrl = url) => {
    const requestUrl = targetUrl.trim();
    if (!requestUrl || title.trim()) return;

    titleFetchControllerRef.current?.abort();
    const controller = new AbortController();
    titleFetchControllerRef.current = controller;
    titleFetchUrlRef.current = requestUrl;
    setIsFetchingTitle(true);

    try {
      const response = await fetch(`/api/storage?getConfig=metadata&url=${encodeURIComponent(requestUrl)}`, {
        signal: controller.signal,
      });
      if (!response.ok) return;

      const data = await response.json();
      const fetchedTitle = typeof data.title === 'string' ? data.title.trim() : '';
      const isCurrentRequest = titleFetchUrlRef.current === requestUrl && url.trim() === requestUrl;
      if (fetchedTitle && isCurrentRequest && !title.trim()) {
        setTitle(fetchedTitle);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.log("Failed to fetch title", error);
      }
    } finally {
      if (titleFetchUrlRef.current === requestUrl) {
        titleFetchControllerRef.current = null;
        titleFetchUrlRef.current = '';
        setIsFetchingTitle(false);
      }
    }
  };

  const handleFetchIcon = async () => {
    if (!url) return;
    
    setIsFetchingIcon(true);
    try {
      // 提取域名
      let domain = url;
      // 如果URL没有协议前缀，添加https://作为默认协议
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        domain = 'https://' + url;
      }
      
      if (domain.startsWith('http://') || domain.startsWith('https://')) {
        const urlObj = new URL(domain);
        domain = urlObj.hostname;
      }
      
      // 先尝试从KV缓存获取图标
      try {
        const response = await fetch(`/api/storage?getConfig=favicon&domain=${encodeURIComponent(domain)}&fetch=true`);
        if (response.ok) {
          const data = await response.json();
          if (data.cached && data.icon) {
            setIcon(data.icon);
            setIsFetchingIcon(false);
            return;
          }
        }
      } catch (error) {
        console.log("Failed to fetch cached icon, will generate new one", error);
      }
      
      // 如果缓存中没有，则生成新图标
      const iconUrl = `https://www.faviconextractor.com/favicon/${domain}?larger=true`;
      setIcon(iconUrl);
      
      // 将图标保存到KV缓存
      try {
        const authToken = localStorage.getItem('cloudnav_auth_token');
        if (authToken) {
          const authIssuedAt = localStorage.getItem('lastLoginTime');
          await fetch('/api/storage', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`,
              ...(authIssuedAt ? { 'x-auth-issued-at': authIssuedAt } : {})
            },
            body: JSON.stringify({
              saveConfig: 'favicon',
              domain: domain,
              icon: iconUrl
            })
          });
        }
      } catch (error) {
        console.log("Failed to cache icon:", error instanceof Error ? error.name : 'unknown');
      }
    } catch (e) {
      console.error("Failed to fetch icon:", e instanceof Error ? e.name : 'unknown');
      onNotify?.("无法获取图标，请检查 URL 是否正确", 'error');
    } finally {
      setIsFetchingIcon(false);
    }
  };
  useModalA11y({ isOpen, overlayRef, onClose, initialFocusSelector: 'input[name="link-title"]' });


  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="link-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
    >
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-700">
        <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <h3 id="link-modal-title" className="text-lg font-semibold dark:text-white">
              {isEditing ? '编辑链接' : '添加新链接'}
            </h3>
            <button
              type="button"
              onClick={() => setPinned(!pinned)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-all ${
                pinned 
                ? 'bg-blue-100 border-blue-200 text-blue-600 dark:bg-blue-900/40 dark:border-blue-800 dark:text-blue-300' 
                : 'bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-400'
              }`}
              title={pinned ? "取消置顶" : "置顶"}
            >
              <Pin size={14} className={pinned ? "fill-current" : ""} />
              <span className="text-xs font-medium">置顶</span>
            </button>
            {!isEditing && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-md border bg-slate-50 border-slate-200 dark:bg-slate-700 dark:border-slate-600">
                <input
                  type="checkbox"
                  id="batchMode"
                  checked={batchMode}
                  onChange={(e) => setBatchMode(e.target.checked)}
                  className="h-3 w-3 text-blue-600 focus:ring-blue-500 border-slate-300 rounded dark:border-slate-600 dark:bg-slate-700"
                />
                <label htmlFor="batchMode" className="text-xs font-medium text-slate-500 dark:text-slate-400 cursor-pointer">
                  批量添加不关窗口
                </label>
              </div>
            )}
            {isEditing && onDelete && (
              <button
                type="button"
                onClick={handleDelete}
                className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-all ${
                  'bg-red-50 border-red-200 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:border-red-800/30 dark:text-red-400 dark:hover:bg-red-900/30'
                }`}
                title="删除链接"
              >
                <Trash2 size={14} />
                <span className="text-xs font-medium">删除</span>
              </button>
            )}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
            <X className="w-5 h-5 dark:text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">标题</label>
            <div className="relative">
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full p-2 pr-9 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder="网站名称"
              />
              {isFetchingTitle && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-slate-400" />
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">URL 链接</label>
            <div className="flex gap-2">
                <input
                type="text"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder="example.com 或 https://..."
                />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">图标 URL</label>
            <div className="flex gap-2">
              {icon && (
                <div className="w-10 h-10 rounded-xl border border-slate-300 dark:border-slate-600 overflow-hidden flex-shrink-0 bg-white dark:bg-slate-700">
                  <img
                    key={icon}
                    src={icon}
                    alt="图标预览"
                    className="w-full h-full object-cover rounded-xl"
                    onLoad={(e) => {
                      e.currentTarget.style.display = 'block';
                    }}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                </div>
              )}
              <input
                type="url"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder="https://example.com/icon.png"
              />
              <button
                type="button"
                onClick={handleFetchIcon}
                disabled={!url || isFetchingIcon}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-1 transition-colors"
              >
                {isFetchingIcon ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4" />
                )}
                获取图标
              </button>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                id="autoFetchIcon"
                checked={autoFetchIcon}
                onChange={(e) => setAutoFetchIcon(e.target.checked)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 rounded dark:border-slate-600 dark:bg-slate-700"
              />
              <label htmlFor="autoFetchIcon" className="text-sm text-slate-700 dark:text-slate-300">
                自动获取URL链接的图标
              </label>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
                <label className="block text-sm font-medium dark:text-slate-300">描述 (选填)</label>
                {url && (
                    <button
                        type="button"
                        onClick={handleAIAssist}
                        disabled={isGenerating}
                        className="text-xs flex items-center gap-1 text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
                    >
                        {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        AI 自动填写
                    </button>
                )}
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all h-20 resize-none"
              placeholder="简短描述..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">分类</label>
            <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            >
            {categories.filter(cat => !cat.deletedAt).map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">标签</label>
            <div className="flex flex-wrap gap-2 rounded-lg border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-700">
              {tags.map(tag => (
                <button
                  type="button"
                  key={tag}
                  onClick={() => removeTag(tag)}
                  className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300"
                  title="点击移除标签"
                >
                  #{tag} ×
                </button>
              ))}
              <input
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={commitTagInput}
                placeholder="输入标签后回车"
                className="min-w-[120px] flex-1 bg-transparent text-sm outline-none dark:text-white"
              />
            </div>
            <p className="mt-1 text-xs text-slate-400">最多 8 个标签，支持逗号或回车添加。</p>
          </div>

          <div className="pt-2 relative">
            {/* 成功提示 */}
            {showSuccessMessage && (
              <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 z-10 px-4 py-2 bg-green-500 text-white rounded-lg shadow-lg transition-opacity duration-300">
                添加成功
              </div>
            )}
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors shadow-lg shadow-blue-500/30"
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LinkModal;
