import { AIConfig, AIProvider, AIProviderConfig } from '../types';

type LegacyAIConfig = Partial<AIProviderConfig> & {
  provider?: AIProvider;
  websiteTitle?: string;
  faviconUrl?: string;
  navigationName?: string;
};

const DEFAULT_OPENAI_PROVIDER_ID = 'openai-default';

const createProviderId = () => `provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
export const getDefaultAIModel = (_provider: AIProvider = 'openai') => 'gpt-4o-mini';

export const getDefaultAIConfig = (apiKey = ''): AIConfig => ({
  activeProviderId: DEFAULT_OPENAI_PROVIDER_ID,
  providers: [
    {
      id: DEFAULT_OPENAI_PROVIDER_ID,
      name: 'OpenAI Compatible',
      provider: 'openai',
      apiKey,
      baseUrl: 'https://api.openai.com/v1',
      model: getDefaultAIModel('openai'),
      description: '兼容 OpenAI Chat Completions 的 API',
    },
  ],
});

export const createBlankAIProvider = (_provider: AIProvider = 'openai'): AIProviderConfig => ({
  id: createProviderId(),
  name: 'OpenAI Compatible',
  provider: 'openai',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: getDefaultAIModel('openai'),
  description: '兼容 OpenAI Chat Completions 的 API',
});

const normalizeProvider = (value: unknown, fallbackIndex: number): AIProviderConfig | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<AIProviderConfig>;
  const provider: AIProvider = 'openai';
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `provider-${fallbackIndex + 1}`;
  const name = typeof raw.name === 'string' && raw.name.trim()
    ? raw.name.trim()
    : 'OpenAI Compatible';

  return {
    id,
    name,
    provider,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
    model: typeof raw.model === 'string' && raw.model.trim()
      ? raw.model.trim()
      : getDefaultAIModel(provider),
    description: typeof raw.description === 'string' ? raw.description : '',
  };
};

const migrateLegacyAIConfig = (legacy: LegacyAIConfig, fallbackApiKey = ''): AIConfig => {
  const provider: AIProvider = 'openai';
  const id = DEFAULT_OPENAI_PROVIDER_ID;
  const name = 'OpenAI Compatible';

  return {
    activeProviderId: id,
    providers: [
      {
        id,
        name,
        provider,
        apiKey: typeof legacy.apiKey === 'string' ? legacy.apiKey : fallbackApiKey,
        baseUrl: typeof legacy.baseUrl === 'string' ? legacy.baseUrl : '',
        model: typeof legacy.model === 'string' && legacy.model.trim()
          ? legacy.model.trim()
          : getDefaultAIModel(provider),
        description: '兼容 OpenAI Chat Completions 的 API',
      },
    ],
  };
};

export const normalizeAIConfig = (value: unknown, fallbackApiKey = ''): AIConfig => {
  if (!value || typeof value !== 'object') return getDefaultAIConfig(fallbackApiKey);

  const raw = value as Partial<AIConfig> & LegacyAIConfig;
  if (!Array.isArray(raw.providers)) return migrateLegacyAIConfig(raw, fallbackApiKey);

  const seenIds = new Set<string>();
  const providers = raw.providers
    .map((provider, index) => normalizeProvider(provider, index))
    .filter((provider): provider is AIProviderConfig => {
      if (!provider || seenIds.has(provider.id)) return false;
      seenIds.add(provider.id);
      return true;
    });

  if (!providers.length) return getDefaultAIConfig(fallbackApiKey);

  const activeProviderId = typeof raw.activeProviderId === 'string'
    && providers.some(provider => provider.id === raw.activeProviderId)
    ? raw.activeProviderId
    : providers[0].id;

  return {
    activeProviderId,
    providers,
  };
};

export const getActiveAIProvider = (config: AIConfig): AIProviderConfig => {
  const normalized = normalizeAIConfig(config);
  return normalized.providers.find(provider => provider.id === normalized.activeProviderId) || normalized.providers[0];
};
