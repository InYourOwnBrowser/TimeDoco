import type { AnchorBox } from './anchorPosition';

/**
 * The area an element can actually be seen in: the viewport, narrowed by every
 * ancestor that would clip it.
 *
 * A dropdown that stays in the flow of the document is bounded by whatever
 * scrolls or hides its overflow — a modal body, a card with rounded corners —
 * not by the window. Sizing it against the window is what leaves a long list
 * cut off at the edge of a dialog with no way to reach the rest of it.
 */
export const clippingBoundsFor = (element: Element, margin = 8): AnchorBox => {
  const bounds: AnchorBox = {
    top: margin,
    left: margin,
    right: window.innerWidth - margin,
    bottom: window.innerHeight - margin,
  };

  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowX, overflowY } = window.getComputedStyle(node);
    if (overflowX === 'visible' && overflowY === 'visible') continue;

    const rect = node.getBoundingClientRect();
    // A container that has not been laid out yet reports zeros, which would
    // collapse the bounds to nothing and hide the layer completely.
    if (rect.width === 0 && rect.height === 0) continue;

    bounds.top = Math.max(bounds.top, rect.top);
    bounds.bottom = Math.min(bounds.bottom, rect.bottom);
    bounds.left = Math.max(bounds.left, rect.left);
    bounds.right = Math.min(bounds.right, rect.right);
  }

  return bounds;
};
