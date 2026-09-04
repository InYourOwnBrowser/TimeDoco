/**
 * Where a layer anchored to a control — a dropdown list, an overflow menu, a
 * tooltip — should go, and how tall it may be.
 *
 * Kept as one pure function over plain numbers so the rule can be tested
 * without a layout engine: jsdom reports every rect as zero, so anything that
 * measured the DOM to decide this would be untestable and, in practice,
 * untested. The callers do the measuring; this decides.
 */

export interface AnchorBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface AnchorInput {
  /** The control the layer hangs off, in viewport coordinates. */
  anchor: AnchorBox & { width: number };
  /** How big the layer would be with nothing constraining it. */
  content: { width: number; height: number };
  /**
   * The area the layer has to stay inside, in viewport coordinates: the
   * viewport, or the nearest ancestor that would clip it.
   */
  bounds: AnchorBox;
  /** Space left between the anchor and the layer. */
  gap?: number;
  /** Which edge of the anchor the layer lines up with. */
  align?: 'start' | 'end';
  /** Take the anchor's width instead of the content's. */
  matchAnchorWidth?: boolean;
  /** A ceiling on the height. The space actually available can only lower it. */
  maxHeight?: number;
  /**
   * Below this a layer is a useless sliver. If neither side can offer it, the
   * layer is allowed to overlap the anchor rather than collapse to nothing.
   */
  minHeight?: number;
}

export interface AnchorPlacement {
  /** Which side of the anchor the layer ended up on. */
  placement: 'top' | 'bottom';
  top: number;
  left: number;
  /** Null when the layer keeps its own width. */
  width: number | null;
  maxHeight: number;
}

const clamp = (value: number, min: number, max: number): number =>
  // `max` first: when the bounds are narrower than the layer there is no value
  // that satisfies both, and being cut off at the far edge is worse than
  // overflowing the near one.
  Math.max(min, Math.min(value, max));

export const placeAnchored = ({
  anchor,
  content,
  bounds,
  gap = 4,
  align = 'start',
  matchAnchorWidth = false,
  maxHeight = Number.POSITIVE_INFINITY,
  minHeight = 96,
}: AnchorInput): AnchorPlacement => {
  const boundsHeight = Math.max(0, bounds.bottom - bounds.top);
  const wanted = Math.min(content.height, maxHeight);

  const below = bounds.bottom - anchor.bottom - gap;
  const above = anchor.top - bounds.top - gap;

  // Below by default, because that is where a dropdown is expected. Flipping is
  // for when below genuinely cannot show the content and above can show more of
  // it — not merely for below being short.
  const placement: 'top' | 'bottom' = wanted > below && above > below ? 'top' : 'bottom';

  // A sliver is worse than an overlap: if the chosen side cannot even offer
  // `minHeight`, let the layer take that much and be clamped back into bounds
  // below, over the anchor if that is what it takes.
  const room = Math.max(0, placement === 'top' ? above : below);
  const available = Math.max(room, Math.min(minHeight, boundsHeight));
  const height = Math.max(0, Math.min(wanted, available));

  const width = matchAnchorWidth ? anchor.width : null;
  const layerWidth = width ?? content.width;

  const unclampedLeft = align === 'end' ? anchor.right - layerWidth : anchor.left;
  const left = clamp(unclampedLeft, bounds.left, bounds.right - layerWidth);

  const unclampedTop = placement === 'top' ? anchor.top - gap - height : anchor.bottom + gap;
  const top = clamp(unclampedTop, bounds.top, bounds.bottom - height);

  return { placement, top, left, width, maxHeight: height };
};
