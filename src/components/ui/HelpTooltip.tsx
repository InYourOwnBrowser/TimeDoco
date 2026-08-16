import React, { useState } from 'react';
import { HelpCircle } from 'lucide-react';

export const HelpTooltip: React.FC<{ text: string }> = ({ text }) => {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex ml-1.5 align-middle">
      <button
        type="button"
        aria-label="Help"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="text-graphite/40 dark:text-stone/40 hover:text-signal focus-visible:ring-2 focus-visible:ring-signal rounded-full"
      >
        <HelpCircle size={14} />
      </button>
      {open && (
        <span role="tooltip" className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 text-xs font-normal leading-snug bg-graphite text-stone dark:bg-stone dark:text-graphite rounded-md px-2.5 py-2 shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
};
