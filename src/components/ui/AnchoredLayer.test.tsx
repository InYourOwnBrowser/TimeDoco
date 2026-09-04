import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useRef, useState } from 'react';
import { AnchoredLayer } from './AnchoredLayer';
import { ActionMenu } from './ActionMenu';
import { Modal } from './Modal';

const Layer = ({ onDismiss, withBackdrop }: { onDismiss?: () => void; withBackdrop?: boolean }) => {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button ref={anchorRef}>Anchor</button>
      <AnchoredLayer anchorRef={anchorRef} onDismiss={onDismiss} withBackdrop={withBackdrop} role="menu" aria-label="Actions">
        <button>Rename</button>
      </AnchoredLayer>
    </div>
  );
};

describe('AnchoredLayer', () => {
  it('draws outside the element that opened it, so nothing can clip it', () => {
    const { container } = render(<Layer />);

    const menu = screen.getByRole('menu', { name: 'Actions' });
    expect(container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });

  it('dismisses on a click on its backdrop', () => {
    const onDismiss = vi.fn();
    render(<Layer onDismiss={onDismiss} />);

    const backdrop = document.querySelector('[aria-hidden="true"]')!;
    fireEvent.click(backdrop);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('has no backdrop when it is not something the user dismisses', () => {
    render(<Layer withBackdrop={false} onDismiss={vi.fn()} />);

    expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('closes on Escape without closing the dialog it was opened from', () => {
    const onClose = vi.fn();
    const onDismiss = vi.fn();
    render(
      <Modal onClose={onClose} label="Test dialog">
        <Layer onDismiss={onDismiss} />
      </Modal>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});

const Menu = ({ onPick }: { onPick: () => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <ActionMenu label="Row Actions" open={open} onOpenChange={setOpen}>
      <button role="menuitem" onClick={onPick}>Edit</button>
    </ActionMenu>
  );
};

describe('ActionMenu', () => {
  it('opens and closes from its own button', () => {
    render(<Menu onPick={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Row Actions' });

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'Row Actions' })).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes itself when an item is chosen', () => {
    // Several items used to leave the menu open over the row they had just put
    // into edit mode, because closing was each item's own job to remember.
    const onPick = vi.fn();
    render(<Menu onPick={onPick} />);

    fireEvent.click(screen.getByRole('button', { name: 'Row Actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
