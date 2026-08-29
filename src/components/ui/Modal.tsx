import React, { useEffect, useRef } from 'react';

interface ModalProps {
  onClose: () => void;
  children: React.ReactNode;
  className?: string; // Optional class for the overlay container if needed
  isDirty?: boolean;
}

const modalStack: string[] = [];

export const Modal: React.FC<ModalProps> = ({ onClose, children, className = '', isDirty = false }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<string>('');

  if (!idRef.current) {
    idRef.current = Math.random().toString(36).substring(2, 9);
  }

  useEffect(() => {
    modalStack.push(idRef.current);

    return () => {
      const index = modalStack.indexOf(idRef.current);
      if (index !== -1) {
        modalStack.splice(index, 1);
      }
    };
  }, []);

  useEffect(() => {
    // Scroll lock
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Only handle Escape if this modal is at the top of the modal stack
        if (modalStack[modalStack.length - 1] !== idRef.current) return;

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
        if (modalStack[modalStack.length - 1] !== idRef.current) return;

        const focusableElements = modalRef.current.querySelectorAll(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );

        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

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
      className={`fixed inset-0 bg-ink/50 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto ${className}`}
      role="dialog"
      aria-modal="true"
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="outline-none w-full flex justify-center"
      >
        {children}
      </div>
    </div>
  );
};
