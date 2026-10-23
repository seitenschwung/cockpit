import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const sample = () => JSON.parse(readFileSync('public/status.json', 'utf8'));
const NOW = '2026-10-23T12:02:00Z'; // sample data is old, ?now pins the clock next to it

// Serves the sample status.json (optionally changed) and opens the page.
async function open(page, mutate = () => {}, hash = '', { pinned = true } = {}) {
  await page.route('**/status.json', (route) => {
    const d = sample();
    mutate(d);
    return route.fulfill({ json: d });
  });
  await page.goto('/' + (pinned ? '?now=' + NOW : '') + hash);
  await expect(page.locator('#verdict')).not.toHaveText('Lade …');
}
const todo = (page) => page.locator('#todo');

test('healthy sample: no errors, one PR waits for review', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await expect(page.locator('#verdict')).toHaveText('Alles gut');
  await expect(todo(page)).toContainText('PR wartet auf deine Prüfung');
  expect(errors).toEqual([]);
});

test('stopped box is reported on overview and project page', async ({ page }) => {
  await open(page, (d) => { d.boxes[0].running = false; });
  await expect(todo(page)).toContainText('Box ist gestoppt.');
  await page.locator('#todo button.proj', { hasText: d0name(sample()) }).first().click();
  await expect(page.locator('#detail')).toContainText('Box ist gestoppt.');
});

test('OOM-killed box is reported', async ({ page }) => {
  await open(page, (d) => { d.boxes[1].oom_killed = true; });
  await expect(todo(page)).toContainText('Speichermangel');
});

test('old data shows "Sammler hängt"', async ({ page }) => {
  await open(page, () => {}, '', { pinned: false });
  await expect(page.locator('#notice')).toContainText('Sammler hängt');
  await expect(page.locator('#verdict')).toHaveText('Fehler');
  await expect(todo(page)).toContainText('Sammler hängt');
});

test('unknown schema is flagged', async ({ page }) => {
  await open(page, (d) => { d.schema = 2; });
  await expect(page.locator('#notice')).toContainText('Unbekanntes Schema 2');
});

test('unreachable status.json shows the empty state', async ({ page }) => {
  await page.route('**/status.json', (route) => route.abort());
  await page.goto('/?now=' + NOW);
  await expect(page.locator('#verdict')).toHaveText('Keine Daten');
  await expect(page.locator('#notice')).toContainText('nicht ladbar');
});

test('site with checked:false is "not checkable", not down', async ({ page }) => {
  const d = sample();
  const r = d.repos.find((x) => x.site && x.site.checked === false);
  test.skip(!r, 'sample has no unchecked site');
  const name = r.repo.split('/').pop();
  await open(page, () => {}, '#pg=project&p=' + name);
  await expect(page.locator('#detail')).toContainText('nicht vom Home-Server prüfbar');
  await expect(page.locator('#detail')).not.toContainText('nicht erreichbar');
  await page.goto('/?now=' + NOW);
  await expect(todo(page)).not.toContainText('Seite:');
});

test('sidebar, view switch and filters respond to clicks', async ({ page }) => {
  await open(page);
  await page.locator('#nav [data-pg=projects]').click();
  await expect(page.locator('[data-page=projects]')).toBeVisible();
  await page.locator('#view [data-view=table]').click();
  await expect(page.locator('#table table')).toBeVisible();
  await page.locator('#view [data-view=cards]').click();
  await expect(page.locator('#cards .card').first()).toBeVisible();
  await page.locator('#nav [data-pg=prs]').click();
  await expect(page.locator('#prs table')).toBeVisible();
  await page.locator('#nav [data-pg=stats]').click();
  await page.locator('#metric [data-metric=cache]').click();
  await expect(page.locator('#metric [data-metric=cache]')).toHaveAttribute('aria-pressed', 'true');
});

test('theme and density choices survive a reload', async ({ page }) => {
  await open(page);
  await page.locator('#theme [data-theme=light]').click();
  await page.locator('#density [data-density=compact]').click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
});

function d0name(d) { return d.boxes[0].project; }

test('Back button and manual hash change switch pages', async ({ page }) => {
  await open(page);
  await page.locator('#nav button[data-pg="stats"]').click();
  await page.locator('#nav button[data-pg="system"]').click();
  await expect(page.locator('[data-page="system"]')).toBeVisible();
  await expect(page.locator('#collector')).toContainText('Version 1');
  await page.goBack();
  await expect(page.locator('[data-page="stats"]')).toBeVisible();
  await page.evaluate(() => { location.hash = 'pg=prs'; });
  await expect(page.locator('[data-page="prs"]')).toBeVisible();
});

test('activity page renders the new collector fields', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, () => {}, '#pg=activity');
  await expect(page.locator('#activity .boxcurves .bc').first()).toBeVisible();
  await expect(page.locator('#activity')).toContainText('Letzte Deploys');
  await expect(page.locator('#activity')).toContainText('API-Gegenwert (nicht bezahlt)');
  await expect(page.locator('#activity')).toContainText('nicht eingetragen');
  await expect(page.locator('#activity')).toContainText('Bisher bekannt (unvollständig)');
  expect(errors).toEqual([]);
});

test('activity page copes with missing and short series', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, (d) => {
    d.host_metrics = null;
    d.disks = [];
    d.deploys = [];
    d.costs = null;
    for (const b of d.boxes) b.history = null;
    for (const r of d.repos) if (r.site) { r.site.checked = true; r.site.uptime_24h = null; r.site.tracked_since = '2026-10-23T14:40:00Z'; r.site.down_since = null; }
  }, '#pg=activity');
  await expect(page.locator('#activity')).toContainText('Keine Host-Daten.');
  await expect(page.locator('#activity')).toContainText('noch zu wenig Daten');
  expect(errors).toEqual([]);
});
