import React from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { ToastItem } from '../hooks/useToast';

interface ToastContainerProps {
  toasts: ToastItem[];
  onRemove: (id: number) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onRemove }) => {
  return (
    <div className="fixed right-4 top-4 z-[130] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2 sm:right-6 sm:top-6">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-xl backdrop-blur-md transition-all ${
            toast.type === 'success'
              ? 'border-green-200 bg-green-50/95 text-green-700 dark:border-green-800 dark:bg-green-950/90 dark:text-green-300'
              : toast.type === 'error'
                ? 'border-red-200 bg-red-50/95 text-red-700 dark:border-red-800 dark:bg-red-950/90 dark:text-red-300'
                : toast.type === 'warning'
                  ? 'border-amber-200 bg-amber-50/95 text-amber-700 dark:border-amber-800 dark:bg-amber-950/90 dark:text-amber-300'
                  : 'border-blue-200 bg-blue-50/95 text-blue-700 dark:border-blue-800 dark:bg-blue-950/90 dark:text-blue-300'
          }`}
        >
          {toast.type === 'success' && <CheckCircle2 className="h-4 w-4 shrink-0" />}
          {toast.type === 'error' && <AlertCircle className="h-4 w-4 shrink-0" />}
          {toast.type === 'warning' && <AlertCircle className="h-4 w-4 shrink-0" />}
          {toast.type === 'info' && <Info className="h-4 w-4 shrink-0" />}
          <span className="leading-5">{toast.message}</span>
          <button
            onClick={() => onRemove(toast.id)}
            className="ml-auto rounded-full p-1 opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
            aria-label="关闭通知"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};

export default ToastContainer;
