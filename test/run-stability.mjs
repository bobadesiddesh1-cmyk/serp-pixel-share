// Stability test — the rescan loop.
//
// Reproduces the reported failure: the scan renders overlay nodes and clicks
// the AI Overview expander, both of which mutate the page, so an observer that
// listens to its own side effects re-triggers forever and the page visibly
// churns.
//
// Loads the real content-script sources plus a faithful copy of index.js's
// observer contract, drives a page that mutates on its own the way Google does,
// and asserts the scan count converges.
//
// Usage: node test/run-stability.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = ['src/shared/constants.js', 'src/model/estimate.js', 'src/content/measure.js',
             'src/content/aio.js', 'src/content/classifier.js', 'src/content/overlay.js'];

let failures = 0;
const check = (n, p, d = '') => { console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!p) failures++; };

const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('file://' + path.join(ROOT, 'test/fixture-serp.html'));
await page.addStyleTag({ path: path.join(ROOT, 'src/content/overlay.css') });
await page.addScriptTag({ content: `window.chrome = { runtime: { sendMessage(){}, onMessage:{ addListener(){} } } };` });
for (const f of SRC) await page.addScriptTag({ path: path.join(ROOT, f) });

const result = await page.evaluate(async () => {
  const state = { busy: false, scans: 0, clicks: 0, renders: 0, overlaySig: null };

  // Count expander clicks so we can prove expansion happens once, not per scan.
  document.addEventListener('click', e => {
    if (e.target.closest('[role="button"][aria-expanded]')) state.clicks++;
  }, true);

  const MIN_RESCAN_GAP = 3000;
  let debounce, lastScanAt = 0, observing = false;

  const isOurs = node => {
    if (!node || node.nodeType !== 1) return false;
    if (node.id === 'sps-overlay-root') return true;
    const cls = typeof node.className === 'string' ? node.className : '';
    if (cls.startsWith('sps-') || cls.includes(' sps-')) return true;
    return !!(node.closest && node.closest('#sps-overlay-root, .sps-hud'));
  };

  const obs = new MutationObserver(records => {
    const relevant = records.some(r => r.type === 'childList' && !isOurs(r.target) &&
      [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === 1 && !isOurs(n)));
    if (!relevant) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (state.busy) return;
      const since = Date.now() - lastScanAt;
      if (since < MIN_RESCAN_GAP) {
        clearTimeout(debounce);
        debounce = setTimeout(() => { if (!state.busy) scan(); }, MIN_RESCAN_GAP - since);
        return;
      }
      scan();
    }, 900);
  });
  const target = document.querySelector('#center_col');
  const start = () => { if (!observing) { observing = true; obs.observe(target, { childList: true, subtree: true }); } };
  const stop = () => { if (observing) { observing = false; obs.disconnect(); } };

  async function scan() {
    if (state.busy) return;
    state.busy = true; stop(); state.scans++;
    try {
      const owned = ['hdfcbank.com'];
      const aio = await SPS_AIO.read(owned);
      const elements = SPS_CLASSIFY.run({ ownedDomains: owned, aioResult: aio });
      const serpHeight = SPS_MEASURE.serpHeight(), serpTop = SPS_MEASURE.serpTop();
      const typesAbove = [];
      for (const el of elements) {
        el.xLeft = SPS_MEASURE.docOffset(el.node).xLeft;
        el.pixelShare = SPS_MEASURE.pixelShare(el.height, serpHeight);
        el.estCTR = SPS_MODEL.estimate(el, [...typesAbove], 'desktop');
        if (el.column !== 'right' && !['organic','sitelink','social','unclassified'].includes(el.type)) typesAbove.push(el.type);
      }
      const sig = elements.map(e => `${e.type}:${e.yTop}:${e.height}:${Math.round((e.estCTR||0)*1e4)}`).join('|') + '|inline|desktop';
      if (sig !== state.overlaySig) {
        state.overlaySig = sig; state.renders++;
        SPS_OVERLAY.render(elements, { settings: { overlayMode: 'inline', viewport: 'desktop' },
          summary: { count: elements.length, serpHeight, aioPresent: aio.present, aioCited: aio.cited,
                     ownedRank: null, ownedEffectivePos: null, ownedCTR: null, unclassified: 0 },
          serpHeight, serpTop, showSitelinks: false });
      }
    } finally {
      state.busy = false; lastScanAt = Date.now();
      setTimeout(start, 400);
    }
  }

  start();
  await scan();                       // initial pass

  // Google-like churn: short BURSTS separated by quiet gaps, the way an AI
  // Overview streams in and lazy content settles. Continuous mutation would
  // just keep resetting the debounce and never let a rescan fire, which would
  // make this test pass for the wrong reason. Bursts let the debounce expire.
  const churn = setInterval(() => {
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('div');
      d.textContent = 'lazy';
      target.appendChild(d);
      setTimeout(() => d.remove(), 100);
    }
  }, 1600);

  await new Promise(r => setTimeout(r, 9000));
  clearInterval(churn);
  await new Promise(r => setTimeout(r, 1500));

  return { scans: state.scans, clicks: state.clicks, renders: state.renders,
           overlayNodes: document.querySelectorAll('#sps-overlay-root > *').length };
});

console.log('\nSTABILITY (10.5s with continuous DOM churn in #center_col)');
console.log(`  scans: ${result.scans} | overlay renders: ${result.renders} | expander clicks: ${result.clicks}`);

// 10.5s at a 3s floor allows at most ~4 scans. A runaway loop produces far more.
check('scan count bounded by the rescan floor', result.scans <= 5, `${result.scans} scans`);
check('AI Overview expanded at most once, not once per scan', result.clicks <= 1, `${result.clicks} clicks`);
check('overlay redrawn only when layout changed', result.renders <= 2, `${result.renders} renders`);
check('overlay still present and not duplicated', result.overlayNodes > 0 && result.overlayNodes < 60, `${result.overlayNodes} nodes`);
check('no console errors', errors.length === 0, errors.join(' | ') || 'clean');

await browser.close();
console.log(`\n${failures ? 'FAILURES: ' + failures : 'Stable.'}`);
process.exit(failures ? 1 : 0);
