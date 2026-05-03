import { CloudflareRequestInit, Env, hashText, METADATA_CACHE_TTL_SECONDS, MAX_HTML_BYTES, MAX_METADATA_REDIRECTS, normalizeMetadataUrl } from './storage-shared';

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

export const fetchPageTitle = async (env: Env, targetUrl: string) => {
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
