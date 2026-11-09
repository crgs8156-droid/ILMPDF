// Tool search: the ⌘K / "/" box and the sidebar search field.
import { expect, test } from './fixtures';
import { addPdf, openTool } from './helpers';
import { makePdf } from '../fixtures/make-pdf';

const palette = (page: import('@playwright/test').Page) => page.getByTestId('palette');
const input = (page: import('@playwright/test').Page) => page.getByTestId('palette-input');
const selected = (page: import('@playwright/test').Page) => page.locator('[data-testid="palette-list"] [aria-selected="true"]');

test('⌘K opens search; typing, arrows and Return open a tool', async ({ page }) => {
  await page.goto('/');
  await expect(palette(page)).toBeHidden();
  await page.keyboard.press('ControlOrMeta+K');
  await expect(palette(page)).toBeVisible();
  await expect(input(page)).toBeFocused();

  await input(page).fill('password');
  const options = page.locator('[data-testid="palette-list"] [role="option"]');
  await expect(options).toHaveCount(2);
  await expect(selected(page)).toHaveAttribute('data-testid', /palette-opt-(protect|unlock)/);
  const first = await selected(page).getAttribute('data-testid');
  await page.keyboard.press('ArrowDown');
  await expect(selected(page)).not.toHaveAttribute('data-testid', first!);
  const second = (await selected(page).getAttribute('data-testid'))!.replace('palette-opt-', '');
  await expect(input(page)).toHaveAttribute('aria-activedescendant', `palette-opt-${second}`);

  await page.keyboard.press('Enter');
  await expect(palette(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`#/${second}$`));
  await expect(page.getByTestId(`tool-${second}`)).toBeVisible();
});

test('"/" opens search; everyday words rank the right tool first', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('/');
  await expect(input(page)).toBeFocused();
  await expect(input(page)).toHaveValue('');
  await input(page).fill('smaller');
  await expect(selected(page)).toHaveAttribute('data-testid', 'palette-opt-compress');
  await page.keyboard.press('Enter');
  await expect(page).toHaveTitle('Compress PDF · ILMPDF');
  await expect(page.getByRole('heading', { name: 'Compress PDF' })).toBeFocused();
});

test('Esc closes search and puts focus back; the search is not kept', async ({ page }) => {
  await page.goto('/');
  const card = page.getByTestId('open-merge');
  await card.focus();
  await page.keyboard.press('ControlOrMeta+K');
  await input(page).fill('zzqx');
  await expect(page.getByTestId('palette-none')).toContainText('No tool matches “zzqx”');
  await page.keyboard.press('Escape');
  await expect(palette(page)).toBeHidden();
  await expect(card).toBeFocused();
  await expect(page).toHaveURL(/127\.0\.0\.1:4173\/(#\/)?$/);

  await page.keyboard.press('ControlOrMeta+K');
  await expect(input(page)).toHaveValue('');
});

test('the sidebar search field opens search, and a click opens a tool', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('side-search').click();
  await expect(input(page)).toBeFocused();
  await input(page).fill('black out');
  await page.getByTestId('palette-opt-redact').click();
  await expect(page).toHaveURL(/#\/redact$/);
});

test('"/" typed into a tool\'s own box is just text', async ({ page }) => {
  await openTool(page, 'split');
  await addPdf(page, 'a.pdf', makePdf(3));
  const box = page.getByTestId('split-spec');
  await box.fill('');
  await box.click();
  await page.keyboard.type('1/2');
  await expect(palette(page)).toBeHidden();
  await expect(box).toHaveValue('1/2');
});

test('Esc inside search does not leave the tool page', async ({ page }) => {
  await openTool(page, 'compress');
  await page.keyboard.press('ControlOrMeta+K');
  await page.keyboard.press('Escape');
  await expect(palette(page)).toBeHidden();
  await expect(page).toHaveURL(/#\/compress$/);
});
