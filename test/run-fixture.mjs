// Pipeline test against the synthetic fixture.
//
// Loads the ACTUAL content-script sources (no mocks of our own code) into a
// local fixture page, runs classify -> measure -> estimate -> overlay, and
// reports the element table plus overlay geometry at three viewport widths.
//
// What this proves: the pipeline runs, geometry is sane, the model is applied
// in y order, the overlay renders and does not overlap the results column.
// What this does NOT prove: that the selectors match real google.com markup.
//
// Usage:  node test/run-fixture.mjs [--mode inline|boxes]

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MODE = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1] : 'inline';
const OUT = process.env.SPS_OUT || '/tmp';

const SRC = [
  'src/shared/constants.js',
  'src/model/estimate.js',
  'src/content/measure.js',
  'src/content/aio.js',
  'src/content/classifier.js',
  'src/content/overlay.js',
];

const WIDTHS = [
  { name: '1920', width: 1920, height: 1080 },
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
];

const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--no-sandbox'] });
let failures = 0;

for (const vp of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('file://' + path.join(ROOT, 'test/fixture-serp.html'));
  await page.addStyleTag({ path: path.join(ROOT, 'src/content/overlay.css') });

  // Minimal chrome.* surface: the overlay's HUD button and nothing else.
  await page.addScriptTag({ content: `window.chrome = { runtime: { sendMessage(){}, onMessage:{ addListener(){} } } };` });
  for (const f of SRC) await page.addScriptTag({ path: path.join(ROOT, f) });

  const result = await page.evaluate(async (mode) => {
    const owned = ['hdfcbank.com'];
    const aio = await SPS_AIO.read(owned);
    const elements = SPS_CLASSIFY.run({ ownedDomains: owned, aioResult: aio });

    const serpHeight = SPS_MEASURE.serpHeight();
    const serpTop = SPS_MEASURE.serpTop();
    const typesAbove = [];
    for (const el of elements) {
      el.xLeft = SPS_MEASURE.docOffset(el.node).xLeft;
      el.pixelShare = SPS_MEASURE.pixelShare(el.height, serpHeight);
      el.foldFlags = SPS_MEASURE.foldFlags(el.yTop);
      el.estCTR = SPS_MODEL.estimate(el, [...typesAbove], 'desktop');
      if (el.type === 'organic' || el.type === 'social') {
        el.effectivePos = SPS_MODEL.effectivePosition(el.estCTR, 'desktop');
      }
      // Mirrors src/content/index.js exactly, including the right-column rule.
      if (el.column !== 'right' &&
          !['organic', 'sitelink', 'social', 'unclassified'].includes(el.type)) {
        typesAbove.push(el.type);
      }
    }
    const normalised = SPS_MODEL.normalise(elements);
    normalised.forEach((n, i) => { elements[i].shareOfClicks = n.shareOfClicks; });

    const summary = {
      query: 'personal loan interest rate',
      count: elements.length,
      serpHeight, serpTop,
      aioPresent: aio.present, aioCited: aio.cited,
      aioCitationCount: aio.citations.length, aioExpanded: aio.expanded,
      unclassified: elements.filter(e => e.type === 'unclassified').length,
      ownedRank: elements.find(e => e.owned && e.type === 'organic')?.rank ?? null,
      ownedEffectivePos: elements.find(e => e.owned && e.type === 'organic')?.effectivePos ?? null,
      ownedCTR: elements.find(e => e.owned && e.type === 'organic')?.estCTR ?? null,
    };

    // Baseline width BEFORE the overlay exists, so we can attribute any
    // horizontal overflow to the overlay rather than to the page itself.
    const widthBefore = document.documentElement.scrollWidth;

    SPS_OVERLAY.render(elements, {
      settings: { overlayMode: mode, viewport: 'desktop' },
      summary, serpHeight, serpTop, showSitelinks: false,
    });

    // Does the overlay overlap the results column? That is the layout-break test.
    const col = document.querySelector('#center_col').getBoundingClientRect();
    const overlaps = [...document.querySelectorAll('.sps-label')].filter(n => {
      const r = n.getBoundingClientRect();
      return r.left < col.right && r.right > col.left;
    }).length;

    return {
      summary,
      citations: aio.citations.map(c => c.domain),
      overlayNodes: document.querySelectorAll('#sps-overlay-root > *').length,
      hud: !!document.querySelector('.sps-hud'),
      labelOverlaps: overlaps,
      widthBefore,
      docScrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      rows: elements.map(e => ({
        type: e.type, rank: e.rank ?? '', y: e.yTop, h: e.height,
        domain: e.domain || '', ctr: e.estCTR, eff: e.effectivePos ?? '', owned: !!e.owned,
      })),
    };
  }, MODE);

  console.log(`\n${'='.repeat(78)}\nVIEWPORT ${vp.name}px   overlay mode: ${MODE}\n${'='.repeat(78)}`);
  console.log('type              rank        y      h   domain                     est.CTR  eff');
  console.log('-'.repeat(78));
  for (const r of result.rows) {
    console.log(
      String(r.type).padEnd(17) + String(r.rank).padEnd(5) +
      String(r.y).padStart(7) + String(r.h).padStart(7) + '   ' +
      String(r.domain).slice(0, 24).padEnd(26) +
      (r.ctr != null ? (r.ctr * 100).toFixed(2) + '%' : '—').padStart(7) +
      String(r.eff).padStart(5) + (r.owned ? '  <= OWNED' : ''));
  }
  const s = result.summary;
  console.log('-'.repeat(78));
  console.log(`elements ${s.count} | unclassified ${s.unclassified} | serpHeight ${s.serpHeight}`);
  console.log(`AIO present ${s.aioPresent} | expanded ${s.aioExpanded} | citations ${s.aioCitationCount} [${result.citations.join(', ')}] | cites you: ${s.aioCited}`);
  console.log(`owned rank ${s.ownedRank} -> effective ${s.ownedEffectivePos} | est CTR ${s.ownedCTR != null ? (s.ownedCTR * 100).toFixed(2) + '%' : '—'}`);
  console.log(`overlay nodes ${result.overlayNodes} | HUD ${result.hud} | labels overlapping results column: ${result.labelOverlaps}`);
  const added = result.docScrollW - result.widthBefore;
  console.log(`scrollWidth before overlay ${result.widthBefore} -> after ${result.docScrollW} (viewport ${vp.width})`);
  console.log(`width added BY THE OVERLAY: ${added}px ${added > 0 ? '<= OVERLAY WIDENS PAGE' : '(overlay adds nothing)'}`);
  if (added > 0) { console.log('FAIL: overlay widened the page'); failures++; }
  if (errors.length) { console.log('CONSOLE ERRORS:'); errors.forEach(e => console.log('  ' + e)); failures++; }
  else console.log('console errors: none');

  if (s.unclassified > 0) { console.log(`FAIL: unclassified count is ${s.unclassified}, expected 0`); failures++; }
  if (result.labelOverlaps > 0 && MODE === 'inline') { console.log(`FAIL: ${result.labelOverlaps} labels overlap the results column`); failures++; }

  await page.screenshot({ path: `${OUT}/sps-fixture-${MODE}-${vp.name}.png`, fullPage: true });
  await page.close();
}

await browser.close();
console.log(`\n${failures ? 'FAILURES: ' + failures : 'All fixture checks passed.'}`);
process.exit(failures ? 1 : 0);
