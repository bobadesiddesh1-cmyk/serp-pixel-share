// On-page summary (HUD) controls.
//
// The pane sits on Google's page, so it has to be dismissible — and the choice
// has to survive a re-scan, because a scan rebuilds every overlay node from
// scratch. Anything held only in the DOM would pop back on the next pass.
//
// Serves the fixture at a real google.com/search URL so the declared content
// script, the real settings store and the real re-scan path are all exercised.
//
// Usage: xvfb-run -a node test/run-hud.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PROFILE = (process.env.SPS_OUT || '/tmp') + '/sps-hud-profile';
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
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto(SERP, { waitUntil: 'domcontentloaded' });
await settle(4500);

const hud = () => page.evaluate(() => {
  const n = document.querySelector('.sps-hud');
  if (!n) return { present: false };
  return {
    present: true,
    minimised: n.classList.contains('sps-hud--min'),
    rows: n.querySelectorAll('.sps-hud__row').length,
    controls: [...n.querySelectorAll('.sps-hud__ctl')].map(b => b.textContent),
  };
});
const stored = () => sw.evaluate(async () =>
  (await chrome.storage.local.get('sps_settings')).sps_settings?.hudState ?? '(unset)');
const clickCtl = label => page.evaluate(l => {
  const b = [...document.querySelectorAll('.sps-hud__ctl')].find(n => n.textContent === l);
  if (!b) return false;
  b.click();
  return true;
}, label);

console.log('\nDEFAULT');
let h = await hud();
check('summary is shown by default', h.present && !h.minimised);
check('it carries both controls', h.controls?.length === 2, (h.controls || []).join(' '));
check('it shows the readout rows', h.rows > 0, h.rows + ' rows');

console.log('\nMINIMISE');
check('minimise control clicked', await clickCtl('–'));
await settle(900);
h = await hud();
check('collapses to the pill', h.present && h.minimised);
check('the rows are gone', h.rows === 0);
check('an expand control remains', h.controls?.includes('+'));
check('the choice is persisted', (await stored()) === 'min');

console.log('\nSURVIVES A RE-SCAN');
// A scan rebuilds every overlay node. This is the regression that matters.
await page.evaluate(() => new Promise(res =>
  chrome.runtime.sendMessage({ type: 'SPS_RESCAN' }, () => res())))
  .catch(async () => {
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${extId}/src/sidepanel/panel.html`);
    await settle(1000);
    await p.evaluate(() => new Promise(res =>
      chrome.runtime.sendMessage({ type: 'SPS_RESCAN' }, () => res())));
    await p.close();
  });
await settle(3000);
h = await hud();
check('still minimised after a re-scan', h.present && h.minimised);

console.log('\nSURVIVES A RELOAD');
// The stronger claim. A re-scan reuses the content script already running, so
// in-memory state alone would pass it. A reload starts a fresh content script
// that has to read the choice back out of storage.
await page.reload({ waitUntil: 'domcontentloaded' });
await settle(4500);
h = await hud();
check('still minimised in a fresh content script', h.present && h.minimised);

console.log('\nEXPAND');
check('expand control clicked', await clickCtl('+'));
await settle(900);
h = await hud();
check('rows are back', h.present && !h.minimised && h.rows > 0, h.rows + ' rows');
check('the choice is persisted', (await stored()) === 'open');

console.log('\nHIDE');
check('hide control clicked', await clickCtl('×'));
await settle(900);
h = await hud();
check('the summary is gone from the page', !h.present);
check('the choice is persisted', (await stored()) === 'off');
check('chips are untouched — hiding the summary is not hiding the measurements',
  await page.evaluate(() => document.querySelectorAll('.sps-chip').length) > 0);

console.log('\nRESTORED FROM THE PANEL');
const panel = await ctx.newPage();
await panel.goto(`chrome-extension://${extId}/src/sidepanel/panel.html`);
await settle(1500);
check('the panel control reflects the hidden state',
  (await panel.evaluate(() => document.querySelector('#hud-state')?.value)) === 'off');
await panel.evaluate(() => {
  const sel = document.querySelector('#hud-state');
  sel.value = 'open';
  sel.dispatchEvent(new Event('change'));
});
await settle(3500);
h = await hud();
check('the summary comes back', h.present && !h.minimised);

check('no console errors throughout', errs.length === 0, errs.join(' | ') || 'clean');

await ctx.close();
console.log(failures ? `\n${failures} HUD check(s) failed.` : '\nAll HUD checks passed.');
process.exit(failures ? 1 : 0);
