const ALLOWED_WEB_PROTOCOLS = new Set(['http:', 'https:']);

export const normalizeWebUrl = (rawValue: string): string | null => {
  const value = rawValue.trim();
  if (!value) return null;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(candidate);
    return ALLOWED_WEB_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
};

export const buildSafeSearchUrl = (template: string, query: string): string | null => {
  const resolved = template.replace('{query}', encodeURIComponent(query));
  return normalizeWebUrl(resolved);
};
