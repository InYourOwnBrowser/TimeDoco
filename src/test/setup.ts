import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as fc from 'fast-check';

/**
 * Property tests run from a fixed seed unless one is asked for.
 *
 * Unseeded, `fc.assert` draws fresh inputs every run, so a genuine defect that
 * only some inputs reach turns up as a red build that goes green on a re-run —
 * which is indistinguishable from a flake, and trains everyone to re-run
 * instead of read it. The order-dependent allocation I9 caught behaved exactly
 * that way. A fixed seed makes a failure reproducible on the spot and keeps a
 * regression from being waved through.
 *
 * Set `FC_SEED` to fuzz beyond the pinned set — a nightly job, or a deliberate
 * hunt after touching the billing maths. A counterexample found that way
 * belongs in a test as a fixed case, not left to the next random draw.
 */
fc.configureGlobal({
  seed: process.env.FC_SEED ? Number(process.env.FC_SEED) : 0x7d0c0,
});

afterEach(() => {
  cleanup();
});
