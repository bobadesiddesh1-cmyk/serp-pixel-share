// Organic results swallowed by an over-claimed feature block.
//
// Reported live: a results page with Google's collapsible "Hide sponsored
// results" section showed no labels on any organic result, and nothing said
// anything was wrong. When a feature detector claims a wrapper, every organic
// inside it is skipped AND its space is explained by the wrapper, so the
// unclassified alarm stays at zero. The page reports healthy with every chip
// missing.
//
// This reproduces that shape — the results wrapped in a container the ad
// detector claims — and asserts that the extension now notices, says so on
// both surfaces, and that the diagnostic names what swallowed what.
//
// Usage: xvfb-run -a node test/run-organic-alarm.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PROFILE = (process.env.SPS_OUT || '/tmp') + '/sps-organic-alarm-profile';
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
await sw.evaluate(() => chrome.storage.local.set({
  sps_settings: { ownedDomains: ['hdfcbank.com'], viewport: 'desktop', overlayMode: 'inline', hudState: 'open' }
}));
await ctx.route('https://www.google.com/search*', r =>
  r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE }));
const settle = ms => new Promise(r => setTimeout(r, ms));

const page = await ctx.newPage();
await page.goto(SERP, { waitUntil: 'domcontentloaded' });
await settle(4500);

const panel = await ctx.newPage();
await panel.goto(`chrome-extension://${extId}/src/sidepanel/panel.html`);
await settle(1200);
const msg = m => panel.evaluate(x => new Promise(r => chrome.runtime.sendMessage(x, r)), m);

async function rescanAndRender() {
  await page.bringToFront();
  await settle(300);
  await msg({ type: 'SPS_RESCAN' });
  await settle(2500);
  const latest = await msg({ type: 'SPS_GET_LATEST' });
  await panel.evaluate(p => { renderScan(p.payload); renderAIO(p.payload); }, latest);
  await settle(300);
  return latest.payload;
}

// ---- healthy page
console.log('\nHEALTHY PAGE');
let scan = await rescanAndRender();
check('organics are recognised', scan.summary.organicCount > 0, scan.summary.organicCount + ' organics');
check('no alarm', scan.summary.organicAlarm === false);
check('nothing absorbed by an ad claim', scan.summary.absorbedByAd === 0);
check('no alarm row in the on-page readout',
  !(await page.evaluate(() => /not recognised/.test(document.querySelector('.sps-hud')?.innerText || ''))));
check('no alarm in the panel', await panel.evaluate(() => document.querySelector('#organic-alarm').hidden));

let diag = (await msg({ type: 'SPS_DIAGNOSTIC' })).diagnostic;
check('the diagnostic carries a per-result trace', Array.isArray(diag.organicTrace) && diag.organicTrace.length > 0,
  diag.organicTrace?.length + ' titles traced');
const adOutcomes = ['contains-ad-marker', 'inside-ad-container'];
check('real ad titles are traced as ads',
  diag.organicTrace.filter(t => adOutcomes.includes(t.outcome)).length > 0,
  diag.organicTrace.filter(t => adOutcomes.includes(t.outcome)).map(t => t.outcome).join(', '));
check('and never as swallowed organics',
  !diag.organicTrace.some(t => t.outcome === 'inside-claimed-block' && t.claimedAs === 'ad'));
check('the diagnostic records overlay state', diag.overlay?.chipsOnPage > 0,
  JSON.stringify(diag.overlay));

// ---- an ad outside #tads must not raise the alarm
console.log('\nAN AD OUTSIDE #tads');
await page.evaluate(() => {
  const ad = document.querySelector('#tads [data-text-ad]');
  document.querySelector('#rso').prepend(ad);   // marked ad, no #tads ancestor
});
scan = await rescanAndRender();
check('a marked ad outside #tads is not counted as a swallowed organic',
  scan.summary.absorbedByAd === 0, 'absorbedByAd ' + scan.summary.absorbedByAd);
check('so it raises no alarm', scan.summary.organicAlarm === false);
check('and the organics are untouched', scan.summary.organicCount > 0, scan.summary.organicCount + ' organics');

// ---- reproduce: the results now sit inside a container the ad detector claims
console.log('\nRESULTS WRAPPED IN AN AD-CLAIMED CONTAINER');
const moved = await page.evaluate(() => {
  const rso = document.querySelector('#rso');
  const region = document.createElement('div');
  region.setAttribute('aria-label', 'Ads');
  const inner = document.createElement('div');
  while (rso.firstChild) inner.appendChild(rso.firstChild);
  region.appendChild(inner);
  rso.appendChild(region);
  return inner.children.length;
});
check('fixture reshaped', moved > 0, moved + ' blocks moved under [aria-label="Ads"] > div');

scan = await rescanAndRender();
check('reproduces the symptom: organics are lost',
  scan.summary.organicCount === 0, scan.summary.organicCount + ' organics');
check('the alarm fires', scan.summary.organicAlarm === true);
check('and attributes it to the ad claim', scan.summary.absorbedByAd > 0, scan.summary.absorbedByAd + ' absorbed');
check('the unclassified counter alone would have missed it',
  scan.summary.unclassified === 0, 'unclassified ' + scan.summary.unclassified);

check('the on-page readout says results are not recognised',
  await page.evaluate(() => /results\s*not recognised/.test(
    (document.querySelector('.sps-hud')?.innerText || '').replace(/\s+/g, ' '))));
const flag = await panel.evaluate(() => {
  const n = document.querySelector('#organic-alarm');
  return { hidden: n.hidden, text: n.textContent };
});
check('the panel says so and points at the diagnostic',
  !flag.hidden && /absorbed into a block detected as an ad/.test(flag.text) && /diagnostic/i.test(flag.text),
  flag.text.slice(0, 90));

diag = (await msg({ type: 'SPS_DIAGNOSTIC' })).diagnostic;
const swallowed = diag.organicTrace.filter(t => t.outcome === 'inside-claimed-block' && t.claimedAs === 'ad');
check('the trace names each swallowed result', swallowed.length > 0, swallowed.map(t => t.host).join(', '));
check('and fingerprints what swallowed it',
  swallowed[0]?.swallowedBy?.attrs !== undefined && swallowed[0].swallowedBy.geometry?.height > 0,
  JSON.stringify(swallowed[0]?.swallowedBy?.parent));
check('the swallowing block is visibly the wrapper, not an ad',
  swallowed[0]?.swallowedBy?.headings?.length >= 2,
  (swallowed[0]?.swallowedBy?.headings || []).join(' | '));

await ctx.close();
console.log(failures ? `\n${failures} organic-alarm check(s) failed.` : '\nAll organic-alarm checks passed.');
process.exit(failures ? 1 : 0);
