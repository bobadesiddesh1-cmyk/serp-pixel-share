// Demo video generator.
//
// Same rule as the store images: every frame of product UI is the real thing.
// The overlay is rendered by src/content/overlay.js over test/fixture-serp.html,
// and the panel is the real side panel driven through its own render functions.
// This file only captures those surfaces and animates them behind captions.
//
// Frames are drawn deterministically — render(t) is a pure function of time, so
// the output is identical run to run and does not depend on wall-clock timing.
// They are piped as JPEG into the ffmpeg that ships with Playwright, which is a
// cut-down build: image2pipe in, VP8/WebM out, and not much else.
//
// Usage: xvfb-run -a node tools/make-demo-video.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = '/home/user/serp-pixel-share';
const OUT = process.env.SPS_OUT || `${ROOT}/store-assets`;
const FFMPEG = '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';
const SIZE = 1080;          // square reads better in the LinkedIn feed
const FPS = 30;
const SRC = ['src/shared/constants.js', 'src/model/estimate.js', 'src/content/measure.js',
             'src/content/aio.js', 'src/content/classifier.js', 'src/content/overlay.js'];

fs.mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext('/tmp/sps-video-profile', {
  headless: false, channel: 'chromium', viewport: { width: SIZE, height: SIZE },
  deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`,
         '--no-sandbox', '--no-first-run', '--hide-scrollbars'],
});
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
const extId = new URL(sw.url()).host;

// ---------------------------------------------------------------- capture
const fx = await ctx.newPage();
await fx.setViewportSize({ width: 1180, height: 1000 });
await fx.goto('file://' + path.join(ROOT, 'test/fixture-serp.html'));
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

// The whole results page as one tall image, plus where the owned result sits in
// it, so the scroll can stop on the moment the video is about.
const serpGeom = await fx.evaluate(() => {
  const col = document.querySelector('#center_col').getBoundingClientRect();
  const cite = [...document.querySelectorAll('#rso cite')]
    .find(c => /hdfcbank\.com/.test(c.textContent));
  return {
    x: Math.max(0, Math.round(col.left - 26)),
    width: Math.round(col.width + 52),
    height: Math.ceil(document.documentElement.scrollHeight),
    ownedY: cite ? Math.round(cite.getBoundingClientRect().top + scrollY) : 900,
  };
});
const serpPng = (await fx.screenshot({ fullPage: true, scale: 'css',
  clip: { x: serpGeom.x, y: 0, width: serpGeom.width, height: serpGeom.height } })).toString('base64');

const panel = await ctx.newPage();
await panel.setViewportSize({ width: 430, height: 900 });
await panel.goto(`chrome-extension://${extId}/src/sidepanel/panel.html`);
await panel.waitForTimeout(1200);
await panel.evaluate(s => { renderScan(s); renderAIO(s); }, scan);
await panel.waitForTimeout(600);
const panelH = await panel.evaluate(() => {
  const b = document.querySelector('#brand');
  return Math.ceil(b.getBoundingClientRect().bottom + scrollY + 12);
});
const panelPng = (await panel.screenshot({ fullPage: true, scale: 'css',
  clip: { x: 0, y: 0, width: 430, height: panelH } })).toString('base64');

const icon = fs.readFileSync(path.join(ROOT, 'icons/icon128.png')).toString('base64');
const mark = fs.readFileSync(path.join(ROOT, 'icons/bws-mark.svg')).toString('base64');

console.log(`captured — serp ${serpGeom.width}x${serpGeom.height}, panel 430x${panelH}, ` +
            `owned result at ${serpGeom.ownedY}px, ${scan.elements.length} elements`);

// ------------------------------------------------------------------- stage
// Scene boundaries in seconds. Kept in one place so the storyboard is legible
// and the total is easy to keep under a minute.
const S = [
  { at: 0.0,  dur: 2.8 },   // 0 title
  { at: 2.8,  dur: 4.4 },   // 1 the claim
  { at: 7.2,  dur: 6.6 },   // 2 scroll down the page
  { at: 13.8, dur: 5.0 },   // 3 land on the chip
  { at: 18.8, dur: 6.4 },   // 4 panel: positions lost
  { at: 25.2, dur: 6.0 },   // 5 panel: click share + map
  { at: 31.2, dur: 4.6 },   // 6 end card
];
const TOTAL = S[S.length - 1].at + S[S.length - 1].dur;

const stage = await ctx.newPage();
await stage.setViewportSize({ width: SIZE, height: SIZE });
await stage.setContent(`
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${SIZE}px;height:${SIZE}px;overflow:hidden;background:#0E1117;
    font-family:"DejaVu Sans","Liberation Sans",Arial,sans-serif;color:#F2F3F5}
  .layer{position:absolute;inset:0;opacity:0}
  /* device frame the SERP and panel scroll inside */
  .frame{position:absolute;border-radius:12px;overflow:hidden;background:#fff;
    box-shadow:0 30px 70px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.10)}
  .frame img{position:absolute;left:0;top:0;display:block}
  .cap{position:absolute;left:64px;right:64px;font-weight:700;letter-spacing:-.6px}
  .cap b{color:#C8F135}
  .sub{font-weight:400;font-size:23px;line-height:1.45;color:#A6ADBB;margin-top:14px;
       letter-spacing:0}
  .ring{position:absolute;border:2.5px solid #C8F135;border-radius:9px;
        box-shadow:0 0 0 6px rgba(200,241,53,.16)}
  .badge{position:absolute;background:#C8F135;color:#0A0A0C;font-weight:700;
    font-size:19px;padding:8px 15px;border-radius:7px;white-space:nowrap}
  .center{position:absolute;inset:0;display:flex;flex-direction:column;
    align-items:center;justify-content:center;text-align:center;gap:20px}
  .app{width:132px;height:132px;border-radius:30px}
  .t1{font-size:62px;font-weight:700;letter-spacing:-1.6px}
  .t2{font-size:27px;color:#9FE8CF}
  .by{display:flex;align-items:center;gap:11px;font-size:22px;color:#8A94A6;margin-top:6px}
  .by b{color:#D7DEE8}
  .by img{width:30px;height:30px;border-radius:7px}
  .foot{position:absolute;left:0;right:0;bottom:52px;text-align:center;
    font-size:21px;color:#7C8595}
</style>

<div class="layer" id="L0"><div class="center">
  <img class="app" src="data:image/png;base64,${icon}">
  <div class="t1">SERP Pixel Share</div>
  <div class="t2">Where the clicks actually go.</div>
</div></div>

<div class="layer" id="L1">
  <div class="cap" id="C1" style="top:96px;font-size:52px;line-height:1.12"></div>
  <div class="frame" id="F1"><img id="I1" src="data:image/png;base64,${serpPng}"></div>
</div>

<div class="layer" id="L2">
  <div class="frame" id="F2"><img id="I2" src="data:image/png;base64,${panelPng}"></div>
  <div class="cap" id="C2" style="font-size:46px;line-height:1.14"></div>
</div>

<div class="layer" id="L3"><div class="center">
  <img class="app" src="data:image/png;base64,${icon}">
  <div class="t1">SERP Pixel Share</div>
  <div class="t2">Free. Nothing leaves your browser.</div>
  <div class="by"><img src="data:image/svg+xml;base64,${mark}"><span>built by <b>BuildWithSiddesh</b></span></div>
</div>
<div class="foot">Chrome extension &middot; link in the comments</div></div>

<div class="ring" id="RING" style="opacity:0"></div>
<div class="badge" id="BADGE" style="opacity:0"></div>

<script>
const SIZE = ${SIZE};
const S = ${JSON.stringify(S)};
const SERP = { w: ${serpGeom.width}, h: ${serpGeom.height}, ownedY: ${serpGeom.ownedY} };
const OWNED_PX = ${scan.elements.find(e => e.owned && e.type === 'organic')?.yTop ?? 0};
const PANEL = { w: 430, h: ${panelH} };

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Local progress within a scene, 0..1.
const p = (t, i) => clamp((t - S[i].at) / S[i].dur, 0, 1);
// Ease in and out so scroll starts and stops rather than snapping.
const ease = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
// Fade a layer in at the head of its scene and out at the tail.
const fade = (t, i, inD = .45, outD = .45) => {
  const a = t - S[i].at, d = S[i].dur;
  if (a < 0 || a > d) return 0;
  return clamp(Math.min(a / inD, (d - a) / outD), 0, 1);
};

// The SERP is shown at a scale that fits the frame, so scroll offsets have to
// be expressed in scaled pixels, not source pixels.
const SERP_W = 760;
const SERP_SCALE = SERP_W / SERP.w;
const SERP_FRAME_H = 620;

function serpScroll(y) {
  const max = SERP.h * SERP_SCALE - SERP_FRAME_H;
  $('I1').style.transform =
    'scale(' + SERP_SCALE + ') translateY(' + (-clamp(y, 0, max) / SERP_SCALE) + 'px)';
  $('I1').style.transformOrigin = '0 0';
  return clamp(y, 0, max);
}

function render(t) {
  for (const id of ['L0', 'L1', 'L2', 'L3']) $(id).style.opacity = 0;
  $('RING').style.opacity = 0;
  $('BADGE').style.opacity = 0;

  // ── 0 title
  $('L0').style.opacity = fade(t, 0, .5, .5);

  // ── 1 + 2 + 3 all share the SERP frame
  const inSerp = t >= S[1].at && t < S[4].at;
  if (inSerp) {
    const f = $('F1');
    f.style.left = ((SIZE - SERP_W) / 2) + 'px';
    f.style.top = '332px';
    f.style.width = SERP_W + 'px';
    f.style.height = SERP_FRAME_H + 'px';

    let alpha, caption, scrollTo;
    if (t < S[2].at) {                       // the claim, page at the top
      alpha = fade(t, 1, .45, .12);
      caption = 'Your rank tracker<br>says <b>position 2</b>.';
      scrollTo = 0;
    } else if (t < S[3].at) {                // travel down the page
      alpha = 1;
      caption = 'Your screen<br>says <b>something else</b>.';
      const target = SERP.ownedY * SERP_SCALE - 250;
      scrollTo = ease(p(t, 2)) * target;
    } else {                                 // parked on the owned result
      alpha = fade(t, 3, .12, .45);
      caption = '<b>' + OWNED_PX.toLocaleString() + 'px</b> down.<br>One full scroll.';
      scrollTo = SERP.ownedY * SERP_SCALE - 250;
    }
    $('L1').style.opacity = alpha;
    $('C1').innerHTML = caption;
    const y = serpScroll(scrollTo);

    // Ring the chip on the owned result once the scroll has settled.
    if (t >= S[3].at) {
      const a = fade(t, 3, .35, .45);
      const top = 332 + (SERP.ownedY * SERP_SCALE - y) - 12;
      const ring = $('RING');
      ring.style.opacity = a;
      ring.style.left = ((SIZE - SERP_W) / 2 + SERP_W - 312) + 'px';
      ring.style.top = top + 'px';
      ring.style.width = '294px';
      ring.style.height = '34px';
      const badge = $('BADGE');
      badge.style.opacity = a;
      badge.textContent = 'ranks #2 · acts like #10';
      badge.style.left = ((SIZE - SERP_W) / 2 + SERP_W - 312) + 'px';
      badge.style.top = (top + 48) + 'px';
    }
  }

  // ── 4 + 5 the panel
  const inPanel = t >= S[4].at && t < S[6].at;
  if (inPanel) {
    const f = $('F2');
    const PW = 396, PH = 700;
    f.style.left = '92px';
    f.style.top = '210px';
    f.style.width = PW + 'px';
    f.style.height = PH + 'px';
    const sc = PW / PANEL.w;
    $('I2').style.transformOrigin = '0 0';

    let alpha, caption, off;
    if (t < S[5].at) {
      alpha = fade(t, 4, .45, .12);
      caption = '<b>&minus;8 positions</b><br>lost to the layout.'
        + '<div class="sub">Rank 2, rendering under an AI Overview and two ads. '
        + 'The page treats it like rank 10.</div>';
      off = 0;
    } else {
      alpha = fade(t, 5, .12, .45);
      caption = 'Every element<br><b>measured</b>.'
        + '<div class="sub">Click share by element and a pixel map of the whole '
        + 'page, AI Overview included.</div>';
      off = ease(p(t, 5)) * Math.max(0, PANEL.h * sc - PH);
    }
    $('I2').style.transform = 'scale(' + sc + ') translateY(' + (-off / sc) + 'px)';
    $('L2').style.opacity = alpha;
    const c = $('C2');
    c.innerHTML = caption;
    c.style.left = '546px';
    c.style.right = '64px';
    c.style.top = '300px';
  }

  // ── 6 end card
  $('L3').style.opacity = fade(t, 6, .5, .35);
}
window.render = render;
</script>
`);
await stage.waitForTimeout(900);

// ------------------------------------------------------------------ encode
const file = path.join(OUT, 'serp-pixel-share-demo.webm');
const ff = spawn(FFMPEG, [
  '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', 'pipe:0',
  '-c:v', 'libvpx', '-b:v', '3M', '-crf', '8', '-auto-alt-ref', '0',
  '-pix_fmt', 'yuv420p', file,
]);
let ffErr = '';
ff.stderr.on('data', d => { ffErr += d.toString(); });
const done = new Promise((res, rej) => {
  ff.on('close', code => code === 0 ? res() : rej(new Error('ffmpeg exit ' + code + '\n' + ffErr.slice(-1500))));
});

const frames = Math.round(TOTAL * FPS);
for (let i = 0; i < frames; i++) {
  const t = i / FPS;
  await stage.evaluate(x => window.render(x), t);
  const buf = await stage.screenshot({ type: 'jpeg', quality: 92, scale: 'css' });
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  if (i % 60 === 0) process.stdout.write(`\r  frame ${i}/${frames}  (${t.toFixed(1)}s)   `);
}
ff.stdin.end();
await done;

const kb = Math.round(fs.statSync(file).size / 1024);
console.log(`\ndone -> ${file}  ${TOTAL.toFixed(1)}s, ${frames} frames, ${kb} KB`);
await ctx.close();
