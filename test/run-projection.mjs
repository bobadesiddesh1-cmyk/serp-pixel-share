// Mobile projection honesty.
//
// Google serves the mobile layout only to a mobile user agent. On a desktop
// render the extension projects mobile positions from desktop geometry using
// constants nobody has calibrated. That is legitimate — but every surface that
// shows the result has to say so, because the number is otherwise
// indistinguishable from a measurement.
//
// Usage: xvfb-run -a node test/run-projection.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PROFILE = (process.env.SPS_OUT || '/tmp') + '/sps-projection-profile';
const FIXTURE = fs.readFileSync(path.join(ROOT, 'test/fixture-serp.html'), 'utf8');
const SERP = 'https://www.google.com/search?q=personal+loan+interest+rate';

let failures = 0;
const check = (name, pass, detail = '') => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!pass) failures++;
};

fs.rmSync(PROFILE, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false, channel: 'chromium', viewport: { width: 1400, height: 950 },
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`,
         '--no-sandbox', '--no-first-run'],
});
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
const extId = new URL(sw.url()).host;
await ctx.route('https://www.google.com/search*', r =>
  r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE }));
const settle = ms => new Promise(r => setTimeout(r, ms));

const setViewport = vp => sw.evaluate(async v => {
  const got = await chrome.storage.local.get('sps_settings');
  await chrome.storage.local.set({
    sps_settings: { ...(got.sps_settings || {}), ownedDomains: ['hdfcbank.com'], viewport: v }
  });
}, vp);

const page = await ctx.newPage();
const panel = await ctx.newPage();
await panel.goto(`chrome-extension://${extId}/src/sidepanel/panel.html`);
await settle(1200);

async function scanWith(vp) {
  await setViewport(vp);
  await page.bringToFront();
  await page.goto(SERP, { waitUntil: 'domcontentloaded' });
  await settle(4500);
  const latest = await panel.evaluate(() => new Promise(r =>
    chrome.runtime.sendMessage({ type: 'SPS_GET_LATEST' }, r)));
  await panel.evaluate(p => { renderScan(p.payload); renderAIO(p.payload); }, latest);
  await settle(400);
  return latest.payload;
}

// ---- desktop: everything is measured
console.log('\nDESKTOP RENDER, DESKTOP FOLD REFERENCE');
let scan = await scanWith('desktop');
check('scan is not flagged as projected', scan.summary.projected === false);
check('the render width is recorded', scan.summary.renderWidth > 0, scan.summary.renderWidth + 'px');
check('no projection note in the panel',
  await panel.evaluate(() => document.querySelector('#proj-note').hidden));
check('no projection row in the on-page readout',
  !(await page.evaluate(() => /projected/i.test(document.querySelector('.sps-hud')?.innerText || ''))));
check('the clipboard summary says measured',
  /Measured with SERP Pixel Share/.test(await panel.evaluate(() => scanSummaryText())));

// ---- mobile fold reference on a desktop render: projected
console.log('\nDESKTOP RENDER, MOBILE FOLD REFERENCE');
scan = await scanWith('mobile');
check('scan is flagged as projected', scan.summary.projected === true);
check('the real device is still reported as desktop', scan.summary.realDevice === 'desktop');

const note = await panel.evaluate(() => {
  const n = document.querySelector('#proj-note');
  return { hidden: n.hidden, text: n.textContent };
});
check('the panel says projected, not measured', !note.hidden && /Projected, not measured/.test(note.text));
check('and names the width it was projected from',
  new RegExp(String(scan.summary.renderWidth)).test(note.text.replace(/,/g, '')), note.text.slice(0, 80));

check('the on-page readout carries the flag too',
  await page.evaluate(() => /mobile\s+projected/i.test(
    (document.querySelector('.sps-hud')?.innerText || '').replace(/\s+/g, ' '))));

const summary = await panel.evaluate(() => scanSummaryText());
check('the clipboard text carries the caveat, in capitals',
  /PROJECTED from a desktop render/.test(summary));
check('and does not sign off as measured',
  /Projected with SERP Pixel Share/.test(summary) && !/Measured with SERP Pixel Share/.test(summary));

// ---- the geometry genuinely differs, or the flag would be decoration
const own = scan.elements.find(e => e.owned && e.type === 'organic');
check('projected y differs from the measured y it came from',
  own && own.mobileY !== own.yTop, own ? `${own.yTop}px measured vs ${own.mobileY}px projected` : 'no owned result');

await ctx.close();
console.log(failures ? `\n${failures} projection check(s) failed.` : '\nAll projection checks passed.');
process.exit(failures ? 1 : 0);
