// 会话级分类解锁令牌注册表。令牌由服务端验证分类密码后签发，页面重载后失效。

const tokensByCategory = new Map<string, string>();

export const registerUnlockedCategory = (categoryId: string, token: string) => {
  tokensByCategory.set(categoryId, token);
};

export const clearUnlockedCategory = (categoryId: string) => {
  tokensByCategory.delete(categoryId);
};

export const clearAllUnlocked = () => {
  tokensByCategory.clear();
};

export const getCategoryUnlockTokensHeader = (): string => Array.from(tokensByCategory.values()).join(',');
