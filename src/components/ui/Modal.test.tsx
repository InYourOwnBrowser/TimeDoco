import { render, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Modal } from './Modal';

describe('Modal stack escape handling', () => {
  it('closes only the top-most modal when Escape key is pressed', () => {
    const handleCloseModal1 = vi.fn();
    const handleCloseModal2 = vi.fn();

    const { rerender } = render(
      <Modal onClose={handleCloseModal1}>
        <div>First Modal</div>
      </Modal>
    );

    rerender(
      <>
        <Modal onClose={handleCloseModal1}>
          <div>First Modal</div>
        </Modal>
        <Modal onClose={handleCloseModal2}>
          <div>Second Modal</div>
        </Modal>
      </>
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(handleCloseModal2).toHaveBeenCalledTimes(1);
    expect(handleCloseModal1).not.toHaveBeenCalled();
  });

  it('returns focus to whatever opened it', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(
      <Modal onClose={vi.fn()}>
        <button>Inside</button>
      </Modal>
    );
    expect(document.activeElement).not.toBe(trigger);

    // Closing a dialog used to drop focus at the top of the document, which
    // leaves a keyboard user tabbing back through the whole page.
    unmount();
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it('pulls focus back in when Tab is pressed from outside the modal', () => {
    const outside = document.createElement('button');
    outside.textContent = 'Outside';
    document.body.appendChild(outside);

    const { getByText } = render(
      <Modal onClose={vi.fn()}>
        <button>Inside</button>
      </Modal>
    );

    outside.focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    // The trap only recognised the first and last elements before, so focus
    // that had escaped kept walking off through the rest of the document.
    expect(document.activeElement).toBe(getByText('Inside'));

    outside.remove();
  });
});

describe('Modal scroll lock', () => {
  afterEach(() => {
    cleanup();
    document.body.style.removeProperty('overflow');
  });

  it('locks the body while a modal is open and restores it afterwards', () => {
    const { unmount } = render(<Modal onClose={() => {}}><div>Only</div></Modal>);
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    // No inline style before, none after.
    expect(document.body.style.overflow).toBe('');
    expect(document.body.getAttribute('style')).not.toContain('overflow');
  });

  it('keeps the lock when the outer modal closes before the inner one', () => {
    // The order the audit found: an outer dialog dismissed while a dialog it
    // opened is still on screen. Whichever closes first, the page behind must
    // stay locked until both are gone.
    const { rerender } = render(
      <>
        <Modal onClose={() => {}}><div>Outer</div></Modal>
        <Modal onClose={() => {}}><div>Inner</div></Modal>
      </>
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <>
        {null}
        <Modal onClose={() => {}}><div>Inner</div></Modal>
      </>
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<>{null}{null}</>);
    expect(document.body.style.overflow).toBe('');
  });

  it('restores an overflow the page had set for itself', () => {
    document.body.style.overflow = 'scroll';

    const { unmount } = render(<Modal onClose={() => {}}><div>Only</div></Modal>);
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('scroll');
  });
});
