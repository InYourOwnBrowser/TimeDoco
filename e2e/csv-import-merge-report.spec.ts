import { test, expect, openApp } from './support/fixtures';
import { downloadText, exportFile, importCsv, todayIso } from './support/app';

/**
 * Flow 2: bring history in from somewhere else, tidy it up, and bill it.
 *
 * Someone arriving from another tracker imports a CSV, finds the same work
 * under two names, merges them, and sends an invoice. Three subsystems that
 * each have their own tests, and one number at the end of them that has to
 * equal what went in: import can drop a row, merge can strand entries on the
 * timecode it deleted, and the report can be built from a different set than
 * the screen shows. None of those is visible from inside any one of them.
 */

test('imported hours survive a merge and add up on the report', async ({ page, site }) => {
  page.on('dialog', (dialog) => { void dialog.accept(); });

  await openApp(page, site);
  const today = await todayIso(page);

  // 2h + 1h under one name, 1h30 under the other: 4.5 hours in.
  await importCsv(page, [
    'Start Time,End Time,Timecode,Note',
    `${today} 09:00,${today} 11:00,Design,Wireframes`,
    `${today} 13:00,${today} 14:00,Design,Revisions`,
    `${today} 15:00,${today} 16:30,Design Review,Client walkthrough`,
  ].join('\n'));

  await expect(page.getByText('Wireframes')).toBeVisible();
  await expect(page.getByText('Client walkthrough')).toBeVisible();

  await page.getByRole('button', { name: 'Management' }).click();
  const search = page.getByRole('textbox', { name: 'Search groups & timecodes…' });
  await expect(page.getByText(/2 entries/)).toBeVisible();
  await expect(page.getByText(/1 entry\b/)).toBeVisible();

  // Narrow to the one being merged away, so the row's buttons are its own.
  await search.fill('Design Review');
  await page.getByRole('button', { name: 'Merge Timecode' }).click();
  await page.getByRole('combobox').selectOption({ label: 'Design (No Group)' });
  await page.getByRole('button', { name: 'Confirm Merge' }).click();

  await search.fill('');
  await expect(page.getByText(/3 entries/)).toBeVisible();
  await expect(page.getByText('Design Review')).toHaveCount(0);

  // One timecode left, so the row being edited is unambiguous.
  await page.getByRole('button', { name: 'Edit Timecode' }).click();
  await page.getByRole('spinbutton', { name: 'Rate' }).fill('80');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Edit Timecode' })).toBeVisible();

  await page.getByRole('button', { name: 'Analysis' }).click();
  await expect(page.getByRole('heading', { name: 'Analysis & Reports' })).toBeVisible();

  const csv = await downloadText(await exportFile(page, /Summary CSV/));
  const rows = csv.split('\n').filter(Boolean);
  // Every imported hour is on the one remaining timecode, and nothing was left
  // behind on the one the merge deleted.
  expect(rows.filter(row => row.startsWith('"Design"'))).toHaveLength(1);
  expect(rows.find(row => row.startsWith('"Design"'))).toContain('4.50');
  expect(rows.find(row => row.startsWith('"Design"'))).toContain('360.00');
  expect(rows.find(row => row.startsWith('"Total"'))).toContain('4.50');
  expect(rows.find(row => row.startsWith('"Total"'))).toContain('360.00');
});
