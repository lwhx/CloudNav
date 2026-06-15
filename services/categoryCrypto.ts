// 分类密码的哈希/校验工具。客户端与服务端（Cloudflare Workers，均支持 WebCrypto）共用。
// 明文密码不入库：存储 PBKDF2-SHA256 派生值 + 每个分类独立的盐。

const PBKDF2_ITERATIONS = 100_000;
const KEY_HASH_LENGTH = 32; // 256 bit

const encoder = new TextEncoder();

const toHex = (bytes: Uint8Array) => {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
};

const fromHex = (hex: string) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
};

// 生成 16 字节随机盐，返回 hex。
export const generateSalt = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
};

// 用密码 + 盐派生哈希（hex）。盐为空时抛错。
export const hashCategoryPassword = async (password: string, saltHex: string) => {
  if (!saltHex) throw new Error('salt required');
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    KEY_HASH_LENGTH * 8
  );
  return toHex(new Uint8Array(derived));
};

// 校验：用明文 + 存储的盐重新派生，与存储的哈希恒定时间比较。
export const verifyCategoryPassword = async (
  password: string,
  storedHashHex: string,
  saltHex: string
) => {
  if (!storedHashHex || !saltHex) return false;
  try {
    const candidate = await hashCategoryPassword(password, saltHex);
    if (candidate.length !== storedHashHex.length) return false;
    let diff = 0;
    for (let i = 0; i < candidate.length; i++) {
      diff |= candidate.charCodeAt(i) ^ storedHashHex.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
};
