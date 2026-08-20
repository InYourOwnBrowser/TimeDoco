import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RefreshCw, Copy } from 'lucide-react';
import { logError, formatErrorLogForClipboard } from '../utils/errorLog';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  copied?: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    copied: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    logError(error, 'render');
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-100 dark:border-gray-700 text-center space-y-4">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={24} />
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Something went wrong</h1>
            <p className="text-gray-600 dark:text-gray-400 text-sm">
              An unexpected error occurred. This is a local-only app, so your data is safe on your device.
            </p>
            {this.state.error && (
              <div className="bg-gray-100 dark:bg-gray-900 rounded p-3 text-left overflow-auto max-h-32 text-xs text-red-800 dark:text-red-300 font-mono">
                {this.state.error.message}
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-2 mt-2">
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink rounded-lg font-medium transition-colors flex-1 justify-center"
              >
                <RefreshCw size={16} />
                Reload Application
              </button>
              <button
                onClick={() => {
                  const logText = formatErrorLogForClipboard();
                  navigator.clipboard.writeText(logText);
                  this.setState({ copied: true });
                  setTimeout(() => this.setState({ copied: false }), 2000);
                }}
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg font-medium transition-colors flex-1 justify-center text-sm"
              >
                <Copy size={16} />
                {this.state.copied ? 'Copied!' : 'Copy error details'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
