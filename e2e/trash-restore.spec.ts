import { test, expect, openApp } from './support/fixtures';
import { addManualEntry, createTimecode, todayIso } from './support/app';

/**
 * Flow 4: delete to the trash, put it back, and be refused when the slot has
 * been taken.
 *
 * A restore is the one write that reintroduces a record the rest of the app has
 * moved on from. The refusal is the whole point: overlapping entries would put
 * the same hour on two lines of an invoice, and the user has to be told which
 * way it went rather than left to find out from the report.
 */

test('a deleted entry comes back, and is refused when its slot is taken', async ({ page, site }) => {
  page.on('dialog', (dialog) => { void dialog.accept(); });

  await openApp(page, site);
  const today = await todayIso(page);
  await createTimecode(page, 'Consulting', '100');

  await addManualEntry(page, { timecode: 'Consulting', from: `${today}T09:00`, to: `${today}T10:00`, note: 'Morning' });
  await expect(page.getByText('Morning')).toBeVisible();

  await page.getByRole('button', { name: 'Delete Entry' }).first().click();
  await expect(page.getByText('Morning')).toHaveCount(0);

  const openTrash = async () => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Trash' }).click();
    return page.getByRole('dialog');
  };
  const closeSettings = async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };

  // Restoring into an empty slot works, and the entry is itself again.
  let trash = await openTrash();
  await expect(trash.getByText('Entry: Morning')).toBeVisible();
  await trash.getByRole('button', { name: 'Restore' }).click();
  await expect(trash.getByText('Trash is empty.')).toBeVisible();
  await closeSettings();
  await expect(page.getByText('9:00 AM - 10:00 AM')).toBeVisible();
  await expect(page.getByText('1h 0m 0s')).toBeVisible();

  // Delete it again, then take the hour with something else.
  await page.getByRole('button', { name: 'Delete Entry' }).first().click();
  await expect(page.getByText('Morning')).toHaveCount(0);
  await addManualEntry(page, { timecode: 'Consulting', from: `${today}T09:30`, to: `${today}T10:30`, note: 'Took the slot' });
  await expect(page.getByText('Took the slot')).toBeVisible();

  trash = await openTrash();
  await trash.getByRole('button', { name: 'Restore' }).click();

  // Refused, out loud, and the entry stays in the trash rather than half
  // coming back.
  await expect(page.getByText('Cannot restore: an entry would overlap one that is already live.')).toBeVisible();
  await expect(trash.getByText('Entry: Morning')).toBeVisible();
  await closeSettings();
  // Still in the trash, and the entry that took the hour is untouched.
  await expect(page.getByText('Morning')).toHaveCount(0);
  await expect(page.getByText('Took the slot')).toBeVisible();
});
