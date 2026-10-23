// End-to-end test of the clickable demo (dist/marketplace-demo.html, mock backend)
// in headless Chrome. Run: npm run test:e2e   (CHROME_PATH overrides the browser)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = pathToFileURL(resolve(ROOT, 'dist/marketplace-demo.html')).href;
const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(existsSync);

let browser;
let page;
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const address = () => page.$eval('#address', (e) => e.textContent.replace('https://members.makersguild.com', ''));
const count = (sel) => page.$$eval(sel, (els) => els.length);
const text = (sel) => page.$eval(sel, (e) => e.textContent.trim());
const go = async (path) => { await page.evaluate((p) => window.MP_CONFIG.router.go(p), path); await sleep(800); };
const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn().catch(() => false)) return; await sleep(100); }
  throw new Error('timed out waiting for condition');
};

async function login(email) {
  await page.type('input[name=email]', email);
  await page.type('input[name=password]', 'demo1234');
  await page.click('form.mp-auth button[type=submit]');
}

before(async () => {
  assert.ok(CHROME, 'Chrome not found. Set CHROME_PATH.');
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport({ width: 1300, height: 900 });
  await page.goto(DEMO);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await sleep(1000);
});

after(async () => { await browser?.close(); });

test('visitors only get locked teaser cards', async () => {
  assert.equal(await count('#site-main .mp-card'), 4);
  assert.equal(await count('#site-main .mp-card-locked'), 4);
  assert.equal(await count('#site-main .mp-card img'), 0);
});

test('protected page redirects to login and back after sign-in', async () => {
  await go('/saved');
  assert.equal(await address(), '/login?next=/saved');
  await login('member@demo.com');
  await until(async () => (await address()) === '/saved');
  await until(async () => (await count('#site-main .mp-card')) === 1);
});

test('members can filter, search and deep-link a listing', async () => {
  await go('/marketplace');
  await until(async () => (await count('#site-main .mp-card img')) > 0);
  await page.select('select[aria-label=Category]', 'Ceramics');
  await until(async () => (await text('.mp-count')) === '2 listings');
  assert.match(await address(), /category=Ceramics/);
  await page.type('input[type=search]', 'mugs');
  await until(async () => (await text('.mp-count')) === '1 listing');
  await page.click('#site-main .mp-card .mp-card-hit');
  await until(async () => (await text('dialog .mp-detail-title')) === 'Set of 4 matte mugs');
  assert.match(await address(), /listing=l-08/);
});

test('saving is optimistic and shows on the saved page', async () => {
  await page.click('dialog .mp-actions .mp-save');
  await until(async () => (await page.$eval('dialog .mp-actions .mp-save', (b) => b.getAttribute('aria-pressed'))) === 'true');
  await page.keyboard.press('Escape');
  await go('/saved');
  await until(async () => (await count('#site-main .mp-card')) === 2);
});

test('pending members are gated until an admin approves them', async () => {
  await page.click('[data-as="pending@demo.com"]');
  await until(async () => (await text('#site-main .mp-gate strong')).includes('pending approval'));
  assert.equal(await count('#site-main .mp-card img'), 0);
  await page.click('[data-status="active"]');
  await until(async () => (await count('#site-main .mp-card img')) > 0);
});

test('active members can post a listing', async () => {
  await go('/sell');
  await page.type('input[name=title]', 'E2E test lamp');
  await page.type('input[name=city]', 'Manila');
  await page.type('input[name=price]', '45');
  await page.click('form.mp-sell button[type=submit]');
  await until(async () => (await address()) === '/marketplace');
  await until(async () => (await text('#site-main .mp-card .mp-card-title')) === 'E2E test lamp');
});

test('signing out on a protected page goes to login', async () => {
  await go('/account');
  await page.click('#site-main .mp-account > button');
  await until(async () => (await address()) === '/login');
});

test('password reset via emailed link', async () => {
  await go('/forgot-password');
  await page.type('input[name=email]', 'member@demo.com');
  await page.click('form.mp-auth button[type=submit]');
  await page.waitForSelector('.inbox [data-open]');
  await page.click('.inbox [data-open]');
  await until(async () => (await text('#site-main .mp-auth-title')) === 'Choose a new password');
  await page.type('input[name=password]', 'newpass99');
  await page.click('form.mp-auth button[type=submit]');
  await until(async () => (await address()) === '/marketplace');
});

test('no horizontal scroll at phone width', async () => {
  await page.setViewport({ width: 390, height: 844 });
  await sleep(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
});

test('no console errors', () => {
  assert.deepEqual(errors, []);
});
