import { test, expect, type Page } from '@playwright/test';
import { serveStatic, type StaticSite } from './support/staticServer';
import { createTimecode } from './support/app';

/**
 * Menus and dropdowns, checked against the containers that used to cut them off.
 *
 * These are geometry, so there is nothing a unit test can see: jsdom reports
 * every rectangle as zero. Each case here is a place where a layer was drawn
 * outside the box that clips it, and the options past the cut were unreachable.
 */

let site: StaticSite;

test.beforeAll(async () => {
  site = await serveStatic('dist');
});

test.afterAll(async () => {
  await site.close();
});

/** How far past its scroll container a layer is drawn, and how much it shows. */
const measureList = (page: Page) =>
  page.locator('#timecode-listbox').evaluate((el) => {
    const list = el.getBoundingClientRect();
    let container = el.parentElement;
    while (container && getComputedStyle(container).overflowY === 'visible') {
      container = container.parentElement;
    }
    const bounds = container!.getBoundingClientRect();
    return {
      clippedPx: Math.round(Math.max(0, list.bottom - bounds.bottom)),
      shownPx: Math.round(list.height),
      wantedPx: el.scrollHeight,
      reachablePx: el.clientHeight,
    };
  });

test('a long timecode list stays inside the dialog that holds it', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 620 });
  await page.goto(`${site.url}/app/`);

  for (let i = 0; i < 12; i++) await createTimecode(page, `Project ${i}`);

  await page.getByRole('button', { name: 'Add Manual Entry' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Timecode' }).click();
  await expect(dialog.locator('#timecode-listbox')).toBeVisible();

  const list = await measureList(page);

  // The list wants more room than the dialog has — that is the case worth
  // testing, and the reason the fixed 24rem cap was wrong.
  expect(list.wantedPx).toBeGreaterThan(list.shownPx);
  // Not one pixel of it is drawn past the edge of the dialog body...
  expect(list.clippedPx).toBe(0);
  // ...and everything it holds is reachable by scrolling the list itself.
  expect(list.reachablePx).toBeGreaterThanOrEqual(list.shownPx - 4);

  const options = dialog.getByRole('option');
  await expect(options.first()).toBeVisible();
  await options.last().scrollIntoViewIfNeeded();
  await expect(options.last()).toBeVisible();
});

test('the list opens upwards when the field is near the bottom of the window', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 620 });
  await page.goto(`${site.url}/app/`);

  for (let i = 0; i < 12; i++) await createTimecode(page, `Project ${i}`);

  // The tracker's own picker, scrolled so that it sits low in the window.
  const picker = page.getByRole('combobox', { name: 'What are you working on?' }).first();
  await picker.evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await picker.click();

  const placement = await page.locator('#timecode-listbox').evaluate((el) => {
    const list = el.getBoundingClientRect();
    const field = el.closest('.relative')!.querySelector('input')!.getBoundingClientRect();
    return { above: list.bottom <= field.top + 1, bottom: list.bottom, viewport: window.innerHeight };
  });

  expect(placement.above).toBe(true);
  expect(placement.bottom).toBeLessThanOrEqual(placement.viewport);
});

test('a row overflow menu escapes the card that clips it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto(`${site.url}/app/`);

  await createTimecode(page, 'Alpha');
  await page.getByRole('button', { name: 'Management' }).click();

  await page.getByRole('button', { name: 'Timecode Actions Menu' }).first().click();
  const menu = page.getByRole('menu', { name: 'Timecode Actions Menu' });

  // Every item, not just the two that fitted inside the card.
  for (const item of ['Edit', 'Merge', 'Archive', 'Delete']) {
    await expect(menu.getByRole('menuitem', { name: item })).toBeVisible();
  }

  const box = (await menu.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(700);

  // A click elsewhere closes it — and is caught on the way, so it does not also
  // press whatever it landed on. Driven through the mouse rather than a
  // locator, because a locator click refuses to aim at a covered element.
  const heading = page.getByRole('heading', { name: 'Groups & Timecodes' });
  const target = (await heading.boundingBox())!;
  await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
  await expect(menu).toHaveCount(0);
});

test('the floating timer bar does not sit on top of a dialog', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${site.url}/app/`);

  await createTimecode(page, 'Alpha');
  await page.getByRole('button', { name: /Start Timer/ }).click();
  await page.getByRole('button', { name: 'Analysis' }).click();
  await expect(page.getByRole('button', { name: 'Pause Timer' })).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // Whatever is painted at the bar's own corner belongs to the dialog now.
  const bar = (await page.getByRole('button', { name: 'Pause Timer' }).boundingBox())!;
  const onTop = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('[role="dialog"]') !== null,
    [bar.x + bar.width / 2, bar.y + bar.height / 2],
  );

  expect(onTop).toBe(true);
});
