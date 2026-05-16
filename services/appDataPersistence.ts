import { APP_DATA_VERSION, AppDataEnvelope, AppDataPayload, Category, DEFAULT_CATEGORIES, INITIAL_LINKS, LinkItem } from '../types';

export const LOCAL_STORAGE_KEY = 'cloudnav_data_cache';
export const LOCAL_BACKUPS_KEY = 'cloudnav_data_backups';

const MAX_LOCAL_BACKUPS = 8;

export interface LocalBackupEntry extends AppDataEnvelope {
  capturedAt: number;
}

export const createAppDataEnvelope = (links: LinkItem[], categories: Category[]): AppDataEnvelope => ({
  links,
  categories,
  version: APP_DATA_VERSION,
  updatedAt: Date.now(),
});

export const parseAppDataPayload = (value: unknown): AppDataPayload | null => {
  if (!value || typeof value !== 'object') return null;

  const data = value as Partial<AppDataPayload>;
  if (!Array.isArray(data.links) && !Array.isArray(data.categories)) return null;

  return {
    links: Array.isArray(data.links) ? data.links : [],
    categories: Array.isArray(data.categories) ? data.categories : DEFAULT_CATEGORIES,
    version: typeof data.version === 'number' ? data.version : undefined,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : undefined,
  };
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
  return parseStoredAppData(localStorage.getItem(LOCAL_STORAGE_KEY)) || {
    links: INITIAL_LINKS,
    categories: DEFAULT_CATEGORIES,
  };
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
    version: existing.version || 1,
    updatedAt: existing.updatedAt || Date.now(),
    capturedAt: Date.now(),
  };

  const backups = loadLocalBackups();
  const latest = backups[0];
  if (latest && JSON.stringify(latest.links) === JSON.stringify(backup.links) && JSON.stringify(latest.categories) === JSON.stringify(backup.categories)) {
    return;
  }

  localStorage.setItem(LOCAL_BACKUPS_KEY, JSON.stringify([backup, ...backups].slice(0, MAX_LOCAL_BACKUPS)));
};

export const saveLocalAppData = (links: LinkItem[], categories: Category[]) => {
  const currentRaw = localStorage.getItem(LOCAL_STORAGE_KEY);
  rememberLocalBackup(currentRaw);

  const envelope = createAppDataEnvelope(links, categories);
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(envelope));
  return envelope;
};

export const getLocalDataBackups = () => loadLocalBackups();
