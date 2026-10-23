// Captures every client-facing flow of the demo into screenshots/ (used by the README).
// Run: npm run screenshots   (DEMO_URL defaults to the live GitHub Pages demo)
import { mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'screenshots');
const DEMO = process.env.DEMO_URL || 'https://dtrinidad-iv.github.io/members-marketplace/';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await (await browser.createBrowserContext()).newPage();
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1.5 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const go = async (path) => { await page.evaluate((p) => window.MP_CONFIG.router.go(p), path); await sleep(1100); };
const top = () => page.evaluate(() => window.scrollTo(0, 0));
const settle = () => sleep(700);
let n = 0;
async function shot(name) {
  await settle();
  const file = `${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(OUT, file) });
  console.log(file);
}
async function login(email) {
  await page.type('input[name=email]', email);
  await page.type('input[name=password]', 'demo1234');
  await page.click('form.mp-auth button[type=submit]');
  await sleep(1500);
}

await page.goto(DEMO, { waitUntil: 'networkidle2' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle2' });
await sleep(1200);

// Visitors
await go('/marketplace'); await top();
await shot('visitor-marketplace-locked');
await page.click('#site-main .mp-card-hit');
await shot('visitor-join-prompt');
await page.keyboard.press('Escape');

await go('/saved'); // protected page → login?next=/saved
await shot('protected-page-redirects-to-login');
await go('/join');
await page.type('input[name=name]', 'Alex Santos');
await page.type('input[name=email]', 'alex@example.com');
await shot('signup');

// Pending member
await go('/login');
await login('pending@demo.com');
await go('/marketplace'); await top();
await shot('pending-member-awaiting-approval');
await page.click('[data-as="member@demo.com"]');
await sleep(1800);

// Active member
await top();
await shot('member-marketplace');
await page.select('select[aria-label=Category]', 'Lighting');
await sleep(900);
await page.type('input[aria-label="Maximum price"]', '200');
await sleep(1200); await top();
await shot('member-filtered-search');
await page.select('select[aria-label=Category]', '');
await page.click('input[aria-label="Maximum price"]', { clickCount: 3 });
await page.keyboard.press('Backspace');
await sleep(1200);

const cards = await page.$$('#site-main .mp-card .mp-card-hit');
await cards[2].click();
await sleep(1000);
await page.click('dialog .mp-actions .mp-save');
await shot('listing-detail-saved');
await page.keyboard.press('Escape');

await go('/saved'); await top();
await shot('saved-listings');

// Post a listing with a photo (uploads a lamp image from an existing Lighting listing)
await go('/marketplace?category=Lighting');
await (await page.$('#site-main .mp-card-media img')).screenshot({ path: join(OUT, 'rattan-pendant.png') });
await go('/sell');
await page.type('input[name=title]', 'Handwoven rattan pendant light');
await page.type('input[name=city]', 'Manila');
await page.type('input[name=price]', '120');
await page.select('select[name=category]', 'Lighting');
await page.type('textarea[name=description]', 'Natural rattan shade, 40 cm, with a 2 m cloth cord. Made to order in 2 weeks.');
await (await page.$('input[name=image]')).uploadFile(join(OUT, 'rattan-pendant.png'));
await sleep(500);
await page.evaluate(() => document.querySelector('.mp-upload').scrollIntoView({ block: 'center' }));
await shot('post-listing-with-photo');
await page.click('form.mp-sell button[type=submit]');
await sleep(2000); await top();
await shot('new-listing-live');

await go('/account'); await top();
await shot('account');

// Password reset
await page.click('#site-main .mp-account > button');
await sleep(1200);
await go('/forgot-password');
await page.type('input[name=email]', 'member@demo.com');
await page.click('form.mp-auth button[type=submit]');
await page.waitForSelector('.inbox [data-open]');
await shot('forgot-password-email-sent');
await page.click('.inbox [data-open]');
await sleep(1500);
await shot('reset-password');

// How it maps to Squarespace
await page.click('[data-as="member@demo.com"]');
await sleep(1800);
await page.click('#toggle-blocks');
await top();
await shot('squarespace-code-blocks');
await page.click('#toggle-blocks');

// Phone
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await sleep(500);
await page.evaluate(() => document.querySelector('.browser').scrollIntoView());
await shot('mobile');

rmSync(join(OUT, 'rattan-pendant.png'), { force: true });
await browser.close();
