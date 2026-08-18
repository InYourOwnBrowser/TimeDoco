import React, { forwardRef } from 'react';

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className = '', ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={`w-full px-3 py-2 border border-graphite/20 dark:border-white/15 rounded-panel bg-stone dark:bg-ink text-graphite dark:text-stone focus:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 transition-colors ${className}`}
      {...props}
    />
  );
});

Input.displayName = 'Input';
