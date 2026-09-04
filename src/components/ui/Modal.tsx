import React, { useEffect, useId, useRef } from 'react';

interface ModalProps {
  onClose: () => void;
  children: React.ReactNode;
  className?: string; // Optional class for the overlay container if needed
  isDirty?: boolean;
  /**
   * What the dialog is called. A `role="dialog"` with no name is announced as
   * just "dialog", so a screen reader user arriving in one is told they are in
   * something without being told what.
   */
  label?: string;
}

const modalStack: string[] = [];

/**
 * What Tab may move to inside a dialog. `[hidden]` and `aria-hidden` are
 * excluded in the selector itself so the filter beside it only has to deal with
 * hidden *ancestors* — checking visibility any other way (offsetParent, computed
 * style) reports nothing useful under jsdom, where the focus trap is tested.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
]
  .map((selector) => `${selector}:not([hidden]):not([aria-hidden="true"])`)
  .join(', ');

/**
 * The body's inline overflow from before any modal opened, held while the lock
 * is in force.
 *
 * The lock has to be refcounted against `modalStack`, not owned by each modal.
 * Every modal used to capture the current overflow on mount and put it back on
 * unmount, so closing an *outer* dialog while an inner one was still open
 * restored the pre-modal value and unlocked scrolling behind a modal that was
 * still on screen. Locking when the stack fills and restoring only when it
 * empties makes the order the dialogs close in irrelevant.
 */
let overflowBeforeLock: string | null = null;

const lockBodyScroll = () => {
  // Only the first modal locks; the rest are already covered by it.
  if (modalStack.length !== 1) return;
  // The inline value, not the computed one. Writing back a computed 'visible'
  // left an inline style on the body where there had been none.
  overflowBeforeLock = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
};

const unlockBodyScroll = () => {
  if (modalStack.length !== 0) return;
  if (overflowBeforeLock) document.body.style.overflow = overflowBeforeLock;
  else document.body.style.removeProperty('overflow');
  overflowBeforeLock = null;
};

export const Modal: React.FC<ModalProps> = ({ onClose, children, className = '', isDirty = false, label }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  // `useId` rather than a random string written during render: identity is
  // exactly what this hook is for, and generating it in the render body is a
  // side effect that concurrent rendering is free to run more than once.
  const id = useId();

  useEffect(() => {
    // Registration and the scroll lock move together: the lock is a property of
    // the stack being non-empty, so it cannot be decided by a separate effect
    // whose ordering against this one is not guaranteed.
    modalStack.push(id);
    lockBodyScroll();

    return () => {
      const index = modalStack.indexOf(id);
      if (index !== -1) {
        modalStack.splice(index, 1);
      }
      unlockBodyScroll();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Only handle Escape if this modal is at the top of the modal stack
        if (modalStack[modalStack.length - 1] !== id) return;

        if (isDirty) {
          if (window.confirm('You have unsaved changes. Are you sure you want to close?')) {
            onClose();
          }
        } else {
          onClose();
        }
      } else if (e.key === 'Tab') {
        // Focus trap — only for the modal on top, so a stacked dialog does not
        // pull focus back into the one behind it.
        if (!modalRef.current) return;
        if (modalStack[modalStack.length - 1] !== id) return;

        // Hidden elements are excluded, and elements inside a hidden container
        // with them: `.focus()` on something invisible silently does nothing,
        // so a hidden first or last element used to swallow the Tab that should
        // have wrapped and leave the user stuck at the end of the dialog.
        const focusableElements = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => !el.closest('[hidden], [aria-hidden="true"]'));

        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        // Anything not inside this modal is out of bounds, not just the two
        // ends of the list: focus can leave by a click on the page behind, or
        // by the browser restoring it somewhere else, and tabbing from there
        // walked off through the rest of the document.
        const active = document.activeElement;
        const insideModal = active instanceof Node && modalRef.current.contains(active);

        if (!insideModal) {
          e.preventDefault();
          (e.shiftKey ? lastElement : firstElement).focus();
          return;
        }

        if (e.shiftKey) {
          if (active === firstElement || active === modalRef.current) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (active === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, isDirty]);

  useEffect(() => {
    // Remember where focus came from so it can go back on close. Without this a
    // keyboard user lands back at the top of the document every time they
    // dismiss a dialog.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the container rather than the first control, which would otherwise
    // snap to whatever input happens to come first.
    modalRef.current?.focus();

    return () => {
      // Only if the trigger is still in the document and still focusable; a
      // modal opened from a row that the modal itself deleted has nowhere to
      // return to.
      if (previouslyFocused && previouslyFocused.isConnected && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, []);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      if (isDirty) {
        if (window.confirm('You have unsaved changes. Are you sure you want to close?')) {
          onClose();
        }
      } else {
        onClose();
      }
    }
  };

  return (
    <div
      // `items-start` with `my-auto` on the child, not `items-center`: centring a
      // child taller than the scroll container pushes its top above the scrollable
      // area, where nothing can reach it. `my-auto` still centres anything short
      // enough to fit, and collapses when it is not.
      // `overscroll-contain` so reaching the end of a long dialog does not
      // carry on scrolling the page behind it.
      className={`fixed inset-0 bg-ink/50 dark:bg-black/75 backdrop-blur-sm flex items-start justify-center p-4 z-50 overflow-y-auto overscroll-contain ${className}`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="outline-none w-full my-auto flex justify-center"
      >
        {children}
      </div>
    </div>
  );
};
