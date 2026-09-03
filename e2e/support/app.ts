import { expect, type Download, type Page } from '@playwright/test';

/** Today, as the app's date inputs want it. */
export const todayIso = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

/** Create a timecode through the picker on the tracker, and select it. */
export const createTimecode = async (page: Page, name: string, hourlyRate?: string) => {
  const picker = page.getByRole('combobox', { name: 'Select or type to create...' }).first();
  await picker.click();
  await picker.fill(name);
  await page.getByRole('option', { name: `Create "${name}"` }).click();
  if (hourlyRate) await page.getByRole('spinbutton', { name: '0.00' }).fill(hourlyRate);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(picker).toHaveValue(name);
};

/** Run the timer for a moment and stop it, leaving one entry behind. */
export const trackSomething = async (page: Page, note: string) => {
  await page.getByRole('textbox', { name: 'Add a note (optional)' }).fill(note);
  await page.getByRole('button', { name: /Start Timer/ }).click();
  await expect(page.getByRole('button', { name: /Stop Timer/ })).toBeVisible();
  await page.getByRole('button', { name: /Stop Timer/ }).click();
  await expect(page.getByRole('button', { name: /Start Timer/ })).toBeVisible();
};

/**
 * Move an entry to fixed times, so everything downstream of it is a number the
 * test can name rather than however long the click took.
 */
export const setEntryTimes = async (page: Page, from: string, to: string) => {
  await page.getByRole('button', { name: 'Edit Entry' }).first().click();
  const dialog = page.getByRole('dialog');
  const fields = dialog.locator('input[type="datetime-local"]');
  await fields.nth(0).fill(from);
  await fields.nth(1).fill(to);
  await dialog.getByRole('button', { name: 'Save Changes' }).click();
  await expect(dialog).toHaveCount(0);
};

/**
 * Click an export and take the file it produces. Every download goes through
 * the same Save File As dialog, so the filename is confirmed here too.
 */
export const exportFile = async (page: Page, exportName: RegExp | string): Promise<Download> => {
  await page.getByRole('button', { name: exportName }).click();
  const dialog = page.getByRole('dialog', {});
  await expect(dialog.getByRole('heading', { name: 'Save File As' })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save' }).click();
  return downloading;
};

export const downloadText = async (download: Download): Promise<string> => {
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  return readFile(path, 'utf8');
};

/** Log an entry at fixed times, without waiting for a clock. */
export const addManualEntry = async (
  page: Page,
  { timecode, from, to, note }: { timecode: string; from: string; to: string; note: string },
) => {
  await page.getByRole('button', { name: 'Add Manual Entry' }).click();
  const dialog = page.getByRole('dialog');
  const picker = dialog.getByRole('combobox', { name: 'Select or type to create...' });
  await picker.click();
  await picker.fill(timecode);
  await dialog.getByRole('option', { name: timecode, exact: true }).first().click();
  await expect(picker).toHaveValue(timecode);

  const fields = dialog.locator('input[type="datetime-local"]');
  await fields.nth(0).fill(from);
  await fields.nth(1).fill(to);
  // Start, End, Note, Tags — the note is the one without a placeholder.
  await dialog.getByRole('textbox').nth(2).fill(note);
  await dialog.getByRole('button', { name: 'Add Entry' }).click();
  await expect(dialog).toHaveCount(0);
};

/** Import a CSV of time entries through Settings → Data. */
export const importCsv = async (page: Page, csv: string) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Data', exact: true }).click();
  await page.locator('input[type="file"][accept=".csv"]').setInputFiles({
    name: 'entries.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await dialog.getByRole('button', { name: 'Import CSV' }).click();
  await expect(dialog.getByText(/Successfully imported/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
};
