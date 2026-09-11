import React, { useCallback, useRef } from 'react';
import { MoreVertical } from 'lucide-react';
import { AnchoredLayer } from './AnchoredLayer';

interface ActionMenuProps {
  /** Names the button and the menu it opens. */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  iconSize?: number;
  buttonClassName?: string;
  /** Wraps the trigger; carries the responsive visibility of the whole control. */
  wrapperClassName?: string;
  children: React.ReactNode;
}

/**
 * The "⋮" overflow menu, for the actions that do not fit on a narrow screen.
 *
 * The menu is a layer rather than a positioned child because these buttons sit
 * inside cards that hide their overflow: dropped below the trigger, the menu
 * was cut off at the card's edge, and on a collapsed card — where there is no
 * card below the trigger to drop into — it could not be seen at all.
 */
export const ActionMenu: React.FC<ActionMenuProps> = ({
  label,
  open,
  onOpenChange,
  iconSize = 18,
  buttonClassName = '',
  wrapperClassName = '',
  children,
}) => {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  return (
    <div className={wrapperClassName}>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={buttonClassName}
      >
        <MoreVertical size={iconSize} />
      </button>
      {open && (
        <AnchoredLayer
          anchorRef={anchorRef}
          onDismiss={close}
          align="end"
          role="menu"
          aria-label={label}
          className="w-36 bg-white dark:bg-graphite border border-graphite/20 dark:border-white/20 rounded-md shadow-lg p-1 flex flex-col gap-0.5 text-xs"
          // Any item closes the menu, so no action has to remember to. Several
          // did not, which left the menu sitting over the row it had just put
          // into edit mode.
          onClick={close}
        >
          {children}
        </AnchoredLayer>
      )}
    </div>
  );
};
