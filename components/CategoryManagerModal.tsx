import React, { useState } from 'react';
import { X, ArrowUp, ArrowDown, Trash2, Edit2, Plus, Check, Lock, Palette } from 'lucide-react';
import { Category, CategoryGroup, DEFAULT_CATEGORY_GROUP_ID } from '../types';
import { generateSalt, hashCategoryPassword } from '../services/categoryCrypto';
import Icon from './Icon';
import IconSelector from './IconSelector';
import CategoryActionAuthModal from './CategoryActionAuthModal';

interface CategoryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  categoryGroups: CategoryGroup[];
  onUpdateCategories: (newCategories: Category[], newCategoryGroups?: CategoryGroup[]) => void;
  onDeleteCategory: (id: string) => void;
  onVerifyPassword?: (password: string) => Promise<boolean>;
}

const activeGroupsOf = (categoryGroups: CategoryGroup[]) => categoryGroups.filter(group => !group.deletedAt);

const CategoryManagerModal: React.FC<CategoryManagerModalProps> = ({ 
  isOpen, 
  onClose, 
  categories, 
  categoryGroups,
  onUpdateCategories,
  onDeleteCategory,
  onVerifyPassword
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [editIcon, setEditIcon] = useState('');
  const [editGroupId, setEditGroupId] = useState(DEFAULT_CATEGORY_GROUP_ID);
  const [newCatName, setNewCatName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('Folder');
  const [newCatGroupId, setNewCatGroupId] = useState(DEFAULT_CATEGORY_GROUP_ID);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [isIconSelectorOpen, setIsIconSelectorOpen] = useState(false);
  const [iconSelectorTarget, setIconSelectorTarget] = useState<'edit' | 'new' | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    type: 'edit' | 'delete';
    categoryId: string;
    categoryName: string;
  } | null>(null);

  if (!isOpen) return null;

  const activeCategories = categories.filter(category => !category.deletedAt);
  const activeGroups = activeGroupsOf(categoryGroups);

  const handleMove = (index: number, direction: 'up' | 'down') => {
    const newCats = [...categories];
    if (direction === 'up' && index > 0) {
      [newCats[index], newCats[index - 1]] = [newCats[index - 1], newCats[index]];
    } else if (direction === 'down' && index < newCats.length - 1) {
      [newCats[index], newCats[index + 1]] = [newCats[index + 1], newCats[index]];
    }
    onUpdateCategories(newCats, categoryGroups);
  };

  const handlePasswordVerification = async (password: string): Promise<boolean> => {
    if (!onVerifyPassword) return true;
    try {
      return await onVerifyPassword(password);
    } catch (error) {
      console.error('Password verification error:', error);
      return false;
    }
  };

  const handleStartEdit = (cat: Category) => {
    if (!onVerifyPassword) {
      startEdit(cat);
      return;
    }
    setPendingAction({ type: 'edit', categoryId: cat.id, categoryName: cat.name });
    setIsAuthModalOpen(true);
  };

  const handleDeleteClick = (cat: Category) => {
    if (!onVerifyPassword) {
      if (confirm(`确定删除"${cat.name}"分类吗？该分类下的书签将移动到"常用推荐"，分类本身进入回收站。`)) onDeleteCategory(cat.id);
      return;
    }
    setPendingAction({ type: 'delete', categoryId: cat.id, categoryName: cat.name });
    setIsAuthModalOpen(true);
  };

  const handleAuthSuccess = () => {
    if (!pendingAction) return;
    if (pendingAction.type === 'edit') {
      const cat = categories.find(c => c.id === pendingAction.categoryId);
      if (cat) startEdit(cat);
    } else if (pendingAction.type === 'delete') {
      const cat = categories.find(c => c.id === pendingAction.categoryId);
      if (cat && confirm(`确定删除"${cat.name}"分类吗？该分类下的书签将移动到"常用推荐"，分类本身进入回收站。`)) onDeleteCategory(cat.id);
    }
    setPendingAction(null);
  };

  const handleAuthModalClose = () => {
    setIsAuthModalOpen(false);
    setPendingAction(null);
  };

  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditPassword(''); // 不回显哈希；留空表示不改密码
    setPasswordTouched(false);
    setEditIcon(cat.icon);
    setEditGroupId(cat.groupId || DEFAULT_CATEGORY_GROUP_ID);
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    const editing = categories.find(c => c.id === editingId);
    // 仅当用户在本会话改过密码字段时才更新；否则沿用已存哈希与盐（留空 = 不改）。
    let nextPassword: string | undefined;
    let nextSalt: string | undefined;
    if (passwordTouched) {
      const trimmed = editPassword.trim();
      if (trimmed) {
        // 新明文：生成新盐并哈希，明文不入库。
        nextSalt = generateSalt();
        nextPassword = await hashCategoryPassword(trimmed, nextSalt);
      }
      // touched 且为空 -> 显式清除密码。
    } else if (editing) {
      nextPassword = editing.password;
      nextSalt = editing.passwordSalt;
    }
    const newCats = categories.map(c => c.id === editingId ? {
      ...c,
      name: editName.trim(),
      icon: editIcon,
      groupId: editGroupId,
      password: nextPassword,
      passwordSalt: nextSalt,
    } : c);
    onUpdateCategories(newCats, categoryGroups);
    setEditingId(null);
  };

  const handleAdd = () => {
    if (!newCatName.trim()) return;
    const newCat: Category = {
      id: Date.now().toString(),
      name: newCatName.trim(),
      icon: newCatIcon,
      groupId: newCatGroupId,
    };
    onUpdateCategories([...categories, newCat], categoryGroups);
    setNewCatName('');
    setNewCatIcon('Folder');
    setNewCatGroupId(DEFAULT_CATEGORY_GROUP_ID);
  };

  const handleAddGroup = () => {
    if (!newGroupName.trim()) return;
    const nextGroups = [...categoryGroups, { id: Date.now().toString(), name: newGroupName.trim(), icon: 'Folder', order: categoryGroups.length }];
    onUpdateCategories(categories, nextGroups);
    setNewGroupName('');
  };

  const handleSaveGroup = (groupId: string) => {
    if (!editGroupName.trim()) return;
    onUpdateCategories(categories, categoryGroups.map(group => group.id === groupId ? { ...group, name: editGroupName.trim() } : group));
    setEditingGroupId(null);
    setEditGroupName('');
  };

  const handleDeleteGroup = (groupId: string) => {
    if (groupId === DEFAULT_CATEGORY_GROUP_ID) return;
    if (!confirm('确定删除该分组吗？分组下的分类会移动到默认分组。')) return;
    const nextGroups = categoryGroups.map(group => group.id === groupId ? { ...group, deletedAt: Date.now() } : group);
    const nextCategories = categories.map(category => category.groupId === groupId ? { ...category, groupId: DEFAULT_CATEGORY_GROUP_ID } : category);
    onUpdateCategories(nextCategories, nextGroups);
  };

  const openIconSelector = (target: 'edit' | 'new') => {
    setIconSelectorTarget(target);
    setIsIconSelectorOpen(true);
  };
  
  const handleIconSelect = (iconName: string) => {
    if (iconSelectorTarget === 'edit') setEditIcon(iconName);
    if (iconSelectorTarget === 'new') setNewCatIcon(iconName);
  };
  
  const cancelIconSelector = () => {
    setIsIconSelectorOpen(false);
    setIconSelectorTarget(null);
  };
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-700 flex flex-col max-h-[88vh]">
        <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold dark:text-white">分类管理</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
            <X className="w-5 h-5 dark:text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">分组管理</h4>
              <span className="text-xs text-slate-400">默认分组不可删除</span>
            </div>
            <div className="space-y-2">
              {activeGroups.map(group => (
                <div key={group.id} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-700/50">
                  <Icon name={group.icon || 'Folder'} size={16} />
                  {editingGroupId === group.id ? (
                    <input value={editGroupName} onChange={(event) => setEditGroupName(event.target.value)} className="flex-1 rounded border border-blue-500 px-2 py-1 text-sm dark:bg-slate-800 dark:text-white" />
                  ) : (
                    <span className="flex-1 text-sm font-medium dark:text-slate-200">{group.name}</span>
                  )}
                  {editingGroupId === group.id ? (
                    <button onClick={() => handleSaveGroup(group.id)} className="rounded p-1.5 text-green-500 hover:bg-green-50 dark:hover:bg-slate-600"><Check size={15} /></button>
                  ) : (
                    <button onClick={() => { setEditingGroupId(group.id); setEditGroupName(group.name); }} className="rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-blue-500 dark:hover:bg-slate-600"><Edit2 size={14} /></button>
                  )}
                  {group.id !== DEFAULT_CATEGORY_GROUP_ID && (
                    <button onClick={() => handleDeleteGroup(group.id)} className="rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-red-500 dark:hover:bg-slate-600"><Trash2 size={14} /></button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="新分组名称" className="flex-1 rounded-lg border border-slate-300 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white" />
              <button onClick={handleAddGroup} disabled={!newGroupName.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:opacity-50"><Plus size={18} /></button>
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">分类列表</h4>
            <div className="space-y-2">
              {activeCategories.map((cat, index) => (
                <div key={cat.id} className="flex flex-col p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg group gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col gap-1 mr-2">
                      <button onClick={() => handleMove(index, 'up')} disabled={index === 0} className="p-0.5 text-slate-400 hover:text-blue-500 disabled:opacity-30"><ArrowUp size={14} /></button>
                      <button onClick={() => handleMove(index, 'down')} disabled={index === activeCategories.length - 1} className="p-0.5 text-slate-400 hover:text-blue-500 disabled:opacity-30"><ArrowDown size={14} /></button>
                    </div>

                    <div className="flex-1">
                      {editingId === cat.id && cat.id !== 'common' ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <Icon name={editIcon} size={16} />
                            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1 p-1.5 px-2 text-sm rounded border border-blue-500 dark:bg-slate-800 dark:text-white outline-none" placeholder="分类名称" autoFocus />
                            <button type="button" className="p-1 text-slate-400 hover:text-blue-600 transition-colors" onClick={() => openIconSelector('edit')} title="选择图标"><Palette size={16} /></button>
                          </div>
                          <select value={editGroupId} onChange={(event) => setEditGroupId(event.target.value)} className="rounded border border-blue-500 p-1.5 text-sm dark:bg-slate-800 dark:text-white">
                            {activeGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
                          </select>
                          <div className="flex items-center gap-2">
                            <Lock size={14} className="text-slate-400" />
                            <input type="password" value={editPassword} onChange={(e) => { setEditPassword(e.target.value); setPasswordTouched(true); }} className="flex-1 p-1.5 px-2 text-sm rounded border border-blue-500 dark:bg-slate-800 dark:text-white outline-none" placeholder="密码（可选，留空表示不修改）" />
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Icon name={cat.icon} size={16} />
                          <span className="font-medium dark:text-slate-200 truncate">{cat.name}{cat.id === 'common' && <span className="ml-2 text-xs text-slate-400">(默认分类，不可编辑)</span>}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">{activeGroups.find(group => group.id === (cat.groupId || DEFAULT_CATEGORY_GROUP_ID))?.name || '默认分组'}</span>
                          {cat.password && <Lock size={12} className="text-slate-400" />}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1 self-start mt-1">
                      {editingId === cat.id ? (
                        <button onClick={saveEdit} className="text-green-500 hover:bg-green-50 dark:hover:bg-slate-600 p-1.5 rounded bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-600"><Check size={16}/></button>
                      ) : (
                        <>
                          {cat.id !== 'common' && <button onClick={() => handleStartEdit(cat)} className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-slate-200 dark:hover:bg-slate-600 rounded"><Edit2 size={14} /></button>}
                          {cat.id !== 'common' && <button onClick={() => handleDeleteClick(cat)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-slate-200 dark:hover:bg-slate-600 rounded"><Trash2 size={14} /></button>}
                          {cat.id === 'common' && <div className="p-1.5 text-slate-300" title="常用推荐分类不能被删除"><Lock size={14} /></div>}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">添加新分类</label>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Icon name={newCatIcon} size={16} />
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                placeholder="分类名称"
                className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <button type="button" className="p-1 text-gray-500 hover:text-blue-600 transition-colors" onClick={() => openIconSelector('new')} title="选择图标"><Palette size={16} /></button>
            </div>
            <select value={newCatGroupId} onChange={(event) => setNewCatGroupId(event.target.value)} className="rounded-lg border border-slate-300 p-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-white">
              {activeGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
            <div className="flex justify-end">
              <button onClick={handleAdd} disabled={!newCatName.trim()} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors flex items-center"><Plus size={18} /></button>
            </div>
          </div>
          {isIconSelectorOpen && (
            <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
                  <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">选择图标</h3>
                  <button type="button" onClick={cancelIconSelector} className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"><X size={20} /></button>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  <IconSelector onSelectIcon={(iconName) => { handleIconSelect(iconName); setIsIconSelectorOpen(false); setIconSelectorTarget(null); }} />
                </div>
              </div>
            </div>
          )}
          {isAuthModalOpen && pendingAction && (
            <CategoryActionAuthModal isOpen={isAuthModalOpen} onClose={handleAuthModalClose} onVerify={handlePasswordVerification} onVerified={handleAuthSuccess} actionType={pendingAction.type} categoryName={pendingAction.categoryName} />
          )}
        </div>
      </div>
    </div>
  );
};

export default CategoryManagerModal;
