import { useEffect, useState } from 'react';

/**
 * How often an aggregate view refreshes while a timer is running. Totals here
 * are printed to a minute or to two decimal hours, so a faster tick would only
 * buy re-renders of the whole list for a figure that has not changed.
 */
export const AGGREGATE_TICK_MS = 60_000;

/**
 * A timestamp that advances on an interval while `active`, so a total that
 * includes a running timer keeps up with it.
 *
 * Views that summed the stored `duration` field showed nothing for a running
 * timer, because that field stays 0 until the timer stops. Measuring to "now"
 * fixes the number but makes it time-dependent, which is what this supplies —
 * and only while something is actually running, so an idle view never
 * re-renders on a timer of its own.
 */
export const useNowTick = (active: boolean, intervalMs: number = AGGREGATE_TICK_MS): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    // Catch up immediately: `now` may be stale from a spell of inactivity.
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);

  return now;
};
