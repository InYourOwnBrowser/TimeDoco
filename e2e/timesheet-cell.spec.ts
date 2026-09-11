import { test, expect, openApp } from './support/fixtures';
import { addManualEntry, createTimecode, todayIso } from './support/app';

/**
 * Flow 3: type an amount into a timesheet cell.
 *
 * A cell is a day and a timecode, and the edit has to land on that day. Filing
 * it a day out is the kind of mistake that reads as correct — the week's total
 * is right, the row is right, and only the client's Monday is wrong. So the
 * assertion is per-column, not on the total.
 */

test('a cell edit lands on the day it was typed into', async ({ page, site }) => {
  await openApp(page, site);
  const today = await todayIso(page);
  await createTimecode(page, 'Consulting', '100');
  await addManualEntry(page, { timecode: 'Consulting', from: `${today}T09:00`, to: `${today}T10:00`, note: 'Morning' });

  await page.getByRole('button', { name: 'Timesheet' }).click();
  await expect(page.getByRole('heading', { name: 'Timesheet' })).toBeVisible();

  // Monday-first columns. Whichever weekday the suite runs on, edit a day that
  // is not the one already carrying an hour.
  const { todayColumn, targetColumn, targetLabel } = await page.evaluate(() => {
    const now = new Date();
    const mondayIndex = (now.getDay() + 6) % 7;
    const target = mondayIndex === 0 ? 1 : 0;
    const monday = new Date(now);
    monday.setDate(now.getDate() - mondayIndex);
    const targetDate = new Date(monday);
    targetDate.setDate(monday.getDate() + target);
    return {
      todayColumn: mondayIndex,
      targetColumn: target,
      targetLabel: targetDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    };
  });

  const row = page.getByRole('row', { name: /^Consulting/ });
  const cells = row.getByRole('spinbutton');
  await expect(cells.nth(todayColumn)).toHaveValue('1.00');

  await cells.nth(targetColumn).fill('2.5');
  await cells.nth(targetColumn).blur();

  await expect(cells.nth(targetColumn)).toHaveValue('2.50');
  // The hour that was already there is untouched: an edit files time, it does
  // not move it.
  await expect(cells.nth(todayColumn)).toHaveValue('1.00');

  const totals = page.getByRole('row', { name: /^Total/ }).getByRole('cell');
  await expect(totals.nth(targetColumn + 1)).toHaveText('2.50');
  await expect(totals.nth(todayColumn + 1)).toHaveText('1.00');
  await expect(totals.nth(8)).toHaveText('3.50');

  // And the entry it created is filed under that date in the list, not today's.
  await page.getByRole('button', { name: 'Tracker' }).click();
  await expect(page.getByText(targetLabel, { exact: true })).toBeVisible();
  await expect(page.getByText('2h 30m 0s')).toBeVisible();
});
