import { pinyin } from 'pinyin-pro';
import { LinkItem } from '../types';

export interface PinyinIndex {
  full: string;      // 全拼小写，如 "kaifagongju"
  initial: string;   // 首字母小写，如 "kfgj"
}

// 把一段文本转成 {全拼, 首字母}。非汉字原样保留（小写）。
// 用于搜索索引：让 "kaifa" 能命中 "开发"。
const toPinyinIndex = (text: string): PinyinIndex => {
  if (!text) return { full: '', initial: '' };
  try {
    const full = pinyin(text, { toneType: 'none', type: 'array', nonZh: 'consecutive' })
      .join('')
      .toLowerCase();
    const initial = pinyin(text, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' })
      .join('')
      .toLowerCase();
    return { full, initial };
  } catch {
    return { full: text.toLowerCase(), initial: text.toLowerCase() };
  }
};

// 为一批链接生成拼音索引 Map<linkId, PinyinIndex>。
// 在 useMemo 中按 links 调用，links 不变时不重算。
export const buildPinyinIndex = (links: LinkItem[]): Map<string, PinyinIndex> => {
  const map = new Map<string, PinyinIndex>();
  for (const link of links) {
    // 标题是拼音搜索的主要受益字段；URL/描述/标签通常含英文/数字，拼音收益小，跳过以省算力。
    if (link.title) {
      map.set(link.id, toPinyinIndex(link.title));
    }
  }
  return map;
};
