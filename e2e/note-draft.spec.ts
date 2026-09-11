import { test, expect, openApp } from './support/fixtures';
import { createTimecode } from './support/app';

/**
 * A note typed beside a running timer is written a second after the typing
 * stops. Leaving the tracker inside that second used to cancel the write
 * rather than perform it, so up to a second of typing disappeared — and the
 * update banner tells the user the opposite.
 */

test('a note typed a moment before leaving the tracker is still there on the way back', async ({ page, site }) => {
  await openApp(page, site);
  await createTimecode(page, 'Consulting', '100');

  await page.getByRole('button', { name: /Start Timer/ }).click();
  const note = page.getByPlaceholder('Add a note...');
  await expect(note).toBeVisible();

  await note.fill('Half a sentence');
  // Straight out, well inside the debounce.
  await page.getByRole('button', { name: 'Analysis' }).click();
  await expect(page.getByRole('heading', { name: 'Analysis & Reports' })).toBeVisible();

  await page.getByRole('button', { name: 'Tracker' }).click();
  await expect(page.getByPlaceholder('Add a note...')).toHaveValue('Half a sentence');
});
