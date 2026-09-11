import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { placeAnchored } from '../utils/anchorPosition';
import { clippingBoundsFor } from '../utils/clippingBounds';

export interface DropdownFit {
  /** Which side of the field the list opens on. */
  placement: 'top' | 'bottom';
  /** Null until measured — the stylesheet's own cap applies until then. */
  maxHeight: number | null;
}

const CLOSED: DropdownFit = { placement: 'bottom', maxHeight: null };

interface Options {
  /** A ceiling on the list's height; the space available can only lower it. */
  maxHeight?: number;
  gap?: number;
  margin?: number;
  /** Re-measure when this changes — the option list was filtered, say. */
  contentKey?: unknown;
}

/**
 * Keeps a dropdown that stays in the flow of the document inside whatever
 * would clip it.
 *
 * A list with a fixed `max-height` is fine on a roomy page and wrong
 * everywhere else: opened near the bottom of a dialog it runs past the edge of
 * the dialog body, which hides the rest of the options behind a scroll nobody
 * expects to have to do. Measuring the space that is actually there, flipping
 * the list above the field when that is roomier, and capping its height so it
 * scrolls itself, keeps every option reachable at any window size.
 */
export const useDropdownFit = (
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  layerRef: RefObject<HTMLElement | null>,
  { maxHeight, gap = 4, margin = 8, contentKey }: Options = {},
): DropdownFit => {
  const [fit, setFit] = useState<DropdownFit>(CLOSED);

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    const layer = layerRef.current;
    if (!anchor || !layer) return;

    const anchorRect = anchor.getBoundingClientRect();
    // Nothing has been laid out — jsdom, or a layer mounted before paint.
    // Guessing from zeros would cap the list at nothing.
    if (anchorRect.width === 0 && anchorRect.height === 0) return;

    const placement = placeAnchored({
      anchor: anchorRect,
      // `scrollHeight` is the height the content wants whatever cap is on it,
      // so the cap this hook set last time does not feed back into the next
      // measurement.
      content: { width: layer.offsetWidth, height: layer.scrollHeight },
      bounds: clippingBoundsFor(anchor, margin),
      gap,
      matchAnchorWidth: true,
      maxHeight,
    });

    setFit((previous) =>
      previous.placement === placement.placement && previous.maxHeight === placement.maxHeight
        ? previous
        : { placement: placement.placement, maxHeight: placement.maxHeight },
    );
  }, [anchorRef, layerRef, gap, margin, maxHeight]);

  useLayoutEffect(() => {
    if (!open) {
      setFit((previous) => (previous === CLOSED ? previous : CLOSED));
      return;
    }
    measure();
  }, [open, measure, contentKey]);

  useEffect(() => {
    if (!open) return;

    // Capture, so scrolling any container the field sits in counts, not just
    // the window.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && layerRef.current) {
      observer = new ResizeObserver(measure);
      observer.observe(layerRef.current);
    }

    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [open, measure, layerRef]);

  return fit;
};
