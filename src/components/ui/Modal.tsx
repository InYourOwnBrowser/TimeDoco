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
        // Focus trap
        if (!modalRef.current) return;

        const focusableElements = modalRef.current.querySelectorAll(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );

        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (e.shiftKey) {
          if (document.activeElement === firstElement || document.activeElement === modalRef.current) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
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
    // Initial focus on the modal
    if (modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length > 0) {
            // We focus the first element, or just the modal itself if we add tabIndex={-1}
            // For now, let's just make the modal container focusable and focus it to avoid snapping to a potentially bad input
            modalRef.current.focus();
        }
    }
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
