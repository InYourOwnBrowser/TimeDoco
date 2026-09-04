import { useEffect, type RefObject } from 'react';

/**
 * Closes a layer when a click lands outside it, and spends that click doing so.
 *
 * The pattern this replaces is a full-screen `position: fixed` div behind the
 * layer. That works on a plain page and quietly stops working inside a dialog:
 * the dialog's backdrop filter makes it the containing block for anything
 * fixed, so the "full-screen" catcher is clipped to the dialog body and a click
 * on the dialog's own header or footer never reaches it. Listening on the
 * document has no such blind spot.
 *
 * It listens for the click rather than the press that starts it, in the capture
 * phase, so the one handler both dismisses the layer and stops the click
 * reaching anything else — which is what the catcher did. Dismissing on
 * `pointerdown` cannot: closing the layer re-renders, the effect holding any
 * follow-up listener is torn down, and the click that follows lands on whatever
 * is underneath.
 */
export const useOutsideDismiss = (
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
): void => {
  useEffect(() => {
    if (!open) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && ref.current?.contains(target)) return;

      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [open, ref, onDismiss]);
};
