import { describe, it, expect } from 'vitest';
import { placeAnchored, type AnchorInput } from './anchorPosition';

/** A field 200px wide, 30px tall, near the top of a 600px-tall window. */
const base = (overrides: Partial<AnchorInput> = {}): AnchorInput => ({
  anchor: { top: 100, bottom: 130, left: 50, right: 250, width: 200 },
  content: { width: 200, height: 300 },
  bounds: { top: 0, bottom: 600, left: 0, right: 400 },
  ...overrides,
});

describe('placeAnchored', () => {
  it('opens below the field when the content fits there', () => {
    const placed = placeAnchored(base());

    expect(placed.placement).toBe('bottom');
    expect(placed.top).toBe(134);
    expect(placed.maxHeight).toBe(300);
  });

  it('caps the height at the space that is left rather than overflowing it', () => {
    // 200px of window below a field that wants a 300px list.
    const placed = placeAnchored(base({ bounds: { top: 0, bottom: 330, left: 0, right: 400 } }));

    expect(placed.placement).toBe('bottom');
    expect(placed.maxHeight).toBe(196);
    expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(330);
  });

  it('flips above the field when there is more room there', () => {
    // A field near the bottom: 46px below it, 396px above.
    const placed = placeAnchored(
      base({ anchor: { top: 400, bottom: 430, left: 50, right: 250, width: 200 }, bounds: { top: 0, bottom: 480, left: 0, right: 400 } }),
    );

    expect(placed.placement).toBe('top');
    expect(placed.maxHeight).toBe(300);
    expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(400);
  });

  it('stays below when below is tight but still roomier than above', () => {
    const placed = placeAnchored(
      base({ anchor: { top: 20, bottom: 50, left: 50, right: 250, width: 200 }, bounds: { top: 0, bottom: 200, left: 0, right: 400 } }),
    );

    expect(placed.placement).toBe('bottom');
    expect(placed.maxHeight).toBe(146);
  });

  it('never shrinks to a useless sliver, even where nothing fits', () => {
    // Both sides are a few pixels. A 4px-tall menu is no use to anyone, so it
    // takes the minimum and is clamped back inside the bounds instead.
    const placed = placeAnchored(
      base({
        anchor: { top: 96, bottom: 104, left: 50, right: 250, width: 200 },
        bounds: { top: 90, bottom: 110, left: 0, right: 400 },
        minHeight: 96,
      }),
    );

    expect(placed.maxHeight).toBe(20);
    expect(placed.top).toBe(90);
  });

  it('honours the ceiling the caller asked for', () => {
    const placed = placeAnchored(base({ maxHeight: 120 }));

    expect(placed.maxHeight).toBe(120);
  });

  it('takes the anchor width when asked, and its own otherwise', () => {
    expect(placeAnchored(base({ matchAnchorWidth: true })).width).toBe(200);
    expect(placeAnchored(base()).width).toBeNull();
  });

  it('lines a right-aligned layer up with the right edge of the anchor', () => {
    const placed = placeAnchored(base({ align: 'end', content: { width: 144, height: 100 } }));

    expect(placed.left).toBe(250 - 144);
  });

  it('pulls a layer back inside the window rather than off the edge', () => {
    // A right-aligned menu on a trigger at the far left would start at -94.
    const placed = placeAnchored(
      base({
        align: 'end',
        anchor: { top: 100, bottom: 130, left: 0, right: 50, width: 50 },
        content: { width: 144, height: 100 },
      }),
    );

    expect(placed.left).toBe(0);
  });

  it('keeps a layer wider than the window at its left edge', () => {
    const placed = placeAnchored(
      base({ content: { width: 500, height: 100 }, bounds: { top: 0, bottom: 600, left: 8, right: 400 } }),
    );

    expect(placed.left).toBe(8);
  });
});
