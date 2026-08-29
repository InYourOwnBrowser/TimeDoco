import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
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
});
