import React from 'react';
import { DndContext, closestCorners, type DragEndEvent, type useSensors } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { Category, LinkItem, SiteSettings } from '../../types';
import Icon from '../Icon';
import SortableLinkCard from '../links/SortableLinkCard';

interface CategorySectionProps {
  category: Category;
  links: LinkItem[];
  locked: boolean;
  collapsed: boolean;
  expanded: boolean;
  managementMode: boolean;
  sorting: boolean;
  siteSettings: SiteSettings;
  sensors: ReturnType<typeof useSensors>;
  renderLink: (link: LinkItem) => React.ReactNode;
  onUnlock: () => void;
  onToggleCollapse: () => void;
  onToggleExpanded: () => void;
  onAdd: () => void;
  onStartSorting: () => void;
  onSaveSorting: () => void;
  onCancelSorting: () => void;
  onDragEnd: (event: DragEndEvent) => void;
}

const INITIAL_VISIBLE = 10;

const CategorySection = ({ category, links, locked, collapsed, expanded, managementMode, sorting, siteSettings, sensors, renderLink, onUnlock, onToggleCollapse, onToggleExpanded, onAdd, onStartSorting, onSaveSorting, onCancelSorting, onDragEnd }: CategorySectionProps) => {
  const visibleLinks = expanded ? links : links.slice(0, INITIAL_VISIBLE);
  const gridClass = siteSettings.cardStyle === 'detailed'
    ? 'grid-cols-1 xs:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 min-[1680px]:grid-cols-5'
    : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4 min-[1680px]:grid-cols-5';

  return (
    <section id={`category-${category.id}`} data-category-section={category.id} className="min-w-0 max-w-full border-b border-slate-200 pb-6 last:border-b-0 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={onToggleCollapse} className="flex min-w-0 items-center gap-3 text-left">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300"><Icon name={category.icon || 'Folder'} size={18} /></span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white"><span className="truncate">{category.name}</span>{locked && <Icon name="Lock" size={14} className="text-amber-500" />}</span>
            <span className="text-xs text-slate-400">{locked ? '需要解锁后查看' : `${links.length} 个链接`}</span>
          </span>
          <Icon name={collapsed ? 'ChevronRight' : 'ChevronDown'} size={16} className="text-slate-400" />
        </button>

        {managementMode && !locked && (
          <div className="flex items-center gap-2">
            {sorting ? <><button onClick={onSaveSorting} className="rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700">保存排序</button><button onClick={onCancelSorting} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200">取消</button></> : <><button onClick={onStartSorting} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">排序</button><button onClick={onAdd} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">添加链接</button></>}
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="mt-4">
          {locked ? (
            <button onClick={onUnlock} className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-amber-300 bg-amber-50/60 px-4 py-10 text-amber-700 dark:border-amber-800 dark:bg-amber-900/10 dark:text-amber-300"><Icon name="Lock" size={24} /><span className="mt-2 text-sm font-semibold">点击解锁这个分类</span></button>
          ) : links.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 px-4 py-10 text-slate-400 dark:border-slate-700"><Icon name="Bookmark" size={24} /><span className="mt-2 text-sm">这个分类还没有链接</span></div>
          ) : sorting ? (
            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
              <SortableContext items={links.map(link => link.id)} strategy={rectSortingStrategy}>
                <div className={`grid gap-3 ${gridClass}`}>{links.map(link => React.createElement(SortableLinkCard, { key: link.id, link, siteSettings, isSortingMode: true, isSortingPinned: false }))}</div>
              </SortableContext>
            </DndContext>
          ) : <div className={`grid min-w-0 gap-2.5 ${gridClass}`}>{visibleLinks.map(renderLink)}</div>}

          {!locked && !sorting && links.length > INITIAL_VISIBLE && <button onClick={onToggleExpanded} className="mx-auto mt-4 flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700">{expanded ? '收起' : `显示更多（${links.length - INITIAL_VISIBLE}）`}<Icon name={expanded ? 'ChevronUp' : 'ChevronDown'} size={14} /></button>}
        </div>
      )}
    </section>
  );
};

export default CategorySection;
