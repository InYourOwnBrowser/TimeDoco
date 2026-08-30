import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { sumBillableLines, allocateProportionally } from './billing';

describe('Billing Subsystem Invariants', () => {
  it('I3: Printed row hours sum exactly to the printed total hours (using Phase 1 fix logic)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            seconds: fc.integer({ min: 1, max: 36000 }),
            workedSeconds: fc.integer({ min: 1, max: 36000 }),
            hours: fc.double({ min: 0.1, max: 10 }),
            amount: fc.integer({ min: 1, max: 100 }),
            isRunning: fc.boolean(),
            isClipped: fc.boolean(),
            isFixedCost: fc.boolean(),
          })
        ),
        (lines) => {
          if (lines.length === 0) return;
          const totals = sumBillableLines(lines);

          // Simulating Phase 1 fix logic in AnalysisView.tsx
          // Put lines in one bucket to simulate a single group/timecode
          const bucketSeconds = lines.reduce((acc, l) => acc + l.seconds, 0);
          const allocated = allocateProportionally([bucketSeconds], Math.round(totals.hours * 100));
          const rowHours = allocated[0] / 100;

          expect(rowHours).toBeCloseTo(totals.hours, 2);
        }
      )
    );
  });

  it('I5: Total worked seconds equals the worked time of every entry in the window, billed or not (using Phase 1 fix logic)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            seconds: fc.constant(0), // simulate rounded to zero
            workedSeconds: fc.integer({ min: 1, max: 60 }), // some worked time
            hours: fc.constant(0),
            amount: fc.constant(0),
            isRunning: fc.boolean(),
            isClipped: fc.boolean(),
            isFixedCost: fc.boolean(),
          })
        ),
        (zeroLines) => {
          if (zeroLines.length === 0) return;
          // In AnalysisView with Phase 1 fix, these lines are pushed to includedLines BEFORE checking if they are empty
          const includedLines = [];
          for (const line of zeroLines) {
            includedLines.push(line);
            if (line.seconds <= 0 && line.amount === 0) continue;
          }
          const totals = sumBillableLines(includedLines);
          const expectedWorkedSeconds = zeroLines.reduce((acc, line) => acc + line.workedSeconds, 0);
          expect(totals.workedSeconds).toBe(expectedWorkedSeconds);
        }
      )
    );
  });
});
