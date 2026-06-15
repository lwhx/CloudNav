export interface LinkItem {
  id: string;
  title: string;
  url: string;
  icon?: string;
  description?: string;
  tags?: string[];
  categoryId: string;
  createdAt: number;
  pinned?: boolean; // New field for pinning
  pinnedOrder?: number; // Field for pinned link sorting order
  order?: number;
  updatedAt?: number; // Last-modified timestamp; used by cloud/local merge to resolve per-record conflicts
  deletedAt?: number;
  deletedFromCategoryId?: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string; // Lucide icon name or emoji
  groupId?: string;
  password?: string; // Optional password for category protection
  deletedAt?: number;
}


export interface CategoryGroup {
  id: string;
  name: string;
  icon?: string;
  order?: number;
  deletedAt?: number;
}

export type TrashItemType = 'link' | 'category';

export interface AIOrganizeResult {
  description?: string;
  categoryId?: string;
  tags?: string[];
}

export interface AICategorySuggestion {
  name: string;
  icon?: string;
  reason?: string;
  linkIds: string[];
}

export const DEFAULT_CATEGORY_GROUP_ID = 'default';

export const DEFAULT_CATEGORY_GROUP: CategoryGroup = {
  id: DEFAULT_CATEGORY_GROUP_ID,
  name: '默认分组',
  icon: 'Folder',
  order: 0,
};

export interface SiteSettings {
  title: string;
  navTitle: string;
  favicon: string;
  cardStyle: 'detailed' | 'simple';
  requirePasswordOnVisit: boolean;
  passwordExpiryDays: number; // 密码过期天数，0表示永久不退出
  /** 允许发起跨域请求的浏览器扩展 ID（对应 manifest 的扩展来源 chrome-extension://<id>/moz-extension://<id>）。
   *  为空时拒绝所有扩展来源，仅允许同源。 */
  allowedExtensionIds?: string[];
}

export interface AppState {
  links: LinkItem[];
  categories: Category[];
  categoryGroups?: CategoryGroup[];
  darkMode: boolean;
  settings?: SiteSettings;
}

export const APP_DATA_VERSION = 2;

export interface AppDataPayload {
  links: LinkItem[];
  categories: Category[];
  categoryGroups?: CategoryGroup[];
  version?: number;
  updatedAt?: number;
}

export interface AppDataEnvelope extends AppDataPayload {
  version: number;
  updatedAt: number;
}

export interface WebDavConfig {
  url: string;
  username: string;
  password: string;
  enabled: boolean;
}

export type AIProvider = 'gemini' | 'openai';

export interface AIProviderConfig {
  id: string;
  name: string;
  provider: AIProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  description?: string;
}

export interface AIConfig {
  providers: AIProviderConfig[];
  activeProviderId: string;
}



// 搜索模式类型
export type SearchMode = 'internal' | 'external';

// 外部搜索源配置
export interface ExternalSearchSource {
  id: string;
  name: string;
  url: string;
  icon?: string;
  enabled: boolean;
  createdAt: number;
}

// 搜索配置
export interface SearchConfig {
  mode: SearchMode;
  externalSources: ExternalSearchSource[];
  selectedSource?: ExternalSearchSource | null; // 选中的搜索源
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'common', name: '常用推荐', icon: 'Star' },
  { id: 'dev', name: '开发工具', icon: 'Code' },
  { id: 'design', name: '设计资源', icon: 'Palette' },
  { id: 'read', name: '阅读资讯', icon: 'BookOpen' },
  { id: 'ent', name: '休闲娱乐', icon: 'Gamepad2' },
  { id: 'ai', name: '人工智能', icon: 'Bot' },
];

export const INITIAL_LINKS: LinkItem[] = [
  { id: '1', title: 'GitHub', url: 'https://github.com', categoryId: 'dev', createdAt: Date.now(), description: '代码托管平台', pinned: true, icon: 'https://www.faviconextractor.com/favicon/github.com?larger=true' },
  { id: '2', title: 'React', url: 'https://react.dev', categoryId: 'dev', createdAt: Date.now(), description: '构建Web用户界面的库', pinned: true, icon: 'https://www.faviconextractor.com/favicon/react.dev?larger=true' },
  { id: '3', title: 'Tailwind CSS', url: 'https://tailwindcss.com', categoryId: 'design', createdAt: Date.now(), description: '原子化CSS框架', pinned: true, icon: 'https://www.faviconextractor.com/favicon/tailwindcss.com?larger=true' },
  { id: '4', title: 'ChatGPT', url: 'https://chat.openai.com', categoryId: 'ai', createdAt: Date.now(), description: 'OpenAI聊天机器人', pinned: true, icon: 'https://www.faviconextractor.com/favicon/chat.openai.com?larger=true' },
  { id: '5', title: 'Gemini', url: 'https://gemini.google.com', categoryId: 'ai', createdAt: Date.now(), description: 'Google DeepMind AI', pinned: true, icon: 'https://www.faviconextractor.com/favicon/gemini.google.com?larger=true' },
];
