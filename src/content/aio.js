// AI Overview: detect, expand, extract cited domains.
//
// This is the most fragile file in the extension and the most valuable.
// Google renders AIO late, lazily, and behind a collapse control, so a naive
// querySelectorAll undercounts citations badly.
//
// Strategy, in order of reliability:
//   1. Label text ("AI Overview" / localised) on a heading-ish node -> walk up to block
//   2. Stable-ish data attributes
//   3. Structural: first large block in #center_col before the first .g organic
// Then: click the expand control, wait for mutations to settle, harvest links.

const SPS_AIO = (() => {

  // Localised AIO labels. Add as you encounter new locales.
  const LABELS = [
    'ai overview', 'ai-powered overview', 'aperçu ia', 'ia übersicht',
    'resumen con ia', 'panoramica ai', 'ai の概要', 'ai 개요',
    'एआई अवलोकन', 'نظرة عامة من الذكاء الاصطناعي'
  ];

  const EXPAND_LABELS = ['show more', 'show all', 'more', 'दिखाएं', 'mostrar más', 'afficher plus'];

  function textOf(el) {
    return (el.textContent || '').trim().toLowerCase();
  }

  /** Find the AIO container, or null. */
  function findContainer() {
    // 1. Label-driven. Most robust across Google's class churn.
    const candidates = document.querySelectorAll(
      '#center_col h1, #center_col h2, #center_col [role="heading"], #center_col span, #center_col div[aria-label]'
    );
    for (const c of candidates) {
      const t = textOf(c);
      if (t.length > 60) continue;
      const aria = (c.getAttribute('aria-label') || '').toLowerCase();
      const hit = LABELS.some(l => t === l || t.startsWith(l) || aria.includes(l));
      if (!hit) continue;
      const block = climbToBlock(c);
      if (block) return block;
    }

    // 2. Attribute-driven.
    const attr = document.querySelector(
      '[data-attrid*="AIOverview" i], [data-subtree="aio"], [data-mcpr], div[jsname][data-hveid] [data-attrid*="overview" i]'
    );
    if (attr) {
      const block = climbToBlock(attr);
      if (block) return block;
    }

    // 3. Structural fallback: a tall block above the first organic result
    //    that contains outbound links but is not an ad.
    const firstOrganic = document.querySelector('#search .g, #rso > div');
    if (firstOrganic) {
      const oTop = firstOrganic.getBoundingClientRect().top + window.scrollY;
      const blocks = document.querySelectorAll('#center_col > div, #rso > div, #rcnt > div > div');
      for (const b of blocks) {
        if (!SPS_MEASURE.isRendered(b)) continue;
        const m = SPS_MEASURE.docOffset(b);
        if (m.yTop >= oTop) break;
        if (m.height < 180) continue;
        if (b.querySelector('[data-text-ad], [aria-label="Ads"]')) continue;
        if (b.querySelectorAll('a[href^="http"]').length < 2) continue;
        return b;
      }
    }

    return null;
  }

  /** Walk up from a label node to the enclosing AIO block. */
  function climbToBlock(node) {
    let el = node;
    for (let i = 0; i < 8 && el; i++) {
      el = el.parentElement;
      if (!el) break;
      if (el.id === 'center_col' || el.id === 'rcnt' || el.id === 'rso') break;
      const m = el.getBoundingClientRect();
      if (m.height >= 140 && m.width >= 300) return el;
    }
    return null;
  }

  /**
   * Click the expand control if present, then wait for the DOM to settle.
   * Returns true if an expansion actually happened.
   */
  async function expand(container) {
    if (!container) return false;
    const btns = container.querySelectorAll(
      'div[role="button"], button, [jsaction][tabindex="0"], a[role="button"]'
    );
    let target = null;
    for (const b of btns) {
      const t = textOf(b);
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      if (EXPAND_LABELS.some(l => t.includes(l) || aria.includes(l))) { target = b; break; }
      if (b.getAttribute('aria-expanded') === 'false') { target = b; break; }
    }
    if (!target) return false;

    const before = container.querySelectorAll('a[href^="http"]').length;
    target.click();
    await settle(container, 1600);
    const after = container.querySelectorAll('a[href^="http"]').length;
    return after > before;
  }

  /** Resolve once mutations stop for 250ms, or after timeout. */
  function settle(node, timeout = 1500) {
    return new Promise(resolve => {
      let timer;
      const obs = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(done, 250);
      });
      obs.observe(node, { childList: true, subtree: true, attributes: true });
      const hard = setTimeout(done, timeout);
      function done() {
        clearTimeout(timer); clearTimeout(hard); obs.disconnect(); resolve();
      }
      timer = setTimeout(done, 250);
    });
  }

  /** Wait for AIO to appear at all — it streams in after page load. */
  function waitForAIO(timeout = 6000) {
    return new Promise(resolve => {
      const existing = findContainer();
      if (existing) return resolve(existing);
      const root = document.querySelector('#center_col') || document.body;
      const obs = new MutationObserver(() => {
        const found = findContainer();
        if (found) { obs.disconnect(); clearTimeout(hard); resolve(found); }
      });
      obs.observe(root, { childList: true, subtree: true });
      const hard = setTimeout(() => { obs.disconnect(); resolve(null); }, timeout);
    });
  }

  function hostOf(url) {
    try {
      const h = new URL(url).hostname.replace(/^www\./, '');
      return h;
    } catch { return null; }
  }

  // Anchored at a label boundary — see SPS.hostMatches. Plain endsWith() treats
  // "notgoogle.com" as Google's own and silently drops it from the citation
  // list, which undercounts exactly the number that has to be right.
  function isGoogleInternal(url) {
    const h = hostOf(url) || '';
    if (!h) return false;
    if (SPS.hostMatches(h, 'google.com') || SPS.hostMatches(h, 'gstatic.com')) return true;
    if (SPS.hostMatches(h, 'youtube.com') && url.includes('/redirect')) return true;
    return false;
  }

  /** Extract every cited source: domain, url, title, whether in the collapsed view. */
  function citations(container) {
    if (!container) return [];
    const seen = new Map();
    const links = container.querySelectorAll('a[href^="http"]');
    for (const a of links) {
      const href = a.href;
      if (isGoogleInternal(href)) continue;
      const host = hostOf(href);
      if (!host) continue;
      const rect = a.getBoundingClientRect();
      const entry = seen.get(host);
      const title = (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 140);
      if (!entry) {
        seen.set(host, {
          domain: host,
          url: href,
          title,
          count: 1,
          visible: rect.height > 0 && rect.width > 0
        });
      } else {
        entry.count += 1;
        if (!entry.title && title) entry.title = title;
        if (rect.height > 0) entry.visible = true;
      }
    }
    return [...seen.values()].sort((a, b) => b.count - a.count);
  }

  /** Does the client own any cited domain? */
  function citationMatch(cites, ownedDomains) {
    if (!ownedDomains || !ownedDomains.length) return { cited: false, matched: [] };
    const matched = cites.filter(c => SPS.hostMatchesAny(c.domain, ownedDomains));
    return { cited: matched.length > 0, matched };
  }

  // Expansion is a CLICK, and a click mutates the page. Re-running it on every
  // scan makes the scan its own trigger: click -> mutation -> rescan -> click.
  // Expand at most once per URL, and remember the outcome for later scans.
  let expandState = { url: null, done: false, changed: false };

  async function expandOnce(container) {
    if (expandState.url === location.href && expandState.done) return expandState.changed;
    expandState = { url: location.href, done: true, changed: false };
    expandState.changed = await expand(container);
    return expandState.changed;
  }

  /** Full read. Call this once per scan. */
  async function read(ownedDomains) {
    const container = await waitForAIO();
    if (!container) {
      return { present: false, expanded: false, citations: [], cited: false, matched: [], geometry: null };
    }
    const expanded = await expandOnce(container);
    const cites = citations(container);
    const { cited, matched } = citationMatch(cites, ownedDomains);
    return {
      present: true,
      expanded,
      citations: cites,
      cited,
      matched,
      geometry: SPS_MEASURE.docOffset(container),
      container
    };
  }

  return { read, findContainer, expand, expandOnce, citations, citationMatch, waitForAIO, settle };
})();

if (typeof globalThis !== 'undefined') globalThis.SPS_AIO = SPS_AIO;
