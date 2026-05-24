import { AIConfig, AIProvider, AIProviderConfig } from '../types';

type LegacyAIConfig = Partial<AIProviderConfig> & {
  provider?: AIProvider;
  websiteTitle?: string;
  faviconUrl?: string;
  navigationName?: string;
};

const DEFAULT_GEMINI_PROVIDER_ID = 'gemini-default';
const DEFAULT_OPENAI_PROVIDER_ID = 'openai-default';

const createProviderId = () => `provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
export const getDefaultAIModel = (provider: AIProvider) => provider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini';

export const getDefaultAIConfig = (apiKey = ''): AIConfig => ({
  activeProviderId: DEFAULT_GEMINI_PROVIDER_ID,
  providers: [
    {
      id: DEFAULT_GEMINI_PROVIDER_ID,
      name: 'Google Gemini',
      provider: 'gemini',
      apiKey,
      baseUrl: '',
      model: getDefaultAIModel('gemini'),
      description: 'Google Gemini 官方模型',
    },
  ],
});

export const createBlankAIProvider = (provider: AIProvider = 'openai'): AIProviderConfig => ({
  id: createProviderId(),
  name: provider === 'gemini' ? 'Google Gemini' : 'OpenAI Compatible',
  provider,
  apiKey: '',
  baseUrl: provider === 'openai' ? 'https://api.openai.com/v1' : '',
  model: getDefaultAIModel(provider),
  description: provider === 'gemini' ? 'Google Gemini 官方模型' : '兼容 OpenAI Chat Completions 的 API',
});

const normalizeProvider = (value: unknown, fallbackIndex: number): AIProviderConfig | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<AIProviderConfig>;
  const provider: AIProvider = raw.provider === 'gemini' ? 'gemini' : 'openai';
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `provider-${fallbackIndex + 1}`;
  const name = typeof raw.name === 'string' && raw.name.trim()
    ? raw.name.trim()
    : provider === 'gemini' ? 'Google Gemini' : 'OpenAI Compatible';

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
  const provider = legacy.provider === 'openai' ? 'openai' : 'gemini';
  const id = provider === 'gemini' ? DEFAULT_GEMINI_PROVIDER_ID : DEFAULT_OPENAI_PROVIDER_ID;
  const name = provider === 'gemini' ? 'Google Gemini' : 'OpenAI Compatible';

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
        description: provider === 'gemini' ? 'Google Gemini 官方模型' : '兼容 OpenAI Chat Completions 的 API',
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
