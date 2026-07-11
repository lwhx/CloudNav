import type React from 'react';
import { useEffect, useState } from 'react';
import { Category, CategoryGroup } from '../../types';
import Icon from '../Icon';

export interface NavigationGroup extends CategoryGroup {
  categoryCount: number;
  linkCount: number;
  categories: Category[];
}

interface GroupSidebarProps {
  groups: NavigationGroup[];
  activeGroupId: string;
  activeCategoryId: string;
  navTitle: string;
  open: boolean;
  onClose: () => void;
  onSelect: (groupId: string) => void;
  onSelectCategory: (categoryId: string) => void;
  onManageGroups: () => void;
  footer: React.ReactNode;
}

const GroupSidebar = ({ groups, activeGroupId, activeCategoryId, navTitle, open, onClose, onSelect, onSelectCategory, onManageGroups, footer }: GroupSidebarProps) => {
  const [expandedGroupId, setExpandedGroupId] = useState(activeGroupId);

  useEffect(() => {
    setExpandedGroupId(activeGroupId);
  }, [activeGroupId]);

  const handleGroupClick = (groupId: string) => {
    if (groupId === activeGroupId) {
      setExpandedGroupId(current => current === groupId ? '' : groupId);
      return;
    }
    setExpandedGroupId(groupId);
    onSelect(groupId);
  };

  return (
  <aside className={`fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-slate-200 bg-slate-100/95 shadow-xl backdrop-blur transition-transform duration-300 dark:border-slate-700 dark:bg-slate-950/95 lg:static lg:z-auto lg:w-64 lg:translate-x-0 lg:shadow-none ${open ? 'translate-x-0' : '-translate-x-full'}`} aria-label="一级分组导航">
    <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5 dark:border-slate-700">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-500/20"><Icon name="Compass" size={20} /></div>
        <span className="truncate text-lg font-bold text-slate-900 dark:text-white">{navTitle || 'CloudNav'}</span>
      </div>
      <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-white dark:hover:bg-slate-800 lg:hidden" aria-label="关闭导航"><Icon name="X" size={20} /></button>
    </div>
    <div className="px-3 pt-3">
      <button onClick={onManageGroups} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-blue-300 bg-blue-50/70 px-3 py-2 text-xs font-semibold text-blue-600 transition-colors hover:border-blue-400 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-900/40">
        <Icon name="Plus" size={15} />添加或管理一级分类
      </button>
    </div>
    <nav className="scrollbar-hide flex-1 space-y-1 overflow-y-auto px-3 py-3">
      {groups.map(group => {
        const active = group.id === activeGroupId;
        const expanded = group.id === expandedGroupId;
        return (
          <div key={group.id} className="space-y-1">
            <button onClick={() => handleGroupClick(group.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all ${active ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'}`} aria-current={active ? 'page' : undefined} aria-expanded={expanded}>
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-white/15' : 'bg-white dark:bg-slate-800'}`}><Icon name={group.icon || 'Folder'} size={18} /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{group.name}</span><span className={`mt-0.5 block text-xs ${active ? 'text-blue-100' : 'text-slate-400'}`}>{group.categoryCount} 个分类 · {group.linkCount} 个链接</span></span>
              <Icon name={expanded ? 'ChevronDown' : 'ChevronRight'} size={15} className={active ? 'text-blue-100' : 'text-slate-300'} />
            </button>
            {expanded && group.categories.length > 0 && (
              <div className="ml-5 space-y-0.5 border-l border-slate-200 py-1 pl-3 dark:border-slate-700">
                {group.categories.map(category => {
                  const categoryActive = category.id === activeCategoryId;
                  return <button key={category.id} onClick={() => onSelectCategory(category.id)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${categoryActive ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300' : 'text-slate-500 hover:bg-white hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-800'}`} aria-current={categoryActive ? 'location' : undefined}><Icon name={category.icon || 'Folder'} size={14} /><span className="truncate">{category.name}</span></button>;
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
    <div className="border-t border-slate-200 p-3 dark:border-slate-700">{footer}</div>
  </aside>
  );
};

export default GroupSidebar;
