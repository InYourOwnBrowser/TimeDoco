import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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
