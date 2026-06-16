import { useEffect } from 'react';

// 全局监听 Escape 键。仅在 active 时挂载监听，弹窗关闭时自动卸载，避免误触发。
// 多弹窗嵌套时，每个弹窗独立监听——按 Esc 会同时关闭所有打开的弹窗（一般可接受；
// 若需"只关最顶层"，可改成只挂在最顶层弹窗）。
export const useEscapeKey = (onEscape: () => void, active: boolean) => {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscape();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onEscape, active]);
};
