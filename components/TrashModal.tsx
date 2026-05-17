import { useState } from 'react';
import { X, RotateCcw, Trash2 } from 'lucide-react';
import { Category, CategoryGroup, DEFAULT_CATEGORY_GROUP_ID, LinkItem } from '../types';
import { TRASH_RETENTION_MS } from '../services/appDataPersistence';

interface TrashModalProps {
  isOpen: boolean;
  onClose: () => void;
  links: LinkItem[];
  categories: Category[];
  categoryGroups: CategoryGroup[];
  onUpdateData: (links: LinkItem[], categories: Category[], categoryGroups?: CategoryGroup[]) => void;
}

const getActiveCategoryId = (categoryId: string, categories: Category[]) => {
  const category = categories.find(item => item.id === categoryId && !item.deletedAt);
  return category ? category.id : 'common';
};

const formatDeletedTime = (deletedAt?: number) => {
  if (!deletedAt) return '未知时间';
  return new Date(deletedAt).toLocaleString('zh-CN');
};

const isExpired = (deletedAt?: number) => typeof deletedAt === 'number' && Date.now() - deletedAt > TRASH_RETENTION_MS;

const TrashModal = ({ isOpen, onClose, links, categories, categoryGroups, onUpdateData }: TrashModalProps) => {
  const [activeTab, setActiveTab] = useState<'links' | 'categories'>('links');

  if (!isOpen) return null;

  const deletedLinks = links.filter(link => link.deletedAt).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  const deletedCategories = categories.filter(category => category.deletedAt).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));

  const restoreLink = (linkId: string) => {
    const nextLinks = links.map(link => {
      if (link.id !== linkId) return link;
      const restoredCategoryId = getActiveCategoryId(link.deletedFromCategoryId || link.categoryId, categories);
      const { deletedAt, deletedFromCategoryId, ...restored } = link;
      return { ...restored, categoryId: restoredCategoryId };
    });
    onUpdateData(nextLinks, categories, categoryGroups);
  };

  const restoreCategory = (categoryId: string) => {
    const activeGroupIds = new Set(categoryGroups.filter(group => !group.deletedAt).map(group => group.id));
    const nextCategories = categories.map(category => {
      if (category.id !== categoryId) return category;
      const { deletedAt, ...restored } = category;
      return {
        ...restored,
        groupId: restored.groupId && activeGroupIds.has(restored.groupId) ? restored.groupId : DEFAULT_CATEGORY_GROUP_ID,
      };
    });
    onUpdateData(links, nextCategories, categoryGroups);
  };

  const permanentlyDeleteLink = (linkId: string) => {
    if (!confirm('确定永久删除这个链接吗？此操作不可恢复。')) return;
    onUpdateData(links.filter(link => link.id !== linkId), categories, categoryGroups);
  };

  const permanentlyDeleteCategory = (categoryId: string) => {
    if (!confirm('确定永久删除这个分类吗？此操作不可恢复。')) return;
    onUpdateData(links, categories.filter(category => category.id !== categoryId), categoryGroups);
  };

  const clearExpired = () => {
    const nextLinks = links.filter(link => !isExpired(link.deletedAt));
    const nextCategories = categories.filter(category => !isExpired(category.deletedAt));
    const nextGroups = categoryGroups.filter(group => !isExpired(group.deletedAt));
    onUpdateData(nextLinks, nextCategories, nextGroups);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
          <div>
            <h3 className="text-lg font-semibold dark:text-white">回收站</h3>
            <p className="mt-1 text-xs text-slate-500">删除的数据会保留 30 天，过期后在保存流程中自动清理。</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700">
            <X className="h-5 w-5 dark:text-slate-400" />
          </button>
        </div>

        <div className="border-b border-slate-200 px-5 pt-4 dark:border-slate-700">
          <div className="flex gap-2">
            <button onClick={() => setActiveTab('links')} className={`rounded-t-lg px-4 py-2 text-sm font-medium ${activeTab === 'links' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'}`}>
              链接 ({deletedLinks.length})
            </button>
            <button onClick={() => setActiveTab('categories')} className={`rounded-t-lg px-4 py-2 text-sm font-medium ${activeTab === 'categories' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'}`}>
              分类 ({deletedCategories.length})
            </button>
            <button onClick={clearExpired} className="ml-auto pb-2 text-xs text-slate-500 hover:text-blue-600">清理已过期项</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'links' && (
            deletedLinks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-700">暂无已删除链接</div>
            ) : (
              <div className="space-y-2">
                {deletedLinks.map(link => (
                  <div key={link.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{link.title}</div>
                      <div className="truncate text-xs text-slate-500">{link.url}</div>
                      <div className="mt-1 text-[11px] text-slate-400">删除时间：{formatDeletedTime(link.deletedAt)}</div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button onClick={() => restoreLink(link.id)} className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300">
                        <RotateCcw size={14} className="mr-1 inline" />恢复
                      </button>
                      <button onClick={() => permanentlyDeleteLink(link.id)} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300">
                        <Trash2 size={14} className="mr-1 inline" />永久删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {activeTab === 'categories' && (
            deletedCategories.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-700">暂无已删除分类</div>
            ) : (
              <div className="space-y-2">
                {deletedCategories.map(category => (
                  <div key={category.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{category.name}</div>
                      <div className="text-xs text-slate-500">恢复后会回到原分组，原分组不存在时回到默认分组。</div>
                      <div className="mt-1 text-[11px] text-slate-400">删除时间：{formatDeletedTime(category.deletedAt)}</div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button onClick={() => restoreCategory(category.id)} className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300">
                        <RotateCcw size={14} className="mr-1 inline" />恢复
                      </button>
                      <button onClick={() => permanentlyDeleteCategory(category.id)} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300">
                        <Trash2 size={14} className="mr-1 inline" />永久删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};

export default TrashModal;
