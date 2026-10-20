import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const mini = fileURLToPath(new URL('../../examples/mini-incident.jsonl', import.meta.url));
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#incident-title')).toHaveText('Checkout latency spike');
  await expect(page.locator('#event-count')).toHaveText('1,084');
  await expect(page.locator('#main')).toHaveAttribute('aria-busy', 'false');
});
test('virtualized list, service and severity filters, undo, and responsive layout', async ({ page }) => {
  expect(await page.locator('.event-row').count()).toBeLessThan(30);
  await page.getByLabel('payment-service', { exact: false }).check();
  await page.locator('.severity-chip[data-level="error"]').click();
  await expect.poll(async () => Number((await page.locator('#event-count').textContent()).replaceAll(',', ''))).toBeGreaterThan(0);
  await expect(page.locator('.event-row .level-label').first()).toHaveText('ERROR');
  for (const row of await page.locator('.event-row').all()) {
    await expect(row.locator('.event-service')).toHaveText('payment-service');
    await expect(row.locator('.level-label')).toHaveText('ERROR');
  }
  await page.getByRole('button', { name: 'Undo view change' }).click();
  await expect(page.locator('.severity-chip[data-level="error"]')).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Redo view change' }).click();
  await expect(page.locator('.severity-chip[data-level="error"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('keyboard selection, notes, bookmarks, and session recovery', async ({ page }) => {
  await page.locator('#event-list').focus(); await page.keyboard.press('ArrowDown');
  await expect(page.locator('#notes-area')).toBeVisible();
  await page.locator('#event-note').fill('Investigate this request');
  await page.locator('#bookmark-event').click();
  await expect(page.locator('#bookmark-event')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#save-status')).toHaveText('Saved on this device');
  await page.reload();
  await expect(page.locator('#event-note')).toHaveValue('Investigate this request');
  await expect(page.locator('#bookmark-event')).toHaveAttribute('aria-pressed', 'true');
});
test('import, replay, search, and lossless export', async ({ page }) => {
  await page.getByRole('button', { name: 'Import logs' }).click();
  await page.locator('#file-input').setInputFiles(mini);
  await page.getByRole('button', { name: 'Import file', exact: true }).click();
  await expect(page.locator('#event-count')).toHaveText('5');
  await expect(page.locator('#main')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Return to start' }).click();
  await expect(page.locator('#event-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Advance to next event' }).click();
  await expect(page.locator('#event-count')).toHaveText('2');
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await page.getByRole('searchbox').fill('timed out');
  await expect(page.locator('#event-count')).toHaveText('1');
  await page.locator('.event-row').click();
  await page.locator('#event-note').fill('Retry policy review');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-button').click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(exported.events).toHaveLength(5);
  expect(exported.notes['demo-3']).toBe('Retry policy review');
  expect(exported.view.query).toBe('timed out');
});
test('offline reload restores cached shell and saved investigation', async ({ page, context }) => {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.locator('#save-status')).toHaveText('Saved on this device');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#incident-title')).toHaveText('Checkout latency spike');
  await expect(page.locator('#event-count')).toHaveText('1,084');
  await expect(page.locator('#main')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#search-input').fill('pool');
  await expect.poll(async () => Number((await page.locator('#event-count').textContent()).replaceAll(',', ''))).toBeLessThan(1084);
});
test('invalid imports leave the existing investigation intact and dialogs close with Escape', async ({ page }) => {
  await page.locator('#import-button').click();
  await page.locator('#file-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('[{"timestamp":"not-a-date"}]') });
  await page.locator('#confirm-import').click();
  await expect(page.locator('#import-error')).toContainText('timestamp');
  await page.keyboard.press('Escape');
  await expect(page.locator('#import-dialog')).not.toBeVisible();
  await expect(page.locator('#incident-title')).toHaveText('Checkout latency spike');
  await expect(page.locator('#event-count')).toHaveText('1,084');
});
test('imported markup is displayed as text', async ({ page }) => {
  await page.locator('#import-button').click();
  const events = [{ id: 'unsafe', timestamp: 0, message: '<img src=x onerror="window.__injected=true">', metadata: { text: '<script>alert(1)</script>' } }];
  await page.locator('#file-input').setInputFiles({ name: 'escaped.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(events)) });
  await page.locator('#confirm-import').click();
  await expect(page.locator('#event-count')).toHaveText('1');
  await expect(page.locator('#main')).toHaveAttribute('aria-busy', 'false');
  await page.locator('.event-row').click();
  await expect(page.locator('.detail-message')).toContainText('<img');
  await expect(page.locator('#details-content img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__injected)).toBeUndefined();
});
