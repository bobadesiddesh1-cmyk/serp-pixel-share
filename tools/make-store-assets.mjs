// Store screenshot generator.
//
// Renders the REAL extension UI — the real overlay over the test fixture, and
// the real side panel driven by the real scan pipeline — then composes each
// into a 1280x800 JPEG for the Chrome Web Store listing.
//
// Nothing here is mocked artwork: every pixel of product UI comes from the
// shipped source. Only the frame and caption around it are drawn here.
//
// Usage: xvfb-run -a node shoot.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = '/home/user/serp-pixel-share';
const OUT = process.env.SPS_OUT || `${ROOT}/store-assets`;
const PROFILE = '/tmp/sps-shoot-profile';

const SRC = ['src/shared/constants.js', 'src/model/estimate.js', 'src/content/measure.js',
             'src/content/aio.js', 'src/content/classifier.js', 'src/content/overlay.js'];

fs.mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false, channel: 'chromium', viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`,
         '--no-sandbox', '--no-first-run', '--hide-scrollbars'],
});

let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
const extId = new URL(sw.url()).host;
console.log('extension id:', extId);

// ---------------------------------------------------------------- SERP shot
const fx = await ctx.newPage();
// Wide enough that chips anchor inline to <cite>. At narrow widths the overlay
// correctly falls back to the gutter, which is not what this shot is showing.
await fx.setViewportSize({ width: 1500, height: 1100 });
await fx.goto('file://' + path.join(ROOT, 'test/fixture-serp.html'));
// The overlay's positioning lives in overlay.css. Without it the chips render
// in document flow at x=0 instead of on the URL row — the shot is meaningless.
await fx.addStyleTag({ path: path.join(ROOT, 'src/content/overlay.css') });
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
    if (el.type === 'organic' || el.type === 'social') {
      el.effectivePos = SPS_MODEL.effectivePosition(el.estCTR, 'desktop');
    }
    if (el.column !== 'right' && !['organic', 'sitelink', 'social', 'unclassified'].includes(el.type)) {
      typesAbove.push(el.type);
    }
  }
  SPS_MODEL.normalise(elements).forEach((n, i) => { elements[i].shareOfClicks = n.shareOfClicks; });
  const own = elements.find(e => e.owned && e.type === 'organic');
  const summary = {
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
  };
  SPS_OVERLAY.render(elements, {
    settings: { overlayMode: 'inline', viewport: 'desktop' },
    summary, serpHeight, serpTop, showSitelinks: false,
  });
  const ser = e => { const { node, citations, matched, ...r } = e; return { ...r,
    citationCount: citations?.length, citations: citations?.slice(0, 12),
    matched: matched?.map(m => m.domain) }; };
  return { summary, elements: elements.map(ser) };
});
console.log(`scan: ${scan.elements.length} elements, aio=${scan.summary.aioPresent}, ` +
            `owned rank ${scan.summary.ownedRank}, unclassified ${scan.summary.unclassified}`);

await fx.waitForTimeout(800);

// Crop to the run of organic results that carry chips. A full-page shot of the
// fixture reads as a mock; a tight crop shows the one thing this screenshot is
// meant to show — the chip sitting on the URL row.
const serpClip = await fx.evaluate(() => {
  const col = document.querySelector('#center_col').getBoundingClientRect();
  // Anchor on the organic run: the first cites that have a chip on their row.
  const cites = [...document.querySelectorAll('#rso cite')]
    .map(c => c.getBoundingClientRect())
    .filter(r => r.width > 0 && r.left >= col.left - 4)
    .sort((a, b) => a.top - b.top);
  const chipped = cites.filter(cr => [...document.querySelectorAll('.sps-chip')].some(n => {
    const r = n.getBoundingClientRect();
    return r.width > 0 && Math.abs((r.top + r.bottom) / 2 - (cr.top + cr.bottom) / 2) < 26;
  }));
  const run = (chipped.length >= 2 ? chipped : cites).slice(0, 2);
  const top = Math.max(0, run[0].top + scrollY - 58);
  const bottom = run[run.length - 1].bottom + scrollY + 58;
  return {
    x: Math.max(0, col.left - 24), y: top,
    width: Math.round(col.width + 48),
    height: Math.round(bottom - top),
  };
});
const serpPng = (await fx.screenshot({ clip: serpClip, fullPage: true })).toString('base64');
console.log('serp crop', JSON.stringify(serpClip));

// --------------------------------------------------------------- panel shots
const panel = await ctx.newPage();
await panel.setViewportSize({ width: 430, height: 880 });
await panel.goto(`chrome-extension://${extId}/src/sidepanel/panel.html`);
await panel.waitForTimeout(1200);
await panel.evaluate(s => { renderScan(s); renderAIO(s); }, scan);
await panel.waitForTimeout(600);

// Clip each panel view to its own content height. The panel is a fixed-height
// surface, so a raw screenshot of a short view is mostly empty background.
const shootPanel = async (offset = 0, cap = 880) => {
  const h = await panel.evaluate(o => {
    const v = [...document.querySelectorAll('.view')].find(s => !s.hidden);
    const last = [...v.querySelectorAll('*')].reduce((m, n) => {
      const r = n.getBoundingClientRect();
      return r.height > 0 ? Math.max(m, r.bottom + scrollY) : m;
    }, 0);
    // The maker credit sits outside the views, after <main>. Extend to it so
    // every panel shot carries the byline rather than cutting just above it.
    const brand = document.querySelector('#brand');
    const foot = brand ? brand.getBoundingClientRect().bottom + scrollY : 0;
    return Math.ceil(Math.max(last, foot) - o + 14);
  }, offset);
  return (await panel.screenshot({ fullPage: true,
    clip: { x: 0, y: offset, width: 430, height: Math.min(cap, Math.max(220, h)) } }))
    .toString('base64');
};

const panelScan = await shootPanel(0, 860);

await panel.evaluate(() => document.querySelector('[data-view="aio"]').click());
await panel.waitForTimeout(400);
const panelAio = await shootPanel(0, 700);

await panel.evaluate(() => document.querySelector('[data-view="scan"]').click());
await panel.waitForTimeout(400);
const mapTop = await panel.evaluate(() => {
  const m = document.querySelector('#map-col');
  if (!m) return 0;
  const lbl = [...document.querySelectorAll('*')]
    .find(n => /PIXEL MAP/i.test(n.textContent) && n.children.length === 0);
  const r = (lbl || m).getBoundingClientRect();
  return Math.max(0, Math.round(r.top + scrollY - 60));
});
const panelMap = await shootPanel(mapTop, 780);

// ------------------------------------------------------------------ compose
const shots = [
  { file: '01-overlay.jpg',
    head: 'Every result labelled where you already look',
    sub: 'Estimated CTR and effective rank sit on the URL row — no layout shift, no hover, nothing to click.',
    img: serpPng, mode: 'wide' },
  { file: '02-panel.jpg',
    head: 'What your rank is actually worth',
    sub: 'Rank 2 rendering below an AI Overview and two ads performs like rank 10. The panel puts a number on the gap.',
    img: panelScan, mode: 'tall' },
  { file: '03-aio.jpg',
    head: 'Who the AI Overview cites',
    sub: 'Presence, share of page height, and every cited domain — including whether one of them is yours.',
    img: panelAio, mode: 'tall' },
  { file: '04-map.jpg',
    head: 'A pixel map of the whole results page',
    sub: 'Screen-edge markers labelled in scrolls, so you can see how far down your listing really sits.',
    img: panelMap, mode: 'tall' },
];

const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 800 });

const css = `
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1280px;height:800px;overflow:hidden;background:#0E1117;
       font-family:"DejaVu Sans","Liberation Sans",Arial,sans-serif;color:#F2F3F5}
  .wrap{width:1280px;height:800px;padding:52px 60px 0;display:flex;flex-direction:column}
  h1{font-size:38px;line-height:1.14;font-weight:700;letter-spacing:-.7px;max-width:1000px}
  p{margin-top:14px;font-size:18px;line-height:1.5;color:#A6ADBB;max-width:820px}
  .stage{flex:1;margin-top:30px;min-height:0;display:flex}
  .shot{border-radius:10px;overflow:hidden;flex:none;
        box-shadow:0 26px 60px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.09)}
  .shot img{display:block}
  .wide{justify-content:center}
  .wide .shot img{height:520px;width:auto}
  .tall{gap:48px;align-items:flex-start}
  .tall .shot img{width:342px;height:auto}
  .notes{padding-top:4px;max-width:620px}
  .notes li{list-style:none;font-size:17px;line-height:1.5;color:#C7CDD8;
            padding:11px 0 11px 24px;position:relative}
  .notes li:before{content:"";position:absolute;left:0;top:20px;width:9px;height:9px;
                   border-radius:50%;background:#0B7A5E}
  .brand{position:absolute;right:60px;top:52px;font-size:13px;letter-spacing:2.4px;
         color:#5B6473;font-weight:700}
`;

const NOTES = {
  '02-panel.jpg': ['Ranks vs. acts like — the same number rank trackers give you, restated as what it earns',
                   'Share of total page height your listing occupies',
                   'Estimated CTR, always labelled as an estimate',
                   'Calibrate the model against your own Search Console data'],
  '03-aio.jpg': ['Detected by the AI Overview label, not by fragile class names',
                 'Every cited domain listed, in order',
                 'Flags when one of the citations is yours',
                 'Reports absent when it is absent — no guessing'],
  '04-map.jpg': ['Whole-page pixel map, scaled to the real SERP height',
                 'Screen-edge markers labelled in scrolls',
                 'Click share per element, your results in green',
                 'Export the whole scan to CSV'],
};

for (const s of shots) {
  const body = s.mode === 'wide'
    ? `<div class="stage wide"><div class="shot"><img src="data:image/png;base64,${s.img}"></div></div>`
    : `<div class="stage tall">
         <div class="shot"><img src="data:image/png;base64,${s.img}"></div>
         <ul class="notes">${(NOTES[s.file] || []).map(n => `<li>${n}</li>`).join('')}</ul>
       </div>`;
  const html = `<style>${css}</style><div class="wrap">
      <div class="brand">SERP PIXEL SHARE</div>
      <h1>${s.head}</h1><p>${s.sub}</p>${body}</div>`;
  await page.setContent(html);
  await page.waitForTimeout(500);
  // scale:'css' emits CSS-pixel dimensions. Without it the 2x device scale
  // factor doubles the output to 2560x1600 and the store rejects it.
  const buf = await page.screenshot({ type: 'jpeg', quality: 92, scale: 'css',
    clip: { x: 0, y: 0, width: 1280, height: 800 } });
  fs.writeFileSync(path.join(OUT, s.file), buf);
  console.log('wrote', s.file, buf.length, 'bytes');
}

// ------------------------------------------------------------- promo tiles
const icon = fs.readFileSync(path.join(ROOT, 'icons/icon128.png')).toString('base64');
const tiles = [
  { file: 'promo-small-440x280.jpg', w: 440, h: 280, icon: 78, title: 34, sub: 15, pad: 34 },
  { file: 'promo-marquee-1400x560.jpg', w: 1400, h: 560, icon: 150, title: 78, sub: 30, pad: 100 },
];
for (const t of tiles) {
  const html = `<style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:${t.w}px;height:${t.h}px;overflow:hidden;
         background:linear-gradient(135deg,#0E1117 0%,#161C26 62%,#123A31 100%);
         font-family:"DejaVu Sans","Liberation Sans",Arial,sans-serif;color:#F2F3F5;
         display:flex;align-items:center;gap:${t.pad * 0.6}px;padding:0 ${t.pad}px}
    img{width:${t.icon}px;height:${t.icon}px;border-radius:${t.icon * 0.22}px;flex:none}
    h1{font-size:${t.title}px;line-height:1.05;font-weight:700;letter-spacing:-1px}
    p{margin-top:${t.sub * 0.5}px;font-size:${t.sub}px;line-height:1.42;color:#9FE8CF}
  </style>
  <img src="data:image/png;base64,${icon}">
  <div><h1>SERP Pixel Share</h1>
  <p>Where the clicks actually go on a Google results page.</p></div>`;
  await page.setViewportSize({ width: t.w, height: t.h });
  await page.setContent(html);
  await page.waitForTimeout(300);
  const buf = await page.screenshot({ type: 'jpeg', quality: 92, scale: 'css',
    clip: { x: 0, y: 0, width: t.w, height: t.h } });
  fs.writeFileSync(path.join(OUT, t.file), buf);
  console.log('wrote', t.file, buf.length, 'bytes');
}

await ctx.close();
console.log('\ndone ->', OUT);
