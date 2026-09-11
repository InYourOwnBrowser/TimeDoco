import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeAnchored } from '../../utils/anchorPosition';

interface Position {
  top: number;
  left: number;
  width: number | null;
  maxHeight: number;
}

export interface AnchoredLayerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The control the layer hangs off. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Called for a click outside the layer, and for Escape. Omit for a layer the user does not dismiss. */
  onDismiss?: () => void;
  /** Which edge of the anchor the layer lines up with. */
  align?: 'start' | 'end';
  /** Take the anchor's width rather than the content's. */
  matchAnchorWidth?: boolean;
  /** A ceiling on the height; the space available can only lower it. */
  maxHeight?: number;
  /**
   * Whether a click anywhere else is swallowed to close the layer. A menu wants
   * this; a tooltip that opens on hover does not.
   */
  withBackdrop?: boolean;
}

/**
 * A menu, tooltip or popover rendered outside the page, positioned against the
 * control that opened it.
 *
 * The reason it is a portal and not a positioned child: an overflow menu inside
 * a card with `overflow-hidden`, or a tooltip inside a scrolling dialog body,
 * is cut off by the container the moment it is longer than the space left below
 * the trigger — and on a collapsed card there is no space below the trigger at
 * all, so the menu is invisible. Rendering it against the viewport instead lets
 * it flip above the trigger when that is roomier and cap its own height so it
 * scrolls, which no amount of z-index on a clipped child can do.
 */
export const AnchoredLayer: React.FC<AnchoredLayerProps> = ({
  anchorRef,
  onDismiss,
  align = 'start',
  matchAnchorWidth = false,
  maxHeight,
  withBackdrop = true,
  className = '',
  style,
  children,
  ...rest
}) => {
  const layerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);
  // Separate from `position`, because "measured and there was nothing to
  // measure against" is not the same as "not measured yet": the first must
  // still show the layer, or an anchor with no box hides it for good.
  const [measured, setMeasured] = useState(false);

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    const layer = layerRef.current;
    if (!anchor || !layer) return;

    setMeasured(true);

    const anchorRect = anchor.getBoundingClientRect();
    // An anchor with no box at all — nothing has been laid out. There is no
    // position to compute, and pinning the layer to 0,0 would put it off the
    // corner of the page, so leave it where the flow puts it.
    if (anchorRect.width === 0 && anchorRect.height === 0) return;

    const placed = placeAnchored({
      anchor: anchorRect,
      content: { width: layer.offsetWidth, height: layer.scrollHeight },
      // A portal is clipped by nothing, so the window is the only bound.
      bounds: { top: 8, left: 8, right: window.innerWidth - 8, bottom: window.innerHeight - 8 },
      align,
      matchAnchorWidth,
      maxHeight,
    });

    setPosition((previous) =>
      previous &&
      previous.top === placed.top &&
      previous.left === placed.left &&
      previous.width === placed.width &&
      previous.maxHeight === placed.maxHeight
        ? previous
        : { top: placed.top, left: placed.left, width: placed.width, maxHeight: placed.maxHeight },
    );
  }, [anchorRef, align, matchAnchorWidth, maxHeight]);

  useLayoutEffect(measure);

  useEffect(() => {
    // Capture, so scrolling any container the anchor sits in moves the layer
    // with it rather than leaving it stranded mid-page.
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
  }, [measure]);

  useEffect(() => {
    if (!onDismiss) return;

    // Capture on the document rather than a React handler: the layer lives
    // outside the tree it belongs to, and Escape has to close it *instead of*
    // the dialog it was opened from, not as well as.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onDismiss]);

  return createPortal(
    <>
      {withBackdrop && onDismiss && (
        // Absorbs the click that closes the layer, so the first click outside
        // dismisses rather than also landing on whatever is underneath.
        <div className="fixed inset-0 z-[60]" aria-hidden="true" onClick={onDismiss} />
      )}
      <div
        ref={layerRef}
        className={`fixed z-[61] overflow-y-auto overscroll-contain ${className}`}
        style={{
          top: position?.top,
          left: position?.left,
          width: position?.width ?? undefined,
          maxHeight: position?.maxHeight,
          // One frame, before paint: without this the layer appears at the
          // corner of the window and jumps to the anchor.
          visibility: measured ? undefined : 'hidden',
          ...style,
        }}
        {...rest}
      >
        {children}
      </div>
    </>,
    document.body,
  );
};
