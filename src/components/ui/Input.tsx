import React, { forwardRef } from 'react';

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className = '', ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={`w-full px-3 py-2 border border-graphite/10 dark:border-white/10 rounded-md bg-stone dark:bg-graphite text-graphite dark:text-stone focus:outline-none focus:ring-2 focus:ring-signal ${className}`}
      {...props}
    />
  );
});

Input.displayName = 'Input';
