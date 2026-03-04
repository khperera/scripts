const { test, expect } = require('@playwright/test');
const path = require('path');

const APP_URL = `file://${path.resolve(__dirname, '../index.html')}`;

test.describe('Hamburger Menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('#hamburgerBtn');
  });

  test('menu starts hidden on page load', async ({ page }) => {
    const menu = page.locator('#hamburgerMenu');
    await expect(menu).toHaveAttribute('hidden', '');
    await expect(menu).not.toBeVisible();
  });

  test('clicking hamburger button opens the menu', async ({ page }) => {
    const btn = page.locator('#hamburgerBtn');
    const menu = page.locator('#hamburgerMenu');

    await expect(menu).not.toBeVisible();
    await btn.click();

    await expect(menu).toBeVisible();
    await expect(menu).not.toHaveAttribute('hidden', '');
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  test('clicking hamburger button again closes the menu', async ({ page }) => {
    const btn = page.locator('#hamburgerBtn');
    const menu = page.locator('#hamburgerMenu');

    await btn.click();
    await expect(menu).toBeVisible();

    await btn.click();
    await expect(menu).not.toBeVisible();
    await expect(menu).toHaveAttribute('hidden', '');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  test('hamburger icon switches between ☰ and ✕', async ({ page }) => {
    const btn = page.locator('#hamburgerBtn');

    await expect(btn).toContainText('☰');

    await btn.click();
    await expect(btn).toContainText('✕');

    await btn.click();
    await expect(btn).toContainText('☰');
  });

  test('clicking outside the menu closes it', async ({ page }) => {
    const btn = page.locator('#hamburgerBtn');
    const menu = page.locator('#hamburgerMenu');

    await btn.click();
    await expect(menu).toBeVisible();

    // Click well below the open menu (which overlays the top of the viewport)
    await page.mouse.click(200, 600);

    await expect(menu).not.toBeVisible();
    await expect(menu).toHaveAttribute('hidden', '');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(btn).toContainText('☰');
  });

  const tabs = [
    { page: 'today',           sectionId: 'page-today' },
    { page: 'templates',       sectionId: 'page-templates' },
    { page: 'exercises',       sectionId: 'page-exercises' },
    { page: 'history',         sectionId: 'page-history' },
    { page: 'settings',        sectionId: 'page-settings' },
    { page: 'rpe-schedule',    sectionId: 'page-rpe-schedule' },
    { page: 'rep-progression', sectionId: 'page-rep-progression' },
    { page: 'analytics',       sectionId: 'page-analytics' },
  ];

  for (const { page: tabPage, sectionId } of tabs) {
    test(`clicking "${tabPage}" tab closes menu and shows #${sectionId}`, async ({ page }) => {
      const btn = page.locator('#hamburgerBtn');
      const menu = page.locator('#hamburgerMenu');

      await btn.click();
      await expect(menu).toBeVisible();

      await page.locator(`.tab[data-page="${tabPage}"]`).click();

      await expect(menu).not.toBeVisible();
      await expect(menu).toHaveAttribute('hidden', '');
      await expect(btn).toHaveAttribute('aria-expanded', 'false');

      await expect(page.locator(`#${sectionId}`)).toBeVisible();
      await expect(page.locator(`.tab[data-page="${tabPage}"]`)).toHaveClass(/active/);
    });
  }
});
