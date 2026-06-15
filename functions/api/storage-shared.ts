export interface Env {
  CLOUDNAV_KV: any;
  PASSWORD: string;
}

export interface CloudflareRequestInit extends RequestInit {
  cf?: {
    cacheTtl?: number;
    cacheEverything?: boolean;
  };
}

export interface WebsiteConfig {
  title?: string;
  navTitle?: string;
  favicon?: string;
  cardStyle?: 'detailed' | 'simple';
  requirePasswordOnVisit?: boolean;
  passwordExpiryDays?: number;
}

export const AUTH_TIME_HEADER = 'x-auth-issued-at';
export const METADATA_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const FAVICON_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
export const FAVICON_FAILURE_CACHE_TTL_SECONDS = 10 * 60;
export const RATE_LIMIT_WINDOW_SECONDS = 60;
export const METADATA_RATE_LIMIT_PER_WINDOW = 30;
export const FAVICON_RATE_LIMIT_PER_WINDOW = 60;
export const MAX_METADATA_URL_LENGTH = 2048;
export const MAX_HTML_BYTES = 512 * 1024;
export const MAX_FAVICON_BYTES = 128 * 1024;
export const MAX_FAVICON_DATA_URI_LENGTH = Math.ceil(MAX_FAVICON_BYTES * 4 / 3) + 128;
export const MAX_METADATA_REDIRECTS = 3;
export const MAX_FAVICON_REDIRECTS = 3;

export const getCorsHeaders = (request: Request) => {
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

export const getWebsiteConfig = async (env: Env): Promise<WebsiteConfig> => {
  const websiteConfigStr = await env.CLOUDNAV_KV.get('website_config');
  if (!websiteConfigStr) {
    return { requirePasswordOnVisit: false, passwordExpiryDays: 7 };
  }
  // 防御性解析：若 website_config 被写坏，回退到默认值而不是抛错。
  try {
    return JSON.parse(websiteConfigStr);
  } catch {
    return { requirePasswordOnVisit: false, passwordExpiryDays: 7 };
  }
};

export const buildUnauthorizedResponse = (message: string, corsHeaders: Record<string, string>) =>
  new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

export const validateAuth = async (
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

    // 缺失/非数字/非正的签发时间戳视为已过期，避免省略该头绕过过期策略。
    if (!Number.isFinite(authIssuedAt) || authIssuedAt <= 0) {
      return {
        ok: false,
        response: buildUnauthorizedResponse('会话已过期，请重新输入密码', corsHeaders),
      };
    }

    if (Date.now() - authIssuedAt > expiryMs) {
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

export const hashText = (value: string) => {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) + value.charCodeAt(index);
    hash >>>= 0;
  }

  return hash.toString(36);
};

export const isPrivateIPv4 = (hostname: string) => {
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

export const isBlockedIPv6 = (hostname: string) => {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  // IPv4-mapped IPv6 (::ffff:169.254.169.254 等) 把内网 v4 藏在 v6 形式里，
  // 按内嵌 v4 部分重新校验，否则可绕过 isPrivateIPv4 实现 SSRF。
  const v4MappedMatch = normalized.match(/^(?:::ffff:|::ffff:0:|64:ff9b::|::)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4MappedMatch && isPrivateIPv4(v4MappedMatch[1])) return true;

  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')   // fe80::/10 链路本地
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
    || normalized.startsWith('ff');    // ff00::/8 多播
};

export const isBlockedHostname = (hostname: string) => {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const blockedExactHosts = new Set(['localhost', '0.0.0.0', 'metadata.google.internal']);
  const blockedSuffixes = ['.localhost', '.local', '.internal', '.lan', '.home', '.test', '.invalid'];

  return blockedExactHosts.has(normalized)
    || blockedSuffixes.some(suffix => normalized.endsWith(suffix))
    || isPrivateIPv4(normalized)
    || (normalized.includes(':') && isBlockedIPv6(normalized));
};

export const normalizeMetadataUrl = (targetUrl: string) => {
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

export const normalizeDomain = (rawDomain: string | null) => {
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

export const getClientIdentifier = (request: Request) => {
  // 仅信任 Cloudflare 边缘注入的 cf-connecting-ip；x-forwarded-for 客户端可伪造，
  // 缺失 cf-connecting-ip 时归入单一桶，避免攻击者轮换 IP 绕过限流。
  return request.headers.get('cf-connecting-ip') || 'unknown-peer';
};

export const isRateLimited = async (env: Env, request: Request, routeName: string, limit: number) => {
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

export const buildRateLimitResponse = (corsHeaders: Record<string, string>) => new Response(JSON.stringify({
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
