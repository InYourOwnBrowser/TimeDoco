import React, { createContext, useContext, useState, useEffect, type ReactNode, useCallback } from 'react';
import { X } from 'lucide-react';

interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
  action?: {
    label: string;
    onClick: () => void;
  };
  duration: number;
}

interface ToastContextType {
  addToast: (message: string, type?: 'info' | 'success' | 'error', action?: { label: string, onClick: () => void }, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

const ToastItem: React.FC<{ toast: Toast, onRemove: (id: string) => void }> = ({ toast, onRemove }) => {
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (isHovered) return;

    const timer = setTimeout(() => {
      onRemove(toast.id);
    }, toast.duration);

    return () => clearTimeout(timer);
  }, [toast, isHovered, onRemove]);

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-in slide-in-from-top-5 text-white ${
        toast.type === 'success'
          ? 'bg-green-600'
          : toast.type === 'error'
          ? 'bg-red-600'
          : 'bg-blue-600'
      }`}
    >
      <span className="text-sm font-medium">{toast.message}</span>
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.onClick();
            onRemove(toast.id);
          }}
          className="text-sm font-semibold underline hover:text-white/90 ml-2"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={() => onRemove(toast.id)}
        className="ml-auto text-white/80 hover:text-white transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );
};

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info', action?: { label: string, onClick: () => void }, duration: number = 3000) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type, action, duration }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div
        // Above every other layer: a toast reports what just happened, and
        // several of them are raised from inside a dialog.
        className="fixed top-4 right-4 z-[80] flex flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};
