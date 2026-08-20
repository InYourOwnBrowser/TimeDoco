import React from 'react';

const BASE = import.meta.env.BASE_URL ? import.meta.env.BASE_URL.replace(/\/$/, '') : '';

export const BlogLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="min-h-screen bg-stone dark:bg-ink text-gray-900 dark:text-gray-100 font-sans antialiased flex flex-col justify-between">
      <div>
        <header className="border-b border-graphite/10 dark:border-white/10 bg-stone dark:bg-ink sticky top-0 z-50">
          <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
            <a href={`${BASE}/`} className="flex items-center gap-2 text-xl font-bold tracking-tight text-graphite dark:text-stone">
              <svg className="h-8 w-8" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="10" y="10" width="80" height="80" rx="20" className="fill-graphite dark:fill-stone" />
                <circle cx="50" cy="50" r="28" className="stroke-stone dark:stroke-graphite" strokeWidth="8" />
                <path d="M50 30V50L64 57" className="stroke-signal" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Time<span className="text-signal">Doco</span></span>
            </a>
            <nav className="flex items-center gap-6 text-sm font-medium">
              <a href={`${BASE}/faq/`} className="text-gray-600 dark:text-gray-300 hover:text-signal transition-colors">FAQ</a>
              <a href={`${BASE}/blog/`} className="text-signal font-semibold">Blog</a>
              <a href={`${BASE}/app/`} className="px-4 py-2 rounded-panel bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink font-semibold transition-colors shadow-sm">
                Launch App
              </a>
            </nav>
          </div>
        </header>

        <main>{children}</main>
      </div>

      <footer className="border-t border-graphite/10 dark:border-white/10 py-8 text-center text-xs text-gray-500 dark:text-gray-400">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>&copy; TimeDoco &mdash; Privacy-First Time Tracker.</div>
          <div className="flex items-center gap-6">
            <a href="https://x.com/_InYOB_" target="_blank" rel="noopener noreferrer" aria-label="Follow on X" className="text-gray-500 transition-colors hover:text-gray-900 dark:hover:text-white">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <a href="https://discord.gg/p6XhpaDm4R" target="_blank" rel="noopener noreferrer" aria-label="Join Discord" className="text-gray-500 transition-colors hover:text-[#5865F2]">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.118.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
            </a>
            <a href="https://medium.com/@InYourOwnBrowser" target="_blank" rel="noopener noreferrer" aria-label="Read on Medium" className="text-gray-500 transition-colors hover:text-gray-900 dark:hover:text-white">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M13.54 12a6.8 6.8 0 01-6.77 6.82A6.8 6.8 0 010 12a6.8 6.8 0 016.77-6.82A6.8 6.8 0 0113.54 12zM20.96 12c0 3.54-1.51 6.42-3.38 6.42-1.87 0-3.39-2.88-3.39-6.42s1.52-6.42 3.39-6.42 3.38 2.88 3.38 6.42M24 12c0 3.17-.53 5.75-1.19 5.75-.66 0-1.19-2.58-1.19-5.75s.53-5.75 1.19-5.75C23.47 6.25 24 8.83 24 12z" />
              </svg>
            </a>
            <a href="https://github.com/InYourOwnBrowser" target="_blank" rel="noopener noreferrer" aria-label="View on GitHub" className="text-gray-500 transition-colors hover:text-gray-900 dark:hover:text-white">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
            </a>
          </div>
          <div className="flex items-center gap-4">
            <a href={`${BASE}/app/`} className="hover:underline">App</a>
            <a href={`${BASE}/faq/`} className="hover:underline">FAQ</a>
            <a href={`${BASE}/blog/`} className="hover:underline">Blog</a>
            <a href={`${BASE}/privacy/`} className="hover:underline">Privacy</a>
            <a href={`${BASE}/terms/`} className="hover:underline">Terms</a>
            <a href="https://github.com/InYourOwnBrowser" target="_blank" rel="noopener noreferrer" className="hover:underline">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
};
