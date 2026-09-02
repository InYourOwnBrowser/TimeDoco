import { test, expect, openApp } from './support/fixtures';
import { createTimecode, downloadText, exportFile, setEntryTimes, todayIso, trackSomething } from './support/app';
import { readFile } from 'node:fs/promises';

/**
 * Flow 1: track time, correct it, split it, and bill it.
 *
 * The path a first invoice actually takes. Each step is covered by unit tests
 * on its own; what only exists in sequence is whether the hours survive all
 * four — a split that loses a minute, or a report built from a different set of
 * entries than the list shows, is invisible to any one of them.
 */

test('an entry survives being tracked, corrected, split and billed', async ({ page, site }) => {
  await openApp(page, site);
  const today = await todayIso(page);

  await createTimecode(page, 'Consulting', '100');
  await trackSomething(page, 'Kickoff call');

  await setEntryTimes(page, `${today}T09:00`, `${today}T12:00`);
  await expect(page.getByText('9:00 AM - 12:00 PM')).toBeVisible();
  await expect(page.getByText('3h 0m 0s')).toBeVisible();

  // Split at the halfway point. Both halves keep the timecode, so the day's
  // total is the one thing that must not move.
  await page.getByRole('button', { name: 'Split Entry' }).click();
  const splitDialog = page.getByRole('dialog');
  await splitDialog.locator('input[type="datetime-local"]').fill(`${today}T10:30`);
  await splitDialog.getByRole('button', { name: 'Split Entry' }).click();
  await expect(splitDialog).toHaveCount(0);

  await expect(page.getByText('9:00 AM - 10:30 AM')).toBeVisible();
  await expect(page.getByText('10:30 AM - 12:00 PM')).toBeVisible();
  await expect(page.getByText('1h 30m 0s')).toHaveCount(2);

  await page.getByRole('button', { name: 'Analysis' }).click();
  await expect(page.getByRole('heading', { name: 'Analysis & Reports' })).toBeVisible();

  // The summary a client would be sent: three hours at $100, whatever the
  // entries were split into on the way here.
  const csv = await downloadText(await exportFile(page, /Summary CSV/));
  expect(csv).toContain('"Consulting"');
  expect(csv).toContain('3.00');
  expect(csv.split('\n').find(line => line.startsWith('"Total"'))).toContain('300.00');

  const pdf = await exportFile(page, /Generate Report \(PDF\)/);
  expect(await pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const bytes = await readFile((await pdf.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.byteLength).toBeGreaterThan(5000);
});
