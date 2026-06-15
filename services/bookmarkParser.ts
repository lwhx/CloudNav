import { LinkItem, Category } from '../types';

// 用 crypto.randomUUID 避免批量导入时同毫秒 id 碰撞；不可用时回退到时间戳+随机
const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

// 拒绝可执行/本地协议，防止导入的书签成为点击即触发的 XSS 载荷。
const isUnsafeUrlScheme = (url: string) => {
  const schemeMatch = url.match(/^\s*([a-z][a-z0-9+.\-]*):/i);
  if (!schemeMatch) return false;
  const scheme = schemeMatch[1].toLowerCase();
  // 仅允许 http/https；javascript:/data:/file:/vbscript:/chrome:/about: 等一律拒绝
  return scheme !== 'http' && scheme !== 'https';
};

export interface ImportResult {
  links: LinkItem[];
  categories: Category[];
}

export const parseBookmarks = async (file: File): Promise<ImportResult> => {
  const text = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/html');

  const links: LinkItem[] = [];
  const categories: Category[] = [];
  const categoryMap = new Map<string, string>(); // Name -> ID

  // Helper to get or create category ID
  const getCategoryId = (name: string): string => {
    if (!name) return 'common';
    // Normalize: remove generic folders like "Bookmarks Bar"
    if (['Bookmarks Bar', '书签栏', 'Other Bookmarks', '其他书签'].includes(name)) {
        return 'common';
    }

    if (categoryMap.has(name)) {
      return categoryMap.get(name)!;
    }
    
    // Check existing default categories could be mapped here if we had access, 
    // but for now we create new ones.
    const newId = generateId();
    categories.push({
      id: newId,
      name: name,
      icon: 'Folder' // Default icon for imported folders
    });
    categoryMap.set(name, newId);
    return newId;
  };

  // Traverse the DL/DT structure
  // Chrome structure: <DT><H3>Folder Name</H3><DL> ...items... </DL>
  
  const traverse = (element: Element, currentCategoryName: string) => {
    const children = Array.from(element.children);
    
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      const tagName = node.tagName.toUpperCase();

      if (tagName === 'DT') {
        // DT can contain an H3 (Folder) or A (Link)
        // 只看 DT 的直接子元素，避免 querySelector 抓到嵌套子文件夹里的链接
        const directChild = (tag: string) =>
          Array.from(node.children).find(c => c.tagName.toUpperCase() === tag);
        const h3 = directChild('H3');
        const a = directChild('A');
        const dl = directChild('DL');

        if (h3 && dl) {
            // It's a folder
            const folderName = h3.textContent || 'Unknown';
            traverse(dl, folderName);
        } else if (a) {
            // It's a link
            const title = a.textContent || a.getAttribute('href') || 'No Title';
            const url = a.getAttribute('href');
            
            if (url && !isUnsafeUrlScheme(url)) {
                links.push({
                    id: generateId(),
                    title: title,
                    url: url,
                    categoryId: getCategoryId(currentCategoryName),
                    createdAt: Date.now(),
                    icon: a.getAttribute('icon') || undefined
                });
            }
        }
      }
    }
  };

  const rootDl = doc.querySelector('dl');
  if (rootDl) {
    traverse(rootDl, 'common');
  }

  return { links, categories };
};