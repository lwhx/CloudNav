import { WebDavConfig } from '../../types';
import { buildRateLimitResponse, Env, getCorsHeaders, isRateLimited, validateAuth } from './storage-shared';

type WebDavOperation = 'check' | 'upload' | 'download';

interface WebDavProxyRequest {
  operation?: WebDavOperation;
  config?: WebDavConfig;
  payload?: unknown;
  filename?: string;
}

const WEBDAV_RATE_LIMIT_PER_WINDOW = 30;
const DEFAULT_BACKUP_FILENAME = 'cloudnav_backup.json';

const buildJsonResponse = (body: unknown, status: number, corsHeaders: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

const buildWebDavErrorMessage = (status: number) => {
  if (status === 520) {
    return 'Cloudflare 代理访问坚果云返回 520';
  }
  if (status === 401) {
    return 'WebDAV 用户名或应用密码不正确';
  }
  if (status === 403) {
    return 'WebDAV 服务器拒绝访问';
  }
  if (status === 404) {
    return '备份文件不存在';
  }
  return `WebDAV 返回异常状态 ${status}`;
};

const normalizeWebDavRequest = (body: unknown): WebDavProxyRequest => {
  if (!body || typeof body !== 'object') {
    return {};
  }

  const data = body as Record<string, unknown>;
  const config = data.config && typeof data.config === 'object'
    ? data.config as Partial<WebDavConfig>
    : undefined;

  return {
    operation: data.operation === 'check' || data.operation === 'upload' || data.operation === 'download'
      ? data.operation
      : undefined,
    config: config && typeof config.url === 'string' && typeof config.username === 'string' && typeof config.password === 'string'
      ? {
        url: config.url.trim(),
        username: config.username,
        password: config.password,
        enabled: Boolean(config.enabled),
      }
      : undefined,
    payload: data.payload,
    filename: typeof data.filename === 'string' && data.filename.trim() ? data.filename.trim() : undefined,
  };
};

const buildWebDavRequest = (operation: WebDavOperation, config: WebDavConfig, payload: unknown, filename?: string) => {
  let baseUrl = config.url.trim();
  if (!baseUrl.endsWith('/')) baseUrl += '/';

  const finalFilename = filename || DEFAULT_BACKUP_FILENAME;
  const fileUrl = baseUrl + encodeURIComponent(finalFilename).replace(/%2F/gi, '/');
  const authHeader = `Basic ${btoa(`${config.username}:${config.password}`)}`;
  const headers: Record<string, string> = {
    'Authorization': authHeader,
    'User-Agent': 'CloudNav/1.0',
  };

  if (operation === 'check') {
    return {
      fetchUrl: baseUrl,
      method: 'PROPFIND',
      headers: {
        ...headers,
        Depth: '0',
      },
      body: undefined,
    };
  }

  if (operation === 'upload') {
    return {
      fetchUrl: fileUrl,
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    };
  }

  return {
    fetchUrl: fileUrl,
    method: 'GET',
    headers,
    body: undefined,
  };
};

export const onRequestOptions = async (context: { request: Request }) =>
  new Response(null, {
    status: 204,
    headers: getCorsHeaders(context.request),
  });

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);

  try {
    if (await isRateLimited(env, request, 'webdav', WEBDAV_RATE_LIMIT_PER_WINDOW)) {
      return buildRateLimitResponse(corsHeaders);
    }

    const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
    if (!authCheck.ok) {
      return authCheck.response;
    }

    const { operation, config, payload, filename } = normalizeWebDavRequest(await request.json());

    if (!operation) {
      return buildJsonResponse({ error: 'Invalid operation' }, 400, corsHeaders);
    }

    if (!config || !config.url || !config.username || !config.password) {
      return buildJsonResponse({ error: 'Missing configuration' }, 400, corsHeaders);
    }

    const webDavRequest = buildWebDavRequest(operation, config, payload, filename);
    const response = await fetch(webDavRequest.fetchUrl, {
      method: webDavRequest.method,
      headers: webDavRequest.headers,
      body: webDavRequest.body,
    });

    if (operation === 'download') {
      if (!response.ok) {
        return buildJsonResponse({
          success: false,
          status: response.status,
          error: buildWebDavErrorMessage(response.status),
        }, 200, corsHeaders);
      }

      const data = await response.json();
      return buildJsonResponse(data, 200, corsHeaders);
    }

    const success = response.ok || response.status === 207;
    return buildJsonResponse({
      success,
      status: response.status,
      ...(success ? {} : { error: buildWebDavErrorMessage(response.status) }),
    }, 200, corsHeaders);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'WebDAV request failed';
    return buildJsonResponse({ error: message }, 500, corsHeaders);
  }
};
