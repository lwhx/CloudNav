import { useCallback, useState } from 'react';
import { Category, LinkItem } from '../types';

interface UseCategoryAccessOptions {
  categories: Category[];
  links: LinkItem[];
  updateData: (links: LinkItem[], categories: Category[]) => void;
  requireAuth: () => boolean;
  showToast: (message: string, type: 'success' | 'error' | 'warning' | 'info') => void;
  buildAuthHeaders: (token?: string | null, extraHeaders?: Record<string, string>) => Record<string, string>;
  setSelectedCategory: (categoryId: string) => void;
  setSidebarOpen: (open: boolean) => void;
}

export const useCategoryAccess = ({
  categories,
  links,
  updateData,
  requireAuth,
  showToast,
  buildAuthHeaders,
  setSelectedCategory,
  setSidebarOpen,
}: UseCategoryAccessOptions) => {
  const [unlockedCategoryIds, setUnlockedCategoryIds] = useState<Set<string>>(new Set());
  const [catAuthModalData, setCatAuthModalData] = useState<Category | null>(null);
  const [categoryActionAuth, setCategoryActionAuth] = useState<{
    isOpen: boolean;
    action: 'edit' | 'delete';
    categoryId: string;
    categoryName: string;
  }>({
    isOpen: false,
    action: 'edit',
    categoryId: '',
    categoryName: '',
  });

  const handleCategoryClick = useCallback((cat: Category) => {
    if (cat.password && !unlockedCategoryIds.has(cat.id)) {
      setCatAuthModalData(cat);
      setSidebarOpen(false);
      return;
    }
    setSelectedCategory(cat.id);
    setSidebarOpen(false);
  }, [setSelectedCategory, setSidebarOpen, unlockedCategoryIds]);

  const handleUnlockCategory = useCallback((catId: string) => {
    setUnlockedCategoryIds(prev => new Set(prev).add(catId));
    setSelectedCategory(catId);
  }, [setSelectedCategory]);

  const handleUpdateCategories = useCallback((newCats: Category[]) => {
    if (!requireAuth()) return;
    updateData(links, newCats);
  }, [links, requireAuth, updateData]);

  const handleDeleteCategory = useCallback((catId: string) => {
    if (!requireAuth()) return;

    if (catId === 'common') {
      showToast('常用推荐分类不能被删除', 'warning');
      return;
    }

    const now = Date.now();
    let newCats = categories.map(c => c.id === catId ? { ...c, deletedAt: now } : c);

    if (!newCats.some(c => c.id === 'common')) {
      newCats = [
        { id: 'common', name: '常用推荐', icon: 'Star' },
        ...newCats,
      ];
    }

    const newLinks = links.map(l => l.categoryId === catId && !l.deletedAt ? { ...l, categoryId: 'common' } : l);
    updateData(newLinks, newCats);
  }, [categories, links, requireAuth, showToast, updateData]);

  const handleCategoryActionAuth = useCallback(async (password: string): Promise<boolean> => {
    try {
      const authResponse = await fetch('/api/storage', {
        method: 'POST',
        headers: buildAuthHeaders(password, {
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ authOnly: true }),
      });

      return authResponse.ok;
    } catch (error) {
      console.error('Category action auth error:', error);
      return false;
    }
  }, [buildAuthHeaders]);

  const openCategoryActionAuth = useCallback((action: 'edit' | 'delete', categoryId: string, categoryName: string) => {
    setCategoryActionAuth({
      isOpen: true,
      action,
      categoryId,
      categoryName,
    });
  }, []);

  const closeCategoryActionAuth = useCallback(() => {
    setCategoryActionAuth({
      isOpen: false,
      action: 'edit',
      categoryId: '',
      categoryName: '',
    });
  }, []);

  const isCategoryLocked = useCallback((catId: string) => {
    const cat = categories.find(c => c.id === catId);
    if (!cat) return false;
    if (!cat.password) return false;
    return !unlockedCategoryIds.has(catId);
  }, [categories, unlockedCategoryIds]);

  return {
    unlockedCategoryIds,
    catAuthModalData,
    setCatAuthModalData,
    categoryActionAuth,
    handleCategoryClick,
    handleUnlockCategory,
    handleUpdateCategories,
    handleDeleteCategory,
    handleCategoryActionAuth,
    openCategoryActionAuth,
    closeCategoryActionAuth,
    isCategoryLocked,
  };
};
