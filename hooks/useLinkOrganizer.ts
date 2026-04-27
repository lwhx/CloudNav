import React, { useCallback, useState } from 'react';
import { DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Category, LinkItem } from '../types';

interface UseLinkOrganizerOptions {
  links: LinkItem[];
  categories: Category[];
  selectedCategory: string;
  displayedLinks: LinkItem[];
  authToken: string;
  requireAuth: () => boolean;
  updateData: (links: LinkItem[], categories: Category[]) => void;
  showToast: (message: string, type: 'success' | 'error' | 'warning' | 'info') => void;
  editingLink?: LinkItem;
  setEditingLink: (link?: LinkItem) => void;
  setPrefillLink: (link?: Partial<LinkItem>) => void;
  setIsAuthOpen: (open: boolean) => void;
}

export const useLinkOrganizer = ({
  links,
  categories,
  selectedCategory,
  displayedLinks,
  authToken,
  requireAuth,
  updateData,
  showToast,
  editingLink,
  setEditingLink,
  setPrefillLink,
  setIsAuthOpen,
}: UseLinkOrganizerOptions) => {
  const [isSortingMode, setIsSortingMode] = useState<string | null>(null);
  const [isSortingPinned, setIsSortingPinned] = useState(false);
  const [isBatchEditMode, setIsBatchEditMode] = useState(false);
  const [selectedLinks, setSelectedLinks] = useState<Set<string>>(new Set());

  const toggleBatchEditMode = useCallback(() => {
    if (!requireAuth()) return;
    setIsBatchEditMode(prev => !prev);
    setSelectedLinks(new Set());
  }, [requireAuth]);

  const toggleLinkSelection = useCallback((linkId: string) => {
    setSelectedLinks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(linkId)) {
        newSet.delete(linkId);
      } else {
        newSet.add(linkId);
      }
      return newSet;
    });
  }, []);

  const handleBatchDelete = useCallback(() => {
    if (!authToken) {
      setIsAuthOpen(true);
      return;
    }

    if (selectedLinks.size === 0) {
      showToast('请先选择要删除的链接', 'warning');
      return;
    }

    if (confirm(`确定要删除选中的 ${selectedLinks.size} 个链接吗？`)) {
      const newLinks = links.filter(link => !selectedLinks.has(link.id));
      updateData(newLinks, categories);
      setSelectedLinks(new Set());
      setIsBatchEditMode(false);
    }
  }, [authToken, categories, links, selectedLinks, setIsAuthOpen, showToast, updateData]);

  const handleBatchMove = useCallback((targetCategoryId: string) => {
    if (!authToken) {
      setIsAuthOpen(true);
      return;
    }

    if (selectedLinks.size === 0) {
      showToast('请先选择要移动的链接', 'warning');
      return;
    }

    const newLinks = links.map(link =>
      selectedLinks.has(link.id) ? { ...link, categoryId: targetCategoryId } : link,
    );
    updateData(newLinks, categories);
    setSelectedLinks(new Set());
    setIsBatchEditMode(false);
  }, [authToken, categories, links, selectedLinks, setIsAuthOpen, showToast, updateData]);

  const handleSelectAll = useCallback(() => {
    const currentLinkIds = displayedLinks.map(link => link.id);

    if (selectedLinks.size === currentLinkIds.length && currentLinkIds.every(id => selectedLinks.has(id))) {
      setSelectedLinks(new Set());
    } else {
      setSelectedLinks(new Set(currentLinkIds));
    }
  }, [displayedLinks, selectedLinks]);

  const handleAddLink = useCallback((data: Omit<LinkItem, 'id' | 'createdAt'>) => {
    if (!authToken) {
      setIsAuthOpen(true);
      return;
    }

    let processedUrl = data.url;
    if (processedUrl && !processedUrl.startsWith('http://') && !processedUrl.startsWith('https://')) {
      processedUrl = 'https://' + processedUrl;
    }

    const categoryLinks = links.filter(link =>
      !link.pinned && (data.categoryId === 'all' || link.categoryId === data.categoryId),
    );
    const maxOrder = categoryLinks.length > 0
      ? Math.max(...categoryLinks.map(link => link.order || 0))
      : -1;

    const newLink: LinkItem = {
      ...data,
      url: processedUrl,
      id: Date.now().toString(),
      createdAt: Date.now(),
      order: maxOrder + 1,
      pinnedOrder: data.pinned ? links.filter(l => l.pinned).length : undefined,
    };

    if (newLink.pinned) {
      const firstNonPinnedIndex = links.findIndex(link => !link.pinned);
      if (firstNonPinnedIndex === -1) {
        updateData([...links, newLink], categories);
      } else {
        const updatedLinks = [...links];
        updatedLinks.splice(firstNonPinnedIndex, 0, newLink);
        updateData(updatedLinks, categories);
      }
    } else {
      const updatedLinks = [...links, newLink].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;

        const aOrder = a.order !== undefined ? a.order : a.createdAt;
        const bOrder = b.order !== undefined ? b.order : b.createdAt;
        return aOrder - bOrder;
      });
      updateData(updatedLinks, categories);
    }

    setPrefillLink(undefined);
  }, [authToken, categories, links, setIsAuthOpen, setPrefillLink, updateData]);

  const handleEditLink = useCallback((data: Omit<LinkItem, 'id' | 'createdAt'>) => {
    if (!authToken) {
      setIsAuthOpen(true);
      return;
    }
    if (!editingLink) return;

    let processedUrl = data.url;
    if (processedUrl && !processedUrl.startsWith('http://') && !processedUrl.startsWith('https://')) {
      processedUrl = 'https://' + processedUrl;
    }

    const updated = links.map(l => l.id === editingLink.id ? { ...l, ...data, url: processedUrl } : l);
    updateData(updated, categories);
    setEditingLink(undefined);
  }, [authToken, categories, editingLink, links, setEditingLink, setIsAuthOpen, updateData]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const categoryLinks = links.filter(link =>
        selectedCategory === 'all' || link.categoryId === selectedCategory,
      );
      const activeIndex = categoryLinks.findIndex(link => link.id === active.id);
      const overIndex = categoryLinks.findIndex(link => link.id === over.id);

      if (activeIndex !== -1 && overIndex !== -1) {
        const reorderedCategoryLinks = arrayMove<LinkItem>(categoryLinks, activeIndex, overIndex);
        const updatedLinks = links.map(link => {
          const reorderedIndex = reorderedCategoryLinks.findIndex(l => l.id === link.id);
          if (reorderedIndex !== -1) {
            return { ...link, order: reorderedIndex };
          }
          return link;
        });

        updatedLinks.sort((a, b) => (a.order || 0) - (b.order || 0));
        updateData(updatedLinks, categories);
      }
    }
  }, [categories, links, selectedCategory, updateData]);

  const handlePinnedDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const pinnedLinksList = links.filter(link => link.pinned);
      const activeIndex = pinnedLinksList.findIndex(link => link.id === active.id);
      const overIndex = pinnedLinksList.findIndex(link => link.id === over.id);

      if (activeIndex !== -1 && overIndex !== -1) {
        const reorderedPinnedLinks = arrayMove<LinkItem>(pinnedLinksList, activeIndex, overIndex);
        const pinnedOrderMap = new Map<string, number>();
        reorderedPinnedLinks.forEach((link, index) => {
          pinnedOrderMap.set(link.id, index);
        });

        const updatedLinks = links.map(link => {
          if (link.pinned) {
            return {
              ...link,
              pinnedOrder: pinnedOrderMap.get(link.id),
            };
          }
          return link;
        });

        updatedLinks.sort((a, b) => {
          if (a.pinned && b.pinned) {
            return (a.pinnedOrder || 0) - (b.pinnedOrder || 0);
          }
          if (a.pinned) return -1;
          if (b.pinned) return 1;
          const aOrder = a.order !== undefined ? a.order : a.createdAt;
          const bOrder = b.order !== undefined ? b.order : b.createdAt;
          return bOrder - aOrder;
        });

        updateData(updatedLinks, categories);
      }
    }
  }, [categories, links, updateData]);

  const startSorting = useCallback((categoryId: string) => {
    if (!requireAuth()) return;
    setIsSortingMode(categoryId);
  }, [requireAuth]);

  const saveSorting = useCallback(() => {
    updateData(links, categories);
    setIsSortingMode(null);
  }, [categories, links, updateData]);

  const cancelSorting = useCallback(() => {
    setIsSortingMode(null);
  }, []);

  const savePinnedSorting = useCallback(() => {
    updateData(links, categories);
    setIsSortingPinned(false);
  }, [categories, links, updateData]);

  const cancelPinnedSorting = useCallback(() => {
    setIsSortingPinned(false);
  }, []);

  const handleDeleteLink = useCallback((id: string) => {
    if (!authToken) {
      setIsAuthOpen(true);
      return;
    }
    if (confirm('确定删除此链接吗?')) {
      updateData(links.filter(l => l.id !== id), categories);
    }
  }, [authToken, categories, links, setIsAuthOpen, updateData]);

  const togglePin = useCallback((id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!authToken) {
      setIsAuthOpen(true);
      return;
    }

    const linkToToggle = links.find(l => l.id === id);
    if (!linkToToggle) return;

    const updated = links.map(l => {
      if (l.id === id) {
        const isPinned = !l.pinned;
        return {
          ...l,
          pinned: isPinned,
          pinnedOrder: isPinned ? links.filter(link => link.pinned).length : undefined,
        };
      }
      return l;
    });

    updateData(updated, categories);
  }, [authToken, categories, links, setIsAuthOpen, updateData]);

  const togglePinFromLink = useCallback((link: LinkItem) => {
    const updated = links.map(l => {
      if (l.id === link.id) {
        const isPinned = !l.pinned;
        return { ...l, pinned: isPinned, pinnedOrder: isPinned ? links.filter(x => x.pinned).length : undefined };
      }
      return l;
    });
    updateData(updated, categories);
  }, [categories, links, updateData]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  return {
    isSortingMode,
    setIsSortingMode,
    isSortingPinned,
    setIsSortingPinned,
    isBatchEditMode,
    selectedLinks,
    toggleBatchEditMode,
    toggleLinkSelection,
    handleBatchDelete,
    handleBatchMove,
    handleSelectAll,
    handleAddLink,
    handleEditLink,
    handleDragEnd,
    handlePinnedDragEnd,
    startSorting,
    saveSorting,
    cancelSorting,
    savePinnedSorting,
    cancelPinnedSorting,
    sensors,
    handleDeleteLink,
    togglePin,
    togglePinFromLink,
  };
};
