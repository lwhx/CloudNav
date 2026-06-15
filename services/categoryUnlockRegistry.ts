// 进程内的「已解锁分类」注册表。会话级（不持久化），页面重载后需重新解锁——这是期望行为。
// useCategoryAccess 在解锁时写入，buildAuthHeaders 在发请求时读取并附加 x-unlocked-categories 头，
// 使服务端 GET 能返回这些受锁分类的链接（见 #11 分类锁服务端化）。

const unlockedIds = new Set<string>();

export const registerUnlockedCategory = (categoryId: string) => {
  unlockedIds.add(categoryId);
};

export const clearUnlockedCategory = (categoryId: string) => {
  unlockedIds.delete(categoryId);
};

export const clearAllUnlocked = () => {
  unlockedIds.clear();
};

// 返回逗号分隔的已解锁分类 id，供放入 x-unlocked-categories 请求头。
export const getUnlockedCategoriesHeader = (): string =>
  Array.from(unlockedIds).join(',');
