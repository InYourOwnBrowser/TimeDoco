import React, { useId, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { AnchoredLayer } from './AnchoredLayer';

export const HelpTooltip: React.FC<{ text: string }> = ({ text }) => {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  return (
    <span className="relative inline-flex ml-1.5 align-middle">
      <button
        ref={anchorRef}
        type="button"
        aria-label="Help"
        // Named rather than merely adjacent: the tip is a sibling in the markup
        // and, now that it is drawn outside the page, not even that.
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="text-graphite/40 dark:text-stone/40 hover:text-signal-dim dark:hover:text-signal focus-visible:ring-2 focus-visible:ring-signal rounded-full"
      >
        <HelpCircle size={14} />
      </button>
      {open && (
        // A layer, not a positioned sibling: these sit inside a scrolling
        // settings panel, where a tip above a control near the top of the panel
        // was cut off by the panel, and a wide one beside a control near the
        // edge ran off the side of the dialog.
        <AnchoredLayer
          anchorRef={anchorRef}
          align="start"
          withBackdrop={false}
          id={id}
          role="tooltip"
          className="w-56 text-xs font-normal leading-snug bg-graphite text-stone dark:bg-stone dark:text-graphite rounded-md px-2.5 py-2 shadow-lg"
        >
          {text}
        </AnchoredLayer>
      )}
    </span>
  );
};
