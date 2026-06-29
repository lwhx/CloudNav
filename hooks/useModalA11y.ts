import { useEffect, type RefObject } from 'react';

/**
 * 模态框可访问性增强：焦点陷阱 + Escape 关闭 + 点击遮罩关闭。
 *
 * 用法：
 *   const overlayRef = useRef<HTMLDivElement>(null);
 *   useModalA11y({ isOpen, overlayRef, onClose });
 *   <div ref={overlayRef} ...>
 *
 * - isOpen 为 true 时，焦点锁定在模态内可聚焦元素之间循环。
 * - 按 Escape 关闭（若 onClose 提供）。
 * - 点击遮罩（overlay 自身，非内部 panel）关闭。
 * - 打开时自动聚焦模态；关闭时恢复触发元素的焦点（若可探测）。
 */
interface UseModalA11yOptions {
  isOpen: boolean;
  overlayRef: RefObject<HTMLDivElement | null>;
  onClose?: () => void;
  // 初始聚焦元素选择器，默认聚焦第一个可聚焦元素
  initialFocusSelector?: string;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea',
  'input:not([type="hidden"])',
  'select',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export const useModalA11y = ({ isOpen, overlayRef, onClose, initialFocusSelector }: UseModalA11yOptions) => {
  useEffect(() => {
    if (!isOpen) return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    // 记录触发元素，关闭后恢复焦点
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // 初始聚焦
    const focusInitial = () => {
      const initial = initialFocusSelector
        ? overlay.querySelector<HTMLElement>(initialFocusSelector)
        : null;
      if (initial) {
        initial.focus();
        return;
      }
      const firstFocusable = overlay.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      if (firstFocusable) {
        firstFocusable.focus();
      } else {
        // 无可聚焦元素时，让 overlay 本身可聚焦
        overlay.tabIndex = -1;
        overlay.focus();
      }
    };
    // 延迟一帧等 DOM 渲染
    const rafId = requestAnimationFrame(focusInitial);

    // 焦点陷阱：Tab / Shift+Tab 循环
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (onClose) {
          e.preventDefault();
          onClose();
        }
        return;
      }
      if (e.key !== 'Tab') return;

      const allFocusable = Array.from(overlay.querySelectorAll(FOCUSABLE_SELECTOR)) as HTMLElement[];
      const focusables = allFocusable.filter(el => el.offsetParent !== null || el === document.activeElement);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement;

      if (e.shiftKey) {
        if (active === first || !overlay.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !overlay.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    // 点击遮罩关闭（仅当点击目标是 overlay 自身，非内部 panel）
    const handleOverlayClick = (e: MouseEvent) => {
      if (e.target === overlay && onClose) {
        onClose();
      }
    };

    overlay.addEventListener('keydown', handleKeyDown);
    overlay.addEventListener('mousedown', handleOverlayClick);

    return () => {
      cancelAnimationFrame(rafId);
      overlay.removeEventListener('keydown', handleKeyDown);
      overlay.removeEventListener('mousedown', handleOverlayClick);
      // 恢复焦点
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [isOpen, overlayRef, onClose, initialFocusSelector]);
};
