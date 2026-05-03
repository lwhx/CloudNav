import { Category, LinkItem } from '../../types';
import { buildRateLimitResponse, Env, getCorsHeaders, isRateLimited, validateAuth } from './storage-shared';

interface QuickAddLinkRequest {
  title?: string;
  url?: string;
  description?: string;
  categoryId?: string;
  icon?: string;
}

interface StoredAppData {
  links: LinkItem[];
  categories: Category[];
}

const LINK_RATE_LIMIT_PER_WINDOW = 20;

const buildJsonResponse = (body: unknown, corsHeaders: Record<string, string>, status = 200) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
};

const readStoredAppData = async (env: Env): Promise<StoredAppData> => {
  const currentDataStr = await env.CLOUDNAV_KV.get('app_data');
  if (!currentDataStr) {
    return { links: [], categories: [] };
  }

  const parsedData = JSON.parse(currentDataStr) as Partial<StoredAppData>;
  return {
    links: Array.isArray(parsedData.links) ? parsedData.links : [],
    categories: Array.isArray(parsedData.categories) ? parsedData.categories : [],
  };
};

const findTargetCategory = (categories: Category[], categoryId?: string) => {
  if (categoryId) {
    const explicitCategory = categories.find(category => category.id === categoryId);
    if (explicitCategory) {
      return {
        id: explicitCategory.id,
        name: explicitCategory.name,
      };
    }
  }

  if (categories.length === 0) {
    return {
      id: 'common',
      name: '默认',
    };
  }

  const keywords = ['收集', '未分类', 'inbox', 'temp', 'later'];
  const matchedCategory = categories.find(category =>
    keywords.some(keyword => category.name.toLowerCase().includes(keyword)),
  );

  if (matchedCategory) {
    return {
      id: matchedCategory.id,
      name: matchedCategory.name,
    };
  }

  const commonCategory = categories.find(category => category.id === 'common');
  if (commonCategory) {
    return {
      id: commonCategory.id,
      name: commonCategory.name,
    };
  }

  return {
    id: categories[0].id,
    name: categories[0].name,
  };
};

const normalizeQuickAddRequest = (body: unknown): QuickAddLinkRequest => {
  if (!body || typeof body !== 'object') {
    return {};
  }

  const data = body as Record<string, unknown>;
  return {
    title: typeof data.title === 'string' ? data.title.trim() : undefined,
    url: typeof data.url === 'string' ? data.url.trim() : undefined,
    description: typeof data.description === 'string' ? data.description.trim() : undefined,
    categoryId: typeof data.categoryId === 'string' ? data.categoryId.trim() : undefined,
    icon: typeof data.icon === 'string' ? data.icon.trim() : undefined,
  };
};

export const onRequestOptions = async (context: { request: Request }) => {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(context.request),
  });
};

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);

  try {
    if (await isRateLimited(env, request, 'link', LINK_RATE_LIMIT_PER_WINDOW)) {
      return buildRateLimitResponse(corsHeaders);
    }

    const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
    if (!authCheck.ok) {
      return authCheck.response;
    }

    const newLinkData = normalizeQuickAddRequest(await request.json());

    if (!newLinkData.title || !newLinkData.url) {
      return buildJsonResponse({ error: 'Missing title or url' }, corsHeaders, 400);
    }

    const currentData = await readStoredAppData(env);
    const targetCategory = findTargetCategory(currentData.categories, newLinkData.categoryId);
    const createdAt = Date.now();
    const newLink: LinkItem = {
      id: createdAt.toString(),
      title: newLinkData.title,
      url: newLinkData.url,
      description: newLinkData.description || '',
      categoryId: targetCategory.id,
      createdAt,
      pinned: false,
      icon: newLinkData.icon || undefined,
    };

    const nextData: StoredAppData = {
      ...currentData,
      links: [newLink, ...currentData.links],
    };

    await env.CLOUDNAV_KV.put('app_data', JSON.stringify(nextData));

    return buildJsonResponse({
      success: true,
      link: newLink,
      categoryName: targetCategory.name,
    }, corsHeaders);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save link';
    return buildJsonResponse({ error: message }, corsHeaders, 500);
  }
};
