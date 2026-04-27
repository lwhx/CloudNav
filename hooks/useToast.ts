import { useCallback, useState } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

export type NotifyHandler = (message: string, type?: ToastType) => void;

export const useToast = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const showToast = useCallback<NotifyHandler>((message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      removeToast(id);
    }, 3000);
  }, [removeToast]);

  return {
    toasts,
    showToast,
    removeToast,
  };
};
