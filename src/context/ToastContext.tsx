import React, { createContext, useContext, useState, type ReactNode, useCallback } from 'react';
import { X } from 'lucide-react';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
  action?: ToastAction;
}

interface ToastContextType {
  addToast: (message: string, type?: 'info' | 'success' | 'error', action?: ToastAction) => void;
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

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info', action?: ToastAction) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type, action }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, action ? 5000 : 3000); // Give users more time to click an action
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
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
              <>
                <div className="w-px h-4 bg-white/30 mx-1"></div>
                <button
                  onClick={() => {
                    toast.action!.onClick();
                    removeToast(toast.id);
                  }}
                  className="text-sm font-medium underline underline-offset-2 hover:text-white/90 transition-colors"
                >
                  {toast.action.label}
                </button>
              </>
            )}
            <button
              onClick={() => removeToast(toast.id)}
              className={`${toast.action ? 'ml-2' : 'ml-auto'} text-white/80 hover:text-white transition-colors`}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
