import React, { useState } from 'react';
import { Check, X, Eye, RotateCcw } from 'lucide-react';
import { LinkItem, Category } from '../types';

// 单条链接的变更项。before/after 为该字段的旧值与新值。
export interface OrganizeChange {
  linkId: string;
  title: string;
  description?: { before: string; after: string };
  categoryName?: { before: string; after: string };
  tags?: { before: string[]; after: string[] };
}

interface OrganizePreviewModalProps {
  changes: OrganizeChange[];
  onApply: (selectedLinkIds: string[]) => void;
  onCancel: () => void;
}

const FieldChange = ({ label, before, after }: { label: string; before: string; after: string }) => (
  <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
    <span className="text-slate-400 dark:text-slate-500">{label}:</span>
    <span className="text-slate-500 line-through decoration-red-400/60 dark:text-slate-500">{before || '（空）'}</span>
    <span className="text-slate-400">→</span>
    <span className="font-medium text-emerald-600 dark:text-emerald-400">{after || '（空）'}</span>
  </div>
);

const OrganizePreviewModal: React.FC<OrganizePreviewModalProps> = ({ changes, onApply, onCancel }) => {
  const [selected, setSelected] = useState<Set<string>>(new Set(changes.map(c => c.linkId)));

  const toggle = (linkId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(linkId)) next.delete(linkId);
      else next.add(linkId);
      return next;
    });
  };

  const allSelected = selected.size === changes.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(changes.map(c => c.linkId)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 p-5 dark:border-slate-700">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
            <Eye size={20} className="text-purple-500" /> 整理结果预览
          </h3>
          <button onClick={onCancel} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700">
            <X size={20} />
          </button>
        </div>

        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
            全选 / 反选
          </label>
          <span>共 {changes.length} 条变更，已选 {selected.size} 条</span>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {changes.length === 0 ? (
            <p className="py-8 text-center text-slate-400">没有可应用的变更</p>
          ) : (
            changes.map(change => {
              const checked = selected.has(change.linkId);
              return (
                <div
                  key={change.linkId}
                  className={`rounded-xl border p-3 transition-colors ${
                    checked
                      ? 'border-purple-300 bg-purple-50/50 dark:border-purple-700 dark:bg-purple-900/10'
                      : 'border-slate-200 opacity-60 dark:border-slate-700'
                  }`}
                >
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(change.linkId)}
                      className="mt-1 rounded"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{change.title}</div>
                      {change.description && <FieldChange label="描述" before={change.description.before} after={change.description.after} />}
                      {change.categoryName && <FieldChange label="分类" before={change.categoryName.before} after={change.categoryName.after} />}
                      {change.tags && (
                        <FieldChange
                          label="标签"
                          before={change.tags.before.join('、')}
                          after={change.tags.after.join('、')}
                        />
                      )}
                    </div>
                  </label>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 p-4 dark:border-slate-700">
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <RotateCcw size={16} /> 全部丢弃
          </button>
          <button
            onClick={() => onApply(Array.from(selected))}
            disabled={selected.size === 0}
            className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check size={16} /> 应用选中的 {selected.size} 条
          </button>
        </div>
      </div>
    </div>
  );
};

export default OrganizePreviewModal;

// 辅助：把 patchMap 转成可预览的变更列表。
export const buildOrganizeChanges = (
  links: LinkItem[],
  categories: Category[],
  patchMap: Map<string, {
    description?: string;
    categoryId?: string;
    tags?: string[];
  }>,
  options: { description: boolean; category: boolean; tags: boolean }
): OrganizeChange[] => {
  const activeCategories = categories.filter(c => !c.deletedAt);
  const catName = (id?: string) => activeCategories.find(c => c.id === id)?.name || '';
  const changes: OrganizeChange[] = [];

  for (const link of links) {
    const result = patchMap.get(link.id);
    if (!result) continue;

    const descChanged = options.description && result.description && result.description !== link.description;
    const catChanged = options.category && result.categoryId
      && activeCategories.some(c => c.id === result.categoryId)
      && result.categoryId !== link.categoryId;
    const mergedTags = options.tags && result.tags?.length
      ? Array.from(new Set([...(link.tags || []), ...result.tags]))
      : (link.tags || []);
    const tagsChanged = options.tags && result.tags?.length && mergedTags.join('、') !== (link.tags || []).join('、');

    if (!descChanged && !catChanged && !tagsChanged) continue;

    changes.push({
      linkId: link.id,
      title: link.title,
      description: descChanged ? { before: link.description || '', after: result.description! } : undefined,
      categoryName: catChanged ? { before: catName(link.categoryId), after: catName(result.categoryId) } : undefined,
      tags: tagsChanged ? { before: link.tags || [], after: mergedTags } : undefined,
    });
  }

  return changes;
};
