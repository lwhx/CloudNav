import { useEffect, useState } from 'react';

// 返回防抖后的值：输入实时更新，但仅在 delay 毫秒无变化后才透传新值。
// 用于搜索框：输入流畅不卡，过滤重算被节流。
export const useDebouncedValue = <T,>(value: T, delay = 200): T => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
};
