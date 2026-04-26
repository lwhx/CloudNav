interface Env {
  CLOUDNAV_KV: any;
  PASSWORD: string;
}

interface CloudflareRequestInit extends RequestInit {
  cf?: {
    cacheTtl?: number;
    cacheEverything?: boolean;
  };
}

interface WebsiteConfig {
  title?: string;
  navTitle?: string;
  favicon?: string;
  cardStyle?: 'detailed' | 'simple';
  requirePasswordOnVisit?: boolean;
  passwordExpiryDays?: number;
}

const AUTH_TIME_HEADER = 'x-auth-issued-at';

const getCorsHeaders = (request: Request) => {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowOrigin = origin && (
    origin === requestUrl.origin ||
    origin.startsWith('chrome-extension://') ||
    origin.startsWith('moz-extension://')
  ) ? origin : requestUrl.origin;

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': `Content-Type, x-auth-password, ${AUTH_TIME_HEADER}`,
  };
};

const getWebsiteConfig = async (env: Env): Promise<WebsiteConfig> => {
  const websiteConfigStr = await env.CLOUDNAV_KV.get('website_config');
  return websiteConfigStr
    ? JSON.parse(websiteConfigStr)
    : { requirePasswordOnVisit: false, passwordExpiryDays: 7 };
};

const buildUnauthorizedResponse = (message: string, corsHeaders: Record<string, string>) =>
  new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

const validateAuth = async (
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>,
  options: { requireSession?: boolean } = {}
) => {
  const serverPassword = env.PASSWORD;
  if (!serverPassword) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Server misconfigured: PASSWORD not set' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }),
    };
  }

  const providedPassword = request.headers.get('x-auth-password');
  if (!providedPassword || providedPassword !== serverPassword) {
    return {
      ok: false,
      response: buildUnauthorizedResponse('Unauthorized', corsHeaders),
    };
  }

  const websiteConfig = await getWebsiteConfig(env);
  const passwordExpiryDays = websiteConfig.passwordExpiryDays ?? 7;

  if (options.requireSession && passwordExpiryDays > 0) {
    const authIssuedAtRaw = request.headers.get(AUTH_TIME_HEADER);
    const authIssuedAt = authIssuedAtRaw ? Number(authIssuedAtRaw) : NaN;
    const expiryMs = passwordExpiryDays * 24 * 60 * 60 * 1000;

    if (Number.isFinite(authIssuedAt) && authIssuedAt > 0 && Date.now() - authIssuedAt > expiryMs) {
      return {
        ok: false,
        response: buildUnauthorizedResponse('密码已过期，请重新输入', corsHeaders),
      };
    }
  }

  return {
    ok: true,
    websiteConfig,
  };
};

const normalizeDomain = (rawDomain: string | null) => {
  if (!rawDomain) return '';

  try {
    const trimmedDomain = rawDomain.trim();
    if (!trimmedDomain || trimmedDomain.length > 253) return '';

    const value = /^https?:\/\//i.test(trimmedDomain) ? trimmedDomain : `https://${trimmedDomain}`;
    const parsedUrl = new URL(value);
    const hostname = parsedUrl.hostname.replace(/\.$/, '').toLowerCase();

    if (!hostname || hostname.length > 253 || isBlockedHostname(hostname)) return '';
    if (parsedUrl.port && !['80', '443'].includes(parsedUrl.port)) return '';

    const labels = hostname.split('.');
    const isValidHostname = labels.every(label => label.length > 0 && label.length <= 63 && /^[a-z0-9-]+$/i.test(label) && !label.startsWith('-') && !label.endsWith('-'));
    return isValidHostname || isPrivateIPv4(hostname) ? hostname : '';
  } catch {
    return '';
  }
};

const toBase64 = (buffer: ArrayBufferLike) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

const fetchAndEncodeImage = async (imageUrl: string) => {
  try {
    const parsedUrl = normalizeMetadataUrl(imageUrl);
    const response = await fetchAssetResponse(parsedUrl);

    if (!response.ok) return null;

    const contentType = getSafeImageContentType(response.headers.get('content-type'));
    if (!contentType) return null;

    const arrayBuffer = await readLimitedImage(response);
    if (!arrayBuffer.byteLength) return null;

    return `data:${contentType};base64,${toBase64(arrayBuffer)}`;
  } catch {
    return null;
  }
};

const fetchAndEncodeFavicon = async (domain: string) => {
  const providers = [
    `https://www.faviconextractor.com/favicon/${encodeURIComponent(domain)}?larger=true`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`,
  ];

  for (const iconUrl of providers) {
    const encoded = await fetchAndEncodeImage(iconUrl);
    if (encoded) return encoded;
  }

  return null;
};

const METADATA_CACHE_TTL_SECONDS = 24 * 60 * 60;
const FAVICON_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const FAVICON_FAILURE_CACHE_TTL_SECONDS = 10 * 60;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const METADATA_RATE_LIMIT_PER_WINDOW = 30;
const FAVICON_RATE_LIMIT_PER_WINDOW = 60;
const MAX_METADATA_URL_LENGTH = 2048;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_FAVICON_BYTES = 128 * 1024;
const MAX_FAVICON_DATA_URI_LENGTH = Math.ceil(MAX_FAVICON_BYTES * 4 / 3) + 128;
const MAX_METADATA_REDIRECTS = 3;
const MAX_FAVICON_REDIRECTS = 3;

const decodeHtmlEntities = (value: string) => value
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&#x27;/g, "'")
  .replace(/&#x2F;/g, '/')
  .replace(/&#(\d+);/g, (_, code) => {
    const codePoint = Number(code);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
  })
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
    const codePoint = parseInt(code, 16);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
  });

const normalizeTitle = (value: string) => decodeHtmlEntities(value)
  .replace(/<[^>]*>/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 200);

const getTagAttribute = (tag: string, attributeName: string) => {
  const attributes = new Map<string, string>();
  const attributePattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/g;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(tag))) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }

  return attributes.get(attributeName.toLowerCase()) || '';
};

const extractMetaTitle = (html: string) => {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  const titleNames = new Set(['og:title', 'twitter:title']);

  for (const tag of metaTags) {
    const property = getTagAttribute(tag, 'property').toLowerCase();
    const name = getTagAttribute(tag, 'name').toLowerCase();
    const content = getTagAttribute(tag, 'content');

    if (content && (titleNames.has(property) || titleNames.has(name))) {
      return normalizeTitle(content);
    }
  }

  return '';
};

const extractPageTitle = (html: string) => {
  const metaTitle = extractMetaTitle(html);
  if (metaTitle) return metaTitle;

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch?.[1] ? normalizeTitle(titleMatch[1]) : '';
};

const hashText = (value: string) => {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) + value.charCodeAt(index);
    hash >>>= 0;
  }

  return hash.toString(36);
};

const isPrivateIPv4 = (hostname: string) => {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;

  return first === 10
    || first === 127
    || first === 0
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 100 && second >= 64 && second <= 127)
    || first >= 224;
};

const isBlockedIPv6 = (hostname: string) => {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80:')
    || normalized.startsWith('ff');
};

const isBlockedHostname = (hostname: string) => {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const blockedExactHosts = new Set(['localhost', '0.0.0.0', 'metadata.google.internal']);
  const blockedSuffixes = ['.localhost', '.local', '.internal', '.lan', '.home', '.test', '.invalid'];

  return blockedExactHosts.has(normalized)
    || blockedSuffixes.some(suffix => normalized.endsWith(suffix))
    || isPrivateIPv4(normalized)
    || (normalized.includes(':') && isBlockedIPv6(normalized));
};

const normalizeMetadataUrl = (targetUrl: string) => {
  const trimmedUrl = targetUrl.trim();
  if (!trimmedUrl || trimmedUrl.length > MAX_METADATA_URL_LENGTH) {
    throw new Error('Invalid URL length');
  }

  const normalizedUrl = /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`;
  const parsedUrl = new URL(normalizedUrl);

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported');
  }

  if (parsedUrl.port && !['80', '443'].includes(parsedUrl.port)) {
    throw new Error('Only standard HTTP and HTTPS ports are supported');
  }

  if (!parsedUrl.hostname || isBlockedHostname(parsedUrl.hostname)) {
    throw new Error('Blocked target host');
  }

  parsedUrl.hash = '';
  return parsedUrl;
};

const readLimitedHtml = async (response: Response) => {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_HTML_BYTES) {
    throw new Error('HTML response is too large');
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error('Response is not HTML');
  }

  if (!response.body) {
    const html = await response.text();
    return html.slice(0, MAX_HTML_BYTES);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let html = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error('HTML response exceeds size limit');
    }

    html += decoder.decode(value, { stream: true });
    if (/<\/head>|<\/title>/i.test(html)) {
      await reader.cancel();
      break;
    }
  }

  return html + decoder.decode();
};

const getSafeImageContentType = (contentType: string | null) => {
  const normalizedContentType = (contentType || '').split(';')[0].trim().toLowerCase();
  const safeContentTypes = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/x-icon',
    'image/vnd.microsoft.icon',
  ]);

  return safeContentTypes.has(normalizedContentType) ? normalizedContentType : '';
};

const isSafeDataIcon = (icon: string) => {
  if (icon.length > MAX_FAVICON_DATA_URI_LENGTH) return false;

  const header = icon.slice(0, icon.indexOf(',')).toLowerCase();
  if (!header.startsWith('data:')) return false;

  return !!getSafeImageContentType(header.replace(/^data:/, '').replace(/;base64$/, ''));
};

const readLimitedImage = async (response: Response) => {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_FAVICON_BYTES) {
    throw new Error('Image response is too large');
  }

  const contentType = getSafeImageContentType(response.headers.get('content-type'));
  if (!contentType) {
    throw new Error('Response is not a supported image');
  }

  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_FAVICON_BYTES) {
      throw new Error('Image response exceeds size limit');
    }

    return arrayBuffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_FAVICON_BYTES) {
      await reader.cancel();
      throw new Error('Image response exceeds size limit');
    }

    chunks.push(value);
  }

  const result = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result.buffer;
};

const fetchMetadataResponse = async (parsedUrl: URL) => {
  let currentUrl = parsedUrl;

  for (let redirectCount = 0; redirectCount <= MAX_METADATA_REDIRECTS; redirectCount += 1) {
    const response = await fetch(currentUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CloudNav/1.0; +https://cloudnav.local)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'manual',
      cf: { cacheTtl: 300, cacheEverything: false },
    } as CloudflareRequestInit);

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new Error('Redirect location is missing');
    }

    currentUrl = normalizeMetadataUrl(new URL(location, currentUrl).toString());
  }

  throw new Error('Too many redirects');
};

const fetchAssetResponse = async (parsedUrl: URL) => {
  let currentUrl = parsedUrl;

  for (let redirectCount = 0; redirectCount <= MAX_FAVICON_REDIRECTS; redirectCount += 1) {
    const response = await fetch(currentUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CloudNav/1.0; +https://cloudnav.local)',
        'Accept': 'image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8',
      },
      redirect: 'manual',
      cf: { cacheTtl: 86400, cacheEverything: true },
    } as CloudflareRequestInit);

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new Error('Redirect location is missing');
    }

    currentUrl = normalizeMetadataUrl(new URL(location, currentUrl).toString());
  }

  throw new Error('Too many redirects');
};

const getClientIdentifier = (request: Request) => {
  return request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'anonymous';
};

const isRateLimited = async (env: Env, request: Request, routeName: string, limit: number) => {
  const windowId = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000));
  const clientHash = hashText(getClientIdentifier(request));
  const cacheKey = `rate:${routeName}:${clientHash}:${windowId}`;
  const currentCount = Number(await env.CLOUDNAV_KV.get(cacheKey) || '0');

  if (Number.isFinite(currentCount) && currentCount >= limit) {
    return true;
  }

  await env.CLOUDNAV_KV.put(cacheKey, String((Number.isFinite(currentCount) ? currentCount : 0) + 1), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS + 10,
  });
  return false;
};

const buildRateLimitResponse = (corsHeaders: Record<string, string>) => new Response(JSON.stringify({
  success: false,
  error: 'Too many requests',
}), {
  status: 429,
  headers: {
    'Content-Type': 'application/json',
    'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS),
    ...corsHeaders,
  },
});

const fetchPageTitle = async (env: Env, targetUrl: string) => {
  const parsedUrl = normalizeMetadataUrl(targetUrl);
  const metadataCacheKey = `metadata:title:${hashText(parsedUrl.toString())}`;
  const cachedTitle = await env.CLOUDNAV_KV.get(metadataCacheKey);

  if (cachedTitle) {
    return { title: cachedTitle, cached: true };
  }

  const response = await fetchMetadataResponse(parsedUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch page with status ${response.status}`);
  }

  const html = await readLimitedHtml(response);
  const title = extractPageTitle(html);

  if (title) {
    await env.CLOUDNAV_KV.put(metadataCacheKey, title, { expirationTtl: METADATA_CACHE_TTL_SECONDS });
  }

  return { title, cached: false };
};

// 处理 OPTIONS 请求（解决跨域预检）
export const onRequestOptions = async (context: { request: Request }) => {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(context.request),
  });
};

// GET: 获取数据
export const onRequestGet = async (context: { env: Env; request: Request }) => {
  const corsHeaders = getCorsHeaders(context.request);
  try {
    const { env, request } = context;
    const url = new URL(request.url);
    const checkAuth = url.searchParams.get('checkAuth');
    const getConfig = url.searchParams.get('getConfig');
    const websiteConfig = await getWebsiteConfig(env);
    const serverPassword = env.PASSWORD;
    const requiresAuth = !!serverPassword && !!websiteConfig.requirePasswordOnVisit;
    
    // 如果是检查认证请求，返回是否设置了密码
    if (checkAuth === 'true') {
      return new Response(JSON.stringify({ 
        hasPassword: !!serverPassword,
        requiresAuth
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是获取配置请求
    if (getConfig === 'ai') {
      const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
      if (!authCheck.ok) {
        return authCheck.response;
      }
      const aiConfig = await env.CLOUDNAV_KV.get('ai_config');
      return new Response(aiConfig || '{}', {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是获取搜索配置请求
    if (getConfig === 'search') {
      const searchConfig = await env.CLOUDNAV_KV.get('search_config');
      return new Response(searchConfig || '{}', {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (getConfig === 'webdav') {
      const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
      if (!authCheck.ok) {
        return authCheck.response;
      }
      const webDavConfig = await env.CLOUDNAV_KV.get('webdav_config');
      return new Response(webDavConfig || '{}', {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是获取网站配置请求
    if (getConfig === 'website') {
      return new Response(JSON.stringify({
        requirePasswordOnVisit: false,
        passwordExpiryDays: 7,
        ...websiteConfig,
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (getConfig === 'metadata') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) {
        return new Response(JSON.stringify({ error: 'URL parameter is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (await isRateLimited(env, request, 'metadata', METADATA_RATE_LIMIT_PER_WINDOW)) {
        return buildRateLimitResponse(corsHeaders);
      }

      try {
        const metadata = await fetchPageTitle(env, targetUrl);
        return new Response(JSON.stringify({ success: true, ...metadata }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ title: '', success: false, reason: 'metadata_fetch_failed' }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }
    
    // 如果是获取图标请求
    if (getConfig === 'favicon') {
      const domain = normalizeDomain(url.searchParams.get('domain'));
      const shouldFetch = url.searchParams.get('fetch') === 'true';
      if (!domain) {
        return new Response(JSON.stringify({ error: 'Domain parameter is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      
      // 从KV中获取缓存的图标
      const cachedIcon = await env.CLOUDNAV_KV.get(`favicon:${domain}`);
      if (cachedIcon && (!shouldFetch || cachedIcon.startsWith('data:'))) {
        return new Response(JSON.stringify({ icon: cachedIcon, cached: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (shouldFetch) {
        if (await isRateLimited(env, request, 'favicon', FAVICON_RATE_LIMIT_PER_WINDOW)) {
          return buildRateLimitResponse(corsHeaders);
        }

        const failureCacheKey = `favicon:fail:${domain}`;
        const recentFailure = await env.CLOUDNAV_KV.get(failureCacheKey);
        if (recentFailure) {
          return new Response(JSON.stringify({ icon: cachedIcon || null, cached: !!cachedIcon, reason: 'recent_fetch_failed' }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const fetchedIcon = await fetchAndEncodeFavicon(domain);

        if (fetchedIcon) {
          await env.CLOUDNAV_KV.put(`favicon:${domain}`, fetchedIcon, { expirationTtl: FAVICON_CACHE_TTL_SECONDS });
          return new Response(JSON.stringify({ icon: fetchedIcon, cached: true }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        await env.CLOUDNAV_KV.put(failureCacheKey, '1', { expirationTtl: FAVICON_FAILURE_CACHE_TTL_SECONDS });

        if (cachedIcon) {
          return new Response(JSON.stringify({ icon: cachedIcon, cached: true }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      }
      
      // 如果没有缓存，返回空结果
      return new Response(JSON.stringify({ icon: null, cached: false }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 从 KV 中读取数据
    const data = await env.CLOUDNAV_KV.get('app_data');
    
    // 如果开启了访问认证，读取数据时也需要密码
    if (requiresAuth) {
      const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
      if (!authCheck.ok) {
        return authCheck.response;
      }
    }
    
    if (!data) {
      // 如果没有数据，返回空结构
      return new Response(JSON.stringify({ links: [], categories: [] }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response(data, {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};

// POST: 保存数据
export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);

  // 1. 验证密码（对于敏感操作需要密码）
  const providedPassword = request.headers.get('x-auth-password');
  const serverPassword = env.PASSWORD;

  try {
    const body = await request.json();
    
    // 如果只是验证密码，不更新数据
    if (body.authOnly) {
      const authCheck = await validateAuth(request, env, corsHeaders);
      if (!authCheck.ok) {
        return authCheck.response;
      }
      
      return new Response(JSON.stringify({ success: true, authenticatedAt: Date.now() }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是保存搜索配置（允许无密码访问，因为搜索配置不包含敏感数据）
    if (body.saveConfig === 'search') {
      // 如果服务器设置了密码，需要验证密码
      if (serverPassword) {
        const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
        if (!authCheck.ok) {
          return authCheck.response;
        }
      }
      
      await env.CLOUDNAV_KV.put('search_config', JSON.stringify(body.config));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (body.saveConfig === 'webdav') {
      const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
      if (!authCheck.ok) {
        return authCheck.response;
      }
      await env.CLOUDNAV_KV.put('webdav_config', JSON.stringify(body.config));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 保存图标也需要密码，避免任意写入缓存
    if (body.saveConfig === 'favicon') {
      const domain = normalizeDomain(body.domain);
      const { icon } = body;
      if (!domain || !icon) {
        return new Response(JSON.stringify({ error: 'Domain and icon are required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (!serverPassword || providedPassword !== serverPassword) {
        const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
        if (!authCheck.ok) {
          return authCheck.response;
        }
      }
      
      let finalIcon = icon;
      if (finalIcon.startsWith('data:')) {
        if (!isSafeDataIcon(finalIcon)) {
          return new Response(JSON.stringify({ error: 'Unsupported or oversized favicon data' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      } else {
        const isCustomImageUrl = /^https?:\/\//i.test(finalIcon);
        finalIcon = isCustomImageUrl
          ? await fetchAndEncodeImage(finalIcon)
          : await fetchAndEncodeFavicon(domain);
      }

      if (!finalIcon) {
        return new Response(JSON.stringify({ error: 'Failed to fetch favicon' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      await env.CLOUDNAV_KV.put(`favicon:${domain}`, finalIcon);
      return new Response(JSON.stringify({ success: true, icon: finalIcon }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 对于其他操作（保存AI配置、应用数据等），需要密码验证
    if (serverPassword) {
      const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
      if (!authCheck.ok) {
        return authCheck.response;
      }
    } else {
      return new Response(JSON.stringify({ error: 'Server misconfigured: PASSWORD not set' }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是保存AI配置
    if (body.saveConfig === 'ai') {
      await env.CLOUDNAV_KV.put('ai_config', JSON.stringify(body.config));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是保存网站配置
    if (body.saveConfig === 'website') {
      await env.CLOUDNAV_KV.put('website_config', JSON.stringify(body.config));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 将数据写入 KV
    await env.CLOUDNAV_KV.put('app_data', JSON.stringify(body));

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to save data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};
