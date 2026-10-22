import { expect, test } from './fixtures';

test('the sidebar opens a group and goes to a tool', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('side-dashboard')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('side-group-Security').click();
  await page.getByTestId('side-protect').click();
  await expect(page.getByTestId('tool-protect')).toBeVisible();
  await expect(page.getByTestId('side-protect')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('side-dashboard').click();
  await expect(page.getByTestId('open-protect')).toBeVisible();
});

test('filter chips show one group, and the breadcrumb group opens it', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('filter-Privacy').click();
  await expect(page.getByTestId('open-redact')).toBeVisible();
  await expect(page.getByTestId('open-merge')).toHaveCount(0);
  await page.getByTestId('filter-All').click();
  await page.getByTestId('open-compress').click();
  await page.getByTestId('breadcrumb').getByRole('button', { name: 'Optimize' }).click();
  await expect(page.getByTestId('open-compress')).toBeVisible();
  await expect(page.getByTestId('open-merge')).toHaveCount(0);
});

test('the appearance switch overrides macOS and Auto follows it again', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await bg();
  await page.getByTestId('theme-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await bg()).not.toBe(light);
  await page.getByTestId('theme-auto').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  expect(await bg()).toBe(light);
});

test.describe('narrow window', () => {
  test.use({ viewport: { width: 600, height: 900 } });
  test('the sidebar is a drawer behind the menu button', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('sidebar')).toBeHidden();
    await page.getByTestId('menu').click();
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sidebar')).toBeHidden();
    await page.getByTestId('menu').click();
    await page.getByTestId('side-group-Edit').click();
    await page.getByTestId('side-sign').click();
    await expect(page.getByTestId('tool-sign')).toBeVisible();
    await expect(page.getByTestId('sidebar')).toBeHidden();
  });
});
