import React from 'react';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
};

export const Button: React.FC<ButtonProps> = ({ variant = 'secondary', size = 'md', className = '', ...props }) => {
  let baseClass = 'inline-flex items-center justify-center font-medium rounded-panel transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';

  if (variant === 'primary') {
    baseClass += ' bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink';
  } else if (variant === 'danger') {
    baseClass += ' bg-red-600 hover:bg-red-700 text-white';
  } else if (variant === 'ghost') {
    baseClass += ' bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300';
  } else {
    // secondary
    baseClass += ' bg-stone border border-graphite/20 hover:bg-gray-100 dark:bg-graphite dark:text-stone dark:border-white/15 dark:hover:bg-gray-800 text-graphite';
  }

  if (size === 'sm') baseClass += ' px-3 py-1.5 text-sm';
  else if (size === 'lg') baseClass += ' px-6 py-3 text-lg';
  else baseClass += ' px-4 py-2 text-sm';

  return <button className={`${baseClass} ${className}`} {...props} />;
};
