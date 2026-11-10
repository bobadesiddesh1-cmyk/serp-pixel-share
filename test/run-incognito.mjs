// Incognito behaviour.
//
// Serves the fixture at a real google.com/search URL so the DECLARED content
// script runs, rather than hand-injecting it the way the other tests do — the
// injection path is half of what is being tested here.
//
// Three claims:
//   1. With incognito access granted, results pages in incognito are measured.
//   2. An incognito scan is never written to chrome.storage.local. The
//      extension runs in spanning mode, so that store is shared with the normal
//      window and anything written there outlives the incognito session.
//   3. Re-scan acts on the window the user is looking at, and never crosses
//      between incognito and normal when a results page is open in both.
//
// Usage: xvfb-run -a node test/run-incognito.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PROFILE = (process.env.SPS_OUT || '/tmp') + '/sps-incognito-profile';
const FIXTURE = fs.readFileSync(path.join(ROOT, 'test/fixture-serp.html'), 'utf8');
const url = q => `https://www.google.com/search?q=${q}`;
const NORMAL_Q = 'normal window query';
const INCOG_Q = 'incognito window query';

let failures = 0;
const check = (name, pass, detail = '') => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!pass) failures++;
};

fs.rmSync(PROFILE, { recursive: true, force: true });
const launch = () => chromium.launchPersistentContext(PROFILE, {
  headless: false, channel: 'chromium', viewport: { width: 1400, height: 950 },
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`,
         '--no-sandbox', '--no-first-run'],
});

// First launch only exists to learn the id and let Chrome write its profile.
let ctx = await launch();
let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
const extId = new URL(sw.url()).host;
await ctx.close();

// Grant incognito access by writing the same preference the chrome://extensions
// toggle writes. There is no API for this; it is a user decision by design.
const prefsPath = path.join(PROFILE, 'Default', 'Preferences');
const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
prefs.extensions.settings[extId].incognito = true;
fs.writeFileSync(prefsPath, JSON.stringify(prefs));

ctx = await launch();
sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
await ctx.route('https://www.google.com/search*', r =>
  r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE }));

const settle = ms => new Promise(r => setTimeout(r, ms));

// ---- a results page in a normal window
console.log('\nNORMAL WINDOW');
const normalPage = await ctx.newPage();
await normalPage.goto(url(NORMAL_Q.replace(/ /g, '+')), { waitUntil: 'domcontentloaded' });
await settle(4500);
check('overlay renders', await normalPage.evaluate(() => document.querySelectorAll('.sps-chip').length) > 0);
check('scan is logged', (await sw.evaluate(async () =>
  Object.keys((await chrome.storage.local.get('sps_scans')).sps_scans || {})
)).includes(NORMAL_Q));

// ---- a results page in an incognito window, opened by the extension so that
// its incognito-ness is established by Chrome rather than assumed by the test
console.log('\nINCOGNITO WINDOW');
const incogPagePromise = ctx.waitForEvent('page', { timeout: 25000 });
const win = await sw.evaluate(async u => {
  const w = await chrome.windows.create({ url: u, incognito: true });
  return { id: w.id, incognito: w.incognito };
}, url(INCOG_Q.replace(/ /g, '+')));
check('window really is incognito', win.incognito === true);

const incogPage = await incogPagePromise;
const errs = [];
incogPage.on('pageerror', e => errs.push('pageerror: ' + e.message));
incogPage.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await incogPage.waitForLoadState('domcontentloaded').catch(() => {});
await settle(5000);

const chips = await incogPage.evaluate(() => document.querySelectorAll('.sps-chip').length);
check('content script runs and the overlay renders', chips > 0, chips + ' chips');
check('HUD renders', await incogPage.evaluate(() => !!document.querySelector('.sps-hud')));
check('no console errors', errs.length === 0, errs.join(' | ') || 'clean');

// The claim that matters: measured, shown, but never persisted.
const keys = await sw.evaluate(async () =>
  Object.keys((await chrome.storage.local.get('sps_scans')).sps_scans || {}));
check('incognito scan is NOT in the scan log', !keys.includes(INCOG_Q), 'log: [' + keys.join(', ') + ']');
check('the normal scan is still there', keys.includes(NORMAL_Q));

// ---- Re-scan follows the focused window and does not cross contexts
console.log('\nRE-SCAN TARGETING');
const panel = await ctx.newPage();
await panel.goto(`chrome-extension://${extId}/src/sidepanel/panel.html`);
await settle(1200);

async function rescanUnderFocus(windowId) {
  await sw.evaluate(id => chrome.windows.update(id, { focused: true }), windowId);
  await settle(900);
  await panel.evaluate(() => new Promise(res =>
    chrome.runtime.sendMessage({ type: 'SPS_RESCAN' }, () => res())));
  await settle(2500);
  const r = await panel.evaluate(() => new Promise(res =>
    chrome.runtime.sendMessage({ type: 'SPS_GET_LATEST' }, res)));
  return { query: r?.payload?.summary?.query ?? null, incognito: r?.incognito === true };
}

const normalWindowId = await sw.evaluate(async () => {
  const [t] = await chrome.tabs.query({ url: '*://www.google.com/search*' });
  return t.windowId;
});

const underIncog = await rescanUnderFocus(win.id);
check('re-scan with the incognito window focused measures the incognito page',
  underIncog.query === INCOG_Q, 'got: ' + underIncog.query);
check('the result is flagged incognito, so the panel can say it is not logged',
  underIncog.incognito === true);

const underNormal = await rescanUnderFocus(normalWindowId);
check('re-scan with the normal window focused measures the normal page',
  underNormal.query === NORMAL_Q, 'got: ' + underNormal.query);

const finalKeys = await sw.evaluate(async () =>
  Object.keys((await chrome.storage.local.get('sps_scans')).sps_scans || {}));
check('re-scanning in incognito still wrote nothing to the log',
  !finalKeys.includes(INCOG_Q), 'log: [' + finalKeys.join(', ') + ']');

// The case that actually exercises the cross-context fallback. Above, the
// focused tab was itself a results page, so the fallback never ran and the old
// selector passed by luck. Here the focused incognito tab is NOT a results
// page, which is the ordinary state of affairs — you are reading the article
// you just clicked. The old code dropped to "first matching tab in the whole
// profile" and measured the normal window's page instead.
console.log('\nCROSS-CONTEXT FALLBACK');
const sidePage = await ctx.newPage();   // lands in the normal window
await sidePage.goto('https://www.google.com/robots.txt').catch(() => {});

const incogBlank = await sw.evaluate(async id => {
  const t = await chrome.tabs.create({ windowId: id, url: 'about:blank', active: true });
  return t.id;
}, win.id);
await settle(1200);

const fellBack = await rescanUnderFocus(win.id);
check('with a non-results tab focused in incognito, re-scan stays in incognito',
  fellBack.query === INCOG_Q || fellBack.query === null,
  'got: ' + fellBack.query + (fellBack.query === NORMAL_Q ? '  <= CROSSED INTO THE NORMAL WINDOW' : ''));
check('and never reports the normal window as the incognito result',
  fellBack.query !== NORMAL_Q);
await sw.evaluate(id => chrome.tabs.remove(id), incogBlank);

await ctx.close();
console.log(failures ? `\n${failures} incognito check(s) failed.` : '\nAll incognito checks passed.');
process.exit(failures ? 1 : 0);
