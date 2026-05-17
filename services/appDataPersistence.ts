import {
  APP_DATA_VERSION,
  AppDataEnvelope,
  AppDataPayload,
  Category,
  CategoryGroup,
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_GROUP,
  DEFAULT_CATEGORY_GROUP_ID,
  INITIAL_LINKS,
  LinkItem,
} from '../types';

export const LOCAL_STORAGE_KEY = 'cloudnav_data_cache';
export const LOCAL_BACKUPS_KEY = 'cloudnav_data_backups';
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const MAX_LOCAL_BACKUPS = 8;
const MAX_TAGS_PER_LINK = 8;
const MAX_TAG_LENGTH = 20;

export interface LocalBackupEntry extends AppDataEnvelope {
  capturedAt: number;
}

export const normalizeTags = (tags?: unknown): string[] => {
  if (!Array.isArray(tags)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];

  tags.forEach(tag => {
    if (typeof tag !== 'string') return;
    const value = tag.trim().replace(/^#/, '').slice(0, MAX_TAG_LENGTH);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return;
    seen.add(key);
    normalized.push(value);
  });

  return normalized.slice(0, MAX_TAGS_PER_LINK);
};

const isExpiredTrash = (deletedAt?: number) => {
  return typeof deletedAt === 'number' && deletedAt > 0 && Date.now() - deletedAt > TRASH_RETENTION_MS;
};

export const normalizeAppData = (payload: Partial<AppDataPayload> | null | undefined): AppDataPayload => {
  const rawGroups = Array.isArray(payload?.categoryGroups) ? payload!.categoryGroups : [];
  const groupMap = new Map<string, CategoryGroup>();

  [DEFAULT_CATEGORY_GROUP, ...rawGroups].forEach((group, index) => {
    if (!group || !group.id || isExpiredTrash(group.deletedAt)) return;
    groupMap.set(group.id, {
      ...group,
      name: group.name || '默认分组',
      icon: group.icon || 'Folder',
      order: typeof group.order === 'number' ? group.order : index,
    });
  });

  const categoryGroups = Array.from(groupMap.values()).sort((a, b) => (a.order || 0) - (b.order || 0));
  const groupIds = new Set(categoryGroups.filter(group => !group.deletedAt).map(group => group.id));

  const categoriesSource = Array.isArray(payload?.categories) ? payload!.categories : DEFAULT_CATEGORIES;
  let categories = categoriesSource
    .filter(category => !isExpiredTrash(category.deletedAt))
    .map((category, index) => ({
      ...category,
      icon: category.icon || 'Folder',
      groupId: category.groupId && groupIds.has(category.groupId) ? category.groupId : DEFAULT_CATEGORY_GROUP_ID,
      order: (category as Category & { order?: number }).order ?? index,
    }));

  if (!categories.some(category => category.id === 'common')) {
    categories = [{ ...DEFAULT_CATEGORIES[0], groupId: DEFAULT_CATEGORY_GROUP_ID, order: -1 }, ...categories];
  }

  const validCategoryIds = new Set(categories.filter(category => !category.deletedAt).map(category => category.id));
  const linksSource = Array.isArray(payload?.links) ? payload!.links : INITIAL_LINKS;
  const links = linksSource
    .filter(link => !isExpiredTrash(link.deletedAt))
    .map(link => ({
      ...link,
      tags: normalizeTags(link.tags),
      categoryId: validCategoryIds.has(link.categoryId) || link.deletedAt ? link.categoryId : 'common',
    }));

  return {
    links,
    categories,
    categoryGroups,
    version: typeof payload?.version === 'number' ? payload.version : APP_DATA_VERSION,
    updatedAt: typeof payload?.updatedAt === 'number' ? payload.updatedAt : Date.now(),
  };
};

export const createAppDataEnvelope = (
  links: LinkItem[],
  categories: Category[],
  categoryGroups?: CategoryGroup[],
): AppDataEnvelope => {
  const normalized = normalizeAppData({ links, categories, categoryGroups });
  return {
    links: normalized.links,
    categories: normalized.categories,
    categoryGroups: normalized.categoryGroups,
    version: APP_DATA_VERSION,
    updatedAt: Date.now(),
  };
};

export const parseAppDataPayload = (value: unknown): AppDataPayload | null => {
  if (!value || typeof value !== 'object') return null;

  const data = value as Partial<AppDataPayload>;
  if (!Array.isArray(data.links) && !Array.isArray(data.categories)) return null;

  return normalizeAppData(data);
};

export const parseStoredAppData = (raw: string | null): AppDataPayload | null => {
  if (!raw) return null;

  try {
    return parseAppDataPayload(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const loadLocalAppData = (): AppDataPayload => {
  return parseStoredAppData(localStorage.getItem(LOCAL_STORAGE_KEY)) || normalizeAppData({
    links: INITIAL_LINKS,
    categories: DEFAULT_CATEGORIES,
    categoryGroups: [DEFAULT_CATEGORY_GROUP],
  });
};

const loadLocalBackups = (): LocalBackupEntry[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_BACKUPS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => parseAppDataPayload(item)) : [];
  } catch {
    return [];
  }
};

const rememberLocalBackup = (raw: string | null) => {
  const existing = parseStoredAppData(raw);
  if (!existing) return;

  const backup: LocalBackupEntry = {
    links: existing.links,
    categories: existing.categories,
    categoryGroups: existing.categoryGroups || [DEFAULT_CATEGORY_GROUP],
    version: existing.version || 1,
    updatedAt: existing.updatedAt || Date.now(),
    capturedAt: Date.now(),
  };

  const backups = loadLocalBackups();
  const latest = backups[0];
  if (
    latest
    && JSON.stringify(latest.links) === JSON.stringify(backup.links)
    && JSON.stringify(latest.categories) === JSON.stringify(backup.categories)
    && JSON.stringify(latest.categoryGroups) === JSON.stringify(backup.categoryGroups)
  ) {
    return;
  }

  localStorage.setItem(LOCAL_BACKUPS_KEY, JSON.stringify([backup, ...backups].slice(0, MAX_LOCAL_BACKUPS)));
};

export const saveLocalAppData = (links: LinkItem[], categories: Category[], categoryGroups?: CategoryGroup[]) => {
  const currentRaw = localStorage.getItem(LOCAL_STORAGE_KEY);
  rememberLocalBackup(currentRaw);

  const envelope = createAppDataEnvelope(links, categories, categoryGroups);
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(envelope));
  return envelope;
};

export const getLocalDataBackups = () => loadLocalBackups();
