// Side-panel test.
//
// Builds a real scan payload by running the actual content pipeline over the
// fixture, then loads the real side panel in the real extension and renders
// that payload through the panel's own render functions. Verifies every
// region of the Scan and AI Overview views populates, and that the empty and
// no-GSC states behave.
//
// Usage: xvfb-run -a node test/run-panel.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = process.env.SPS_OUT || '/tmp';
const PROFILE = `${OUT}/sps-panel-profile`;

const SRC = ['src/shared/constants.js', 'src/model/estimate.js', 'src/content/measure.js',
             'src/content/aio.js', 'src/content/classifier.js', 'src/content/overlay.js'];

let failures = 0;
const check = (name, pass, detail = '') => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!pass) failures++;
};

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false, channel: 'chromium', viewport: { width: 420, height: 900 },
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, '--no-sandbox', '--no-first-run'],
});

let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
const extId = new URL(sw.url()).host;

// ---- 1. Produce a real scan payload from the fixture ----
const fx = await ctx.newPage();
await fx.setViewportSize({ width: 1920, height: 1080 });
await fx.goto('file://' + path.join(ROOT, 'test/fixture-serp.html'));
for (const f of SRC) await fx.addScriptTag({ path: path.join(ROOT, f) });

const scan = await fx.evaluate(async () => {
  const owned = ['hdfcbank.com'];
  const aio = await SPS_AIO.read(owned);
  const elements = SPS_CLASSIFY.run({ ownedDomains: owned, aioResult: aio });
  const serpHeight = SPS_MEASURE.serpHeight(), serpTop = SPS_MEASURE.serpTop();
  const typesAbove = [];
  for (const el of elements) {
    el.xLeft = SPS_MEASURE.docOffset(el.node).xLeft;
    el.pixelShare = SPS_MEASURE.pixelShare(el.height, serpHeight);
    el.foldFlags = SPS_MEASURE.foldFlags(el.yTop);
    el.estCTR = SPS_MODEL.estimate(el, [...typesAbove], 'desktop');
    if (el.type === 'organic' || el.type === 'social') el.effectivePos = SPS_MODEL.effectivePosition(el.estCTR, 'desktop');
    if (el.column !== 'right' && !['organic','sitelink','social','unclassified'].includes(el.type)) typesAbove.push(el.type);
  }
  SPS_MODEL.normalise(elements).forEach((n, i) => { elements[i].shareOfClicks = n.shareOfClicks; });
  const own = elements.find(e => e.owned && e.type === 'organic');
  const ser = e => { const { node, citations, matched, ...r } = e; return { ...r,
    citationCount: citations?.length, citations: citations?.slice(0, 12), matched: matched?.map(m => m.domain) }; };
  return {
    summary: {
      query: 'personal loan interest rate', url: location.href, scannedAt: Date.now(),
      viewport: 'desktop', realDevice: 'desktop', count: elements.length, serpHeight, serpTop,
      aioPresent: aio.present, aioCited: aio.cited, aioCitationCount: aio.citations.length,
      aioExpanded: aio.expanded, aioCitations: aio.citations,
      aioPixelShare: aio.geometry ? SPS_MEASURE.pixelShare(aio.geometry.height, serpHeight) : 0,
      unclassified: elements.filter(e => e.type === 'unclassified').length,
      ownedRank: own?.rank ?? null, ownedEffectivePos: own?.effectivePos ?? null,
      ownedCTR: own?.estCTR ?? null, ownedUrl: own?.url ?? null,
      adCount: elements.filter(e => e.type === 'ad').length,
      organicCount: elements.filter(e => e.type === 'organic').length,
    },
    elements: elements.map(ser),
  };
});
console.log(`\nScan payload built: ${scan.elements.length} elements, AIO ${scan.summary.aioPresent}, owned rank ${scan.summary.ownedRank}\n`);

// ---- 2. Panel: empty state ----
const panel = await ctx.newPage();
const errs = [];
panel.on('pageerror', e => errs.push('pageerror: ' + e.message));
panel.on('console', m => { if (m.type() === 'error') errs.push('console.error: ' + m.text()); });
await panel.goto(`chrome-extension://${extId}/src/sidepanel/panel.html`);
await panel.waitForTimeout(1500);

console.log('EMPTY STATE (no scan, no GSC)');
const empty = await panel.evaluate(() => ({
  emptyShown: !document.querySelector('#scan-empty').hidden,
  bodyHidden: document.querySelector('#scan-body').hidden,
  gsc: document.querySelector('#gsc-state').textContent.trim(),
}));
check('empty prompt visible', empty.emptyShown);
check('scan body hidden', empty.bodyHidden);
check('no-GSC degrades to a message, not a blank/throw', empty.gsc.length > 0, empty.gsc);

// ---- 3. Render the real scan through the panel's own functions ----
console.log('\nRENDERED SCAN');
await panel.evaluate(s => { renderScan(s); renderAIO(s); }, scan);
await panel.waitForTimeout(600);

const r = await panel.evaluate(() => ({
  query: document.querySelector('#scan-query').textContent.trim(),
  rank: document.querySelector('#s-rank').textContent.trim(),
  eff: document.querySelector('#s-eff').textContent.trim(),
  pxs: document.querySelector('#s-pxs').textContent.trim(),
  ctr: document.querySelector('#s-ctr').textContent.trim(),
  verdictShown: !document.querySelector('#verdict').hidden,
  verdict: document.querySelector('#verdict').textContent.trim(),
  bars: document.querySelectorAll('#bars > *').length,
  mapSegs: document.querySelectorAll('#map-col > *').length,
  mapKeys: document.querySelectorAll('#map-key > *').length,
  rows: document.querySelectorAll('#el-table tbody tr').length,
  bodyHidden: document.querySelector('#scan-body').hidden,
  aioStatus: document.querySelector('#aio-status').textContent.trim(),
  cites: document.querySelectorAll('#aio-cites > *').length,
  estLabelled: /est/i.test(document.body.innerText),
}));
check('query shown', r.query.length > 0, r.query);
check('rank metric', r.rank !== '—', r.rank);
check('effective position metric', r.eff !== '—', r.eff);
check('pixel share metric', r.pxs !== '—', r.pxs);
check('est CTR metric', r.ctr !== '—', r.ctr);
check('scan body revealed', !r.bodyHidden);
check('verdict rendered', r.verdictShown, r.verdict.slice(0, 90));
check('click-share bars', r.bars > 0, r.bars + ' bars');
check('pixel map segments', r.mapSegs > 0, r.mapSegs + ' segments');
check('pixel map key', r.mapKeys > 0, r.mapKeys + ' keys');
// renderTable deliberately omits sitelinks — they are attributes of their
// parent result, not separate listings.
const expectedRows = scan.elements.filter(e => e.type !== 'sitelink').length;
check('element table rows', r.rows === expectedRows, `${r.rows} rows vs ${expectedRows} non-sitelink elements`);
check('AIO status line', r.aioStatus.length > 0, r.aioStatus.slice(0, 70));
check('AIO citations listed', r.cites > 0, r.cites + ' citations');
check('output labelled as estimated', r.estLabelled);

await panel.screenshot({ path: `${OUT}/sps-panel-scan.png`, fullPage: true });

// ---- 4. Console hygiene ----
console.log('\nCONSOLE');
check('no page errors across empty + rendered states', errs.length === 0, errs.join(' | ') || 'clean');

await ctx.close();
console.log(`\n${failures ? 'FAILURES: ' + failures : 'All panel checks passed.'}`);
process.exit(failures ? 1 : 0);
