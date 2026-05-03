import { CloudflareRequestInit, MAX_FAVICON_BYTES, MAX_FAVICON_DATA_URI_LENGTH, MAX_FAVICON_REDIRECTS, normalizeMetadataUrl } from './storage-shared';

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

export const isSafeDataIcon = (icon: string) => {
  if (icon.length > MAX_FAVICON_DATA_URI_LENGTH) return false;

  const commaIndex = icon.indexOf(',');
  if (commaIndex < 0) return false;

  const header = icon.slice(0, commaIndex).toLowerCase();
  if (!header.startsWith('data:')) return false;

  return !!getSafeImageContentType(header.replace(/^data:/, '').replace(/;base64$/, ''));
};

export const fetchAndEncodeImage = async (imageUrl: string) => {
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

export const fetchAndEncodeFavicon = async (domain: string) => {
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
