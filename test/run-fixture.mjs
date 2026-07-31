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
    const heightBefore = document.documentElement.scrollHeight;

    SPS_OVERLAY.render(elements, {
      settings: { overlayMode: mode, viewport: 'desktop' },
      summary, serpHeight, serpTop, showSitelinks: false,
    });

    // Does the overlay overlap the results column? That is the layout-break test.
    const col = document.querySelector('#center_col').getBoundingClientRect();
    // A chip anchored to the URL row is INSIDE the column by design — that is
    // the point of the placement. What must never happen is a chip sitting on
    // top of the URL text itself, so test against the cite, not the column.
    const overlaps = [...document.querySelectorAll('.sps-chip')].filter(n => {
      const r = n.getBoundingClientRect();
      return [...document.querySelectorAll('cite')].some(c => {
        const cr = c.getBoundingClientRect();
        return cr.width > 0 && r.left < cr.right && r.right > cr.left
            && r.top < cr.bottom && r.bottom > cr.top;
      });
    }).length;

    return {
      summary,
      citations: aio.citations.map(c => c.domain),
      labelCount: document.querySelectorAll('.sps-chip').length,
      onUrlRow: document.querySelectorAll('.sps-chip-holder').length,
      boxCount: document.querySelectorAll('.sps-box').length,
      overlayNodes: document.querySelectorAll('#sps-overlay-root > *').length,
      hud: !!document.querySelector('.sps-hud'),
      labelOverlaps: overlaps,
      widthBefore,
      heightBefore,
      docScrollH: document.documentElement.scrollHeight,
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
  console.log(`overlay nodes ${result.overlayNodes} | HUD ${result.hud} | inline labels ${result.labelCount} | boxes ${result.boxCount}`);
  console.log(`labels overlapping the results column: ${result.labelOverlaps}`);
  // No gutter must mean box mode, never labels sitting on Google's text.
  if (result.labelOverlaps > 0) {
    console.log('FAIL: chips drawn on top of the URL text'); failures++;
  }
  const addedH = result.docScrollH - result.heightBefore;
  console.log(`height added BY THE OVERLAY: ${addedH}px ${addedH > 0 ? '<= OVERLAY LENGTHENS PAGE' : '(overlay adds nothing)'}`);
  if (addedH > 0) { console.log('FAIL: overlay lengthened the page'); failures++; }
  // Every annotatable element must carry SOMETHING. A dropped annotation reads
  // as an undetected element, which is a worse lie than a mixed overlay.
  // Local pack must resolve to the module, not the wrapper that also holds the
  // organic results. Live capture had the heading inside a 2,402px block.
  const packs = result.rows.filter(r => r.type === 'local_pack');
  const organics = result.rows.filter(r => r.type === 'organic').length;
  console.log(`local packs ${packs.length}` + (packs.length ? ` (h=${packs[0].h})` : '') + ` | organics ${organics}`);
  if (packs.length !== 1) { console.log(`FAIL: expected 1 local pack, got ${packs.length}`); failures++; }
  else if (packs[0].h > s.serpHeight * 0.4) {
    console.log(`FAIL: local pack ${packs[0].h}px is the wrapper, not the module`); failures++;
  }
  // Fixture holds 4 organics plus one social (LinkedIn) — 5 result rows total.
  if (organics < 4) { console.log(`FAIL: local pack swallowed organics (${organics} left)`); failures++; }

  // Invariant: a sitelink is a sub-link of the result above it and can never
  // out-earn it. The two are scored independently, so this can invert.
  let lastResult = null, inversions = 0;
  for (const r of result.rows) {
    if (r.type === 'organic' || r.type === 'social') lastResult = r;
    else if (r.type === 'sitelink' && lastResult && r.ctr > lastResult.ctr * 1.001) inversions++;
  }
  console.log(`sitelink CTR inversions: ${inversions}`);
  if (inversions) { console.log('FAIL: a sitelink out-earns its parent result'); failures++; }

  const annotatable = result.rows.filter(r => r.type !== 'sitelink' && r.type !== 'related_search').length;
  const annotated = result.labelCount + result.boxCount;
  console.log(`annotated ${annotated} of ${annotatable} annotatable elements`);
  if (MODE === 'inline' && annotated < annotatable) {
    console.log(`FAIL: ${annotatable - annotated} elements silently unannotated`); failures++;
  }
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


// ---------------------------------------------------------------------------
// No-AI-Overview pass.
//
// Three of six live captures had NO AI Overview, and the detector claimed the
// entire results column on all three — 88-91% page share, citations invented
// from ordinary result links, organic count driven to zero, and on one query a
// false "cites you". Absence must be detected as absence.
// ---------------------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.join(ROOT, 'test/fixture-serp.html'));
  await page.addScriptTag({ content: `window.chrome = { runtime: { sendMessage(){}, onMessage:{ addListener(){} } } };` });
  for (const f of SRC) await page.addScriptTag({ path: path.join(ROOT, f) });

  const r = await page.evaluate(async () => {
    // Strip the AI Overview, leaving an otherwise ordinary SERP.
    const label = [...document.querySelectorAll('[role="heading"]')]
      .find(n => /ai overview/i.test(n.textContent || ''));
    label?.closest('div[jsname]')?.remove();

    const aio = await SPS_AIO.read(['hdfcbank.com']);
    const els = SPS_CLASSIFY.run({ ownedDomains: ['hdfcbank.com'], aioResult: aio });
    return {
      present: aio.present,
      citations: aio.citations.length,
      cited: aio.cited,
      organics: els.filter(e => e.type === 'organic').length,
      aioElements: els.filter(e => e.type === 'ai_overview').length,
      tallest: Math.max(...els.map(e => e.height)),
      serpHeight: SPS_MEASURE.serpHeight(),
    };
  });

  console.log(`\n${'='.repeat(78)}\nNO AI OVERVIEW ON THE PAGE\n${'='.repeat(78)}`);
  console.log(`aioPresent ${r.present} | citations ${r.citations} | cited ${r.cited}`);
  console.log(`organics ${r.organics} | ai_overview elements ${r.aioElements}`);
  console.log(`tallest element ${r.tallest}px of ${r.serpHeight}px page`);

  if (r.present) { console.log('FAIL: reported an AI Overview on a page without one'); failures++; }
  if (r.cited) { console.log('FAIL: claimed "cites you" with no AI Overview present'); failures++; }
  if (r.aioElements) { console.log('FAIL: emitted an ai_overview element'); failures++; }
  if (r.organics < 4) { console.log(`FAIL: only ${r.organics} organics — something swallowed the results`); failures++; }
  if (r.tallest > r.serpHeight * 0.7) { console.log('FAIL: one element covers most of the page'); failures++; }
  if (errors.length) { console.log('CONSOLE ERRORS: ' + errors.join(' | ')); failures++; }
  if (!r.present && !r.cited && r.organics >= 4) console.log('correctly reports no AI Overview');
  await page.close();
}


// ---------------------------------------------------------------------------
// The unclassified counter is the maintenance alarm. A live SERP had a 2,402px
// section we could not identify, and because a few organic results happened to
// sit inside it the counter stayed at 0 — silent exactly when it mattered.
// ---------------------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('file://' + path.join(ROOT, 'test/fixture-serp.html'));
  await page.addScriptTag({ content: `window.chrome = { runtime: { sendMessage(){}, onMessage:{ addListener(){} } } };` });
  for (const f of SRC) await page.addScriptTag({ path: path.join(ROOT, f) });

  const r = await page.evaluate(async () => {
    // Wrap one organic in a tall section of a kind the classifier knows nothing
    // about — mostly unexplained height, one classified child inside.
    const victim = document.querySelector('div[data-hveid="o3"]');
    const shell = document.createElement('div');
    shell.setAttribute('data-hveid', 'mystery');
    shell.style.minHeight = '900px';
    victim.parentElement.insertBefore(shell, victim);
    shell.appendChild(victim);
    const pad = document.createElement('div');
    pad.style.height = '760px';
    pad.innerHTML = '<a href="https://unknown-module.example/x">something new</a>';
    shell.appendChild(pad);
    document.querySelector('#rso').appendChild(shell);

    const aio = await SPS_AIO.read(['hdfcbank.com']);
    const els = SPS_CLASSIFY.run({ ownedDomains: ['hdfcbank.com'], aioResult: aio });
    return {
      unclassified: els.filter(e => e.type === 'unclassified').length,
      organics: els.filter(e => e.type === 'organic').length,
    };
  });

  console.log(`\n${'='.repeat(78)}\nUNCLASSIFIED ALARM\n${'='.repeat(78)}`);
  console.log(`unclassified ${r.unclassified} | organics still found ${r.organics}`);
  if (!r.unclassified) { console.log('FAIL: a large unexplained section did not raise the alarm'); failures++; }
  else console.log('alarm fires on an unrecognised section');
  await page.close();
}

await browser.close();
console.log(`\n${failures ? 'FAILURES: ' + failures : 'All fixture checks passed.'}`);
process.exit(failures ? 1 : 0);
