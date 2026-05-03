import {
  Env,
  FAVICON_CACHE_TTL_SECONDS,
  FAVICON_FAILURE_CACHE_TTL_SECONDS,
  FAVICON_RATE_LIMIT_PER_WINDOW,
  getCorsHeaders,
  getWebsiteConfig,
  METADATA_RATE_LIMIT_PER_WINDOW,
  buildRateLimitResponse,
  isRateLimited,
  normalizeDomain,
  validateAuth,
} from './storage-shared';
import { fetchPageTitle } from './storage-metadata';
import { fetchAndEncodeFavicon, fetchAndEncodeImage, isSafeDataIcon } from './storage-favicon';

export const onRequestOptions = async (context: { request: Request }) => {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(context.request),
  });
};

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

    if (checkAuth === 'true') {
      return new Response(JSON.stringify({
        hasPassword: !!serverPassword,
        requiresAuth,
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

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
      } catch {
        return new Response(JSON.stringify({ title: '', success: false, reason: 'metadata_fetch_failed' }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    if (getConfig === 'favicon') {
      const domain = normalizeDomain(url.searchParams.get('domain'));
      const shouldFetch = url.searchParams.get('fetch') === 'true';
      if (!domain) {
        return new Response(JSON.stringify({ error: 'Domain parameter is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

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

      return new Response(JSON.stringify({ icon: null, cached: false }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const data = await env.CLOUDNAV_KV.get('app_data');

    if (requiresAuth) {
      const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
      if (!authCheck.ok) {
        return authCheck.response;
      }
    }

    if (!data) {
      return new Response(JSON.stringify({ links: [], categories: [] }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response(data, {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);
  const providedPassword = request.headers.get('x-auth-password');
  const serverPassword = env.PASSWORD;

  try {
    const body = await request.json();

    if (body.authOnly) {
      const authCheck = await validateAuth(request, env, corsHeaders);
      if (!authCheck.ok) {
        return authCheck.response;
      }

      return new Response(JSON.stringify({ success: true, authenticatedAt: Date.now() }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (body.saveConfig === 'search') {
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

    if (body.saveConfig === 'ai') {
      await env.CLOUDNAV_KV.put('ai_config', JSON.stringify(body.config));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (body.saveConfig === 'website') {
      await env.CLOUDNAV_KV.put('website_config', JSON.stringify(body.config));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    await env.CLOUDNAV_KV.put('app_data', JSON.stringify(body));

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to save data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};
