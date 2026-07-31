// SERP element classifier.
//
// Rule: never anchor on generated class names (.MjjYud, .g-blk, .kvH3mc).
// Google rotates them weekly. Anchor on ids, data-* attributes, role, href
// patterns, and structure.
//
// Output: flat array of elements sorted by document y, each with type, rank,
// geometry, domain, ownership flag.

const SPS_CLASSIFY = (() => {
  const T = SPS.TYPES;

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
    catch { return null; }
  }

  function isOwned(domain, ownedDomains) {
    return SPS.hostMatchesAny(domain, ownedDomains);
  }

  // ---- Individual detectors. Each returns an array of raw nodes. ----

  function ads() {
    const sel = [
      '[data-text-ad]',
      '#tads > div', '#tadsb > div',
      '[aria-label="Ads"] > div',
      '#bottomads > div'
    ].join(',');
    return uniqueBlocks(document.querySelectorAll(sel));
  }

  function shopping() {
    const sel = [
      '[data-attrid*="shopping" i]',
      'g-scrolling-carousel [data-docid]',
      '[data-pla]',
      '#rso [aria-label*="product" i]'
    ].join(',');
    return uniqueBlocks(document.querySelectorAll(sel));
  }

  function paa() {
    // PAA = a block of accordion rows, each role=button, inside #center_col.
    //
    // Resolve from the ROWS OUTWARD to the tightest container holding at least
    // three of them. Scanning containers inward instead lets any ancestor that
    // merely CONTAINS a PAA block match — including the group wrapper Google
    // puts around consecutive organic results, which then swallows every
    // result inside it.
    const out = [];
    const rows = document.querySelectorAll(
      '#center_col [role="button"][aria-expanded], #center_col div[jsname][role="button"]'
    );
    for (const row of rows) {
      let el = row.parentElement;
      for (let i = 0; i < 6 && el && el.id !== 'rso' && el.id !== 'center_col'; i++) {
        const n = el.querySelectorAll('[role="button"][aria-expanded], div[jsname][role="button"]').length;
        if (n >= 3) {
          // A real PAA block is mostly rows, not a result list with an accordion in it.
          if (el.querySelectorAll('h3').length === 0 &&
              !out.some(o => o.contains(el) || el.contains(o))) out.push(el);
          break;
        }
        el = el.parentElement;
      }
    }
    // Label fallback
    const labelled = [...document.querySelectorAll('#center_col [role="heading"], #center_col h2')]
      .filter(h => /people also ask|अन्य लोग यह भी पूछते/i.test(h.textContent || ''));
    for (const l of labelled) {
      const blk = l.closest('div[jsname], #rso > div, #center_col > div');
      if (blk && !out.includes(blk)) out.push(blk);
    }
    return out;
  }

  function featuredSnippet() {
    const sel = [
      '[data-attrid*="wa:/description"]',
      '#rso > div:first-child [data-attrid]',
      'block-component'
    ].join(',');
    const cands = [...document.querySelectorAll(sel)];
    // A featured snippet sits first, has a boxed callout and a single source link.
    return cands.filter(c => {
      const m = SPS_MEASURE.docOffset(c);
      return m.height > 100 && c.querySelectorAll('a[href^="http"]').length <= 3;
    }).slice(0, 1);
  }

  function videos() {
    const sel = [
      '[data-attrid*="video" i]',
      '#rso a[href*="youtube.com/watch"]',
      'g-scrolling-carousel a[href*="youtube.com"]',
      '[aria-label*="video" i]'
    ].join(',');
    return uniqueBlocks(document.querySelectorAll(sel), 2);
  }

  function imagePack() {
    const sel = ['[data-attrid*="images" i]', '#iur', 'g-section-with-header a[href*="/imgres"]',
                 '#rso [data-lpage] img'].join(',');
    return uniqueBlocks(document.querySelectorAll(sel), 3);
  }

  /** True when a node wraps the organic results list rather than one feature. */
  function wrapsResultsList(el) {
    return !!el && el.querySelectorAll('a h3').length >= 2;
  }

  /**
   * Resolve a section from its heading OUTWARD to the tightest ancestor that is
   * big enough to be the section but does not swallow the results list.
   *
   * closest() cannot do this. On a live SERP the "Local results" heading's
   * nearest structural ancestor was a 2,402px `#rso > div` that also contained
   * organic results 3-6 — accepting it would double-count them, and rejecting
   * it outright loses the local pack entirely. The section itself sits between
   * the two.
   */
  function blockFromLabel(heading, minHeight = 80) {
    let el = heading.parentElement;
    for (let i = 0; i < 8 && el; i++) {
      if (['rso', 'search', 'center_col', 'rcnt'].includes(el.id)) break;
      if (wrapsResultsList(el)) break;
      if (SPS_MEASURE.docOffset(el).height >= minHeight) return el;
      el = el.parentElement;
    }
    return null;
  }

  const LOCAL_LABEL = /^(local results|places|locations|nearby|businesses)\b/i;

  function localPack() {
    const sel = ['[data-async-context*="local"]', '#rso [data-record-hover]',
                 '[aria-label*="Places" i]', '#lclbjs'].join(',');
    const out = uniqueBlocks(document.querySelectorAll(sel), 2);

    // Attribute selectors matched neither of two real local packs. Google labels
    // the section, so read the label — across h1..h3 as well as role=heading,
    // because the observed markup used a level the narrower selector missed.
    const heads = [...document.querySelectorAll(
      '#center_col h1, #center_col h2, #center_col h3, #center_col [role="heading"]'
    )].filter(h => LOCAL_LABEL.test((h.textContent || '').trim()));

    for (const h of heads) {
      const blk = blockFromLabel(h);
      if (!blk) continue;
      if (!blk.querySelector('a[href^="http"]')) continue;   // a pack links somewhere
      if (out.some(o => o === blk || o.contains(blk) || blk.contains(o))) continue;
      out.push(blk);
    }
    return out;
  }

  function discussions() {
    const out = [];
    const heads = [...document.querySelectorAll('#center_col [role="heading"], #center_col h2, #center_col h3')]
      .filter(h => /discussions and forums|discussions/i.test(h.textContent || ''));
    for (const h of heads) {
      const blk = h.closest('div[jsname], #rso > div, #center_col > div');
      if (blk) out.push(blk);
    }
    // Fallback: cluster of forum-host links
    if (!out.length) {
      const forumLinks = [...document.querySelectorAll('#rso a[href^="http"]')]
        .filter(a => SPS.hostMatchesAny(hostOf(a.href), SPS.FORUM_HOSTS));
      if (forumLinks.length >= 2) {
        const parent = forumLinks[0].closest('#rso > div, div[jsname]');
        if (parent) out.push(parent);
      }
    }
    return out;
  }

  function topStories() {
    // A bare /news/ match is far too loose — the word appears in result titles
    // and section labels all over a SERP, and on a live capture it claimed a
    // 2,692px local-results block. Anchor on the section label itself, and
    // never accept a node that wraps the results list.
    const heads = [...document.querySelectorAll('#center_col [role="heading"], #center_col h2')]
      .filter(h => /^(top stories|news|latest news)\b/i.test((h.textContent || '').trim()));
    return heads
      .map(h => h.closest('div[jsname], #rso > div, #center_col > div'))
      .filter(b => b && !wrapsResultsList(b));
  }

  function knowledgePanel() {
    const kp = document.querySelector('#rhs, [data-attrid="kc:/"], #rhs_block');
    return kp && SPS_MEASURE.isRendered(kp) ? [kp] : [];
  }

  function relatedSearches() {
    const heads = [...document.querySelectorAll('#botstuff [role="heading"], #botstuff h2, #bres')]
      .filter(h => /related searches|people also search/i.test(h.textContent || '') || h.id === 'bres');
    return heads.map(h => h.closest('#bres, #botstuff > div') || h).filter(Boolean);
  }

  /**
   * Organic results. The critical detector.
   * Anchor: an <a> wrapping an <h3>, inside #rso / #search, not inside an ad container.
   */
  /**
   * Resolve the outermost node that still represents exactly ONE result.
   *
   * closest() returns the NEAREST ancestor matching any selector, which on
   * current Google markup is usually an inner fragment wrapper, not the whole
   * listing — that under-measures height and mis-places the overlay. Instead
   * climb until the ancestor starts covering a second h3, and keep the last
   * one that still held exactly one.
   */
  function resultBlock(anchor) {
    const STOP = new Set(['rso', 'search', 'center_col', 'rcnt', 'main']);
    let best = anchor.parentElement;
    let el = anchor.parentElement;
    let bestH = best ? SPS_MEASURE.docOffset(best).height : 0;

    for (let i = 0; i < 12 && el && el !== document.body; i++) {
      if (el.id && STOP.has(el.id)) break;

      // Stop when an ancestor adds a lot of height the result itself does not
      // explain. Counting h3s is not enough on its own: a container holding one
      // result plus unrelated content still has exactly one heading, and the
      // climb happily took it — turning a 102px result into a 900px one and
      // inflating its pixel share ninefold. Real result blocks are ~100-200px.
      const h = SPS_MEASURE.docOffset(el).height;
      if (bestH > 0 && h > Math.max(bestH * 1.8, bestH + 140)) break;

      // Covering a second h3 means we have climbed into a group of results.
      // This test must come BEFORE the direct-child shortcut below: Google
      // wraps consecutive organic results in a single #rso > div, so accepting
      // "direct child of the results container" without counting headings
      // collapses the whole group into one element and every result after the
      // first disappears.
      if (el.querySelectorAll('h3').length > 1) break;
      best = el;
      bestH = h;

      const p = el.parentElement;
      if (p && p.id && STOP.has(p.id)) break; // canonical single-result block
      el = p;
    }
    return best;
  }

  function organics(excludeNodes) {
    const out = [];
    const anchors = document.querySelectorAll('#search a h3, #rso a h3, #center_col a h3');
    for (const h3 of anchors) {
      const a = h3.closest('a[href^="http"]');
      if (!a) continue;
      const block = resultBlock(a);
      if (!block || !SPS_MEASURE.isRendered(block)) continue;
      if (excludeNodes.some(n => n.contains(block) || n === block)) continue;
      if (block.querySelector('[data-text-ad]') || block.closest('#tads, #tadsb, #bottomads')) continue;
      if (out.some(o => o.block === block)) continue;

      // Sitelinks: extra anchors inside the same block, below the h3
      // Sitelinks: extra anchors below the h3, on the SAME host as the result.
      // Without the host test this also swallows "About this result", cached
      // links and breadcrumb chips, which inflates the element count and skews
      // the normalised click share.
      const h3Y = SPS_MEASURE.docOffset(h3).yTop;
      const mainHost = hostOf(a.href);
      const sitelinks = [...block.querySelectorAll('a[href^="http"]')]
        .filter(x => x !== a && !x.contains(h3) && SPS_MEASURE.isRendered(x) &&
                     SPS_MEASURE.docOffset(x).yTop > h3Y &&
                     (x.textContent || '').trim().length > 3 &&
                     x.href !== a.href &&
                     hostOf(x.href) === mainHost)
        .slice(0, 6);

      out.push({ block, anchor: a, title: (h3.textContent || '').trim(), sitelinks });
    }
    return out;
  }

  // ---- helpers ----

  function uniqueBlocks(nodeList, climb = 0) {
    const out = [];
    for (let n of nodeList) {
      if (!n) continue;
      for (let i = 0; i < climb; i++) n = n.parentElement || n;
      if (!SPS_MEASURE.isRendered(n)) continue;
      if (out.some(o => o.contains(n) || n.contains(o))) continue;
      out.push(n);
    }
    return out;
  }

  // A feature block that renders a few pixels tall is a fragment the resolver
  // landed on, not the feature. Live captures produced People Also Ask blocks
  // of 23px and 44px alongside the real 200px+ ones. Sitelinks are genuinely
  // single-line, so they are exempt.
  const MIN_FEATURE_HEIGHT = 48;
  const THIN_OK = ['organic', 'sitelink', 'social', 'unclassified'];

  function push(list, node, type, extra = {}) {
    if (!node || !SPS_MEASURE.isRendered(node)) return;
    if (!THIN_OK.includes(type) &&
        SPS_MEASURE.docOffset(node).height < MIN_FEATURE_HEIGHT) return;
    // Several detectors can legitimately resolve to the same node (a heading's
    // closest() and a container id, for example). Counting it twice doubles its
    // pixel share and corrupts the normalised click share.
    if (list.some(e => e.node === node)) return;
    const g = SPS_MEASURE.docOffset(node);

    // Node identity is not enough. Observed on a live SERP: two People Also Ask
    // containers covering [1347-1593] and [1383-1593] — geometrically nested,
    // but NOT in a DOM ancestor/descendant relationship, so contains() missed
    // it. Same-type blocks that occupy the same vertical space are one block;
    // keep the outer and drop the subset.
    const OVERLAP = 0.6;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.type !== type) continue;
      const top = Math.max(e.yTop, g.yTop);
      const bottom = Math.min(e.yBottom, g.yBottom);
      const shared = bottom - top;
      if (shared <= 0) continue;
      const smaller = Math.min(e.height, g.height);
      if (smaller <= 0 || shared / smaller < OVERLAP) continue;
      if (g.height <= e.height) return;          // new one is the subset — drop it
      list.splice(i, 1); i--;                    // new one is the superset — replace
    }
    list.push({
      type,
      label: SPS.LABELS[type] || type,
      // Right-hand-column blocks share the vertical range of the results column
      // but do not displace it. Recorded so the model can skip them when
      // accumulating what sits ABOVE a result.
      column: node.closest && node.closest('#rhs, #rhs_block') ? 'right' : 'main',
      yTop: g.yTop,
      yBottom: g.yBottom,
      height: g.height,
      width: g.width,
      node,
      ...extra
    });
  }

  /**
   * Full classification pass.
   * @param {object} opts { ownedDomains, aioResult }
   */
  function run(opts = {}) {
    const owned = opts.ownedDomains || [];
    const aio = opts.aioResult;
    const list = [];
    const exclude = [];

    if (aio?.present && aio.container) {
      exclude.push(aio.container);
      push(list, aio.container, T.AI_OVERVIEW, {
        citations: aio.citations,
        cited: aio.cited,
        matched: aio.matched,
        expanded: aio.expanded,
        owned: aio.cited
      });
    }

    const adNodes = ads();
    adNodes.forEach(n => { exclude.push(n); push(list, n, T.AD); });

    shopping().forEach(n => { exclude.push(n); push(list, n, T.SHOPPING); });
    featuredSnippet().forEach(n => { exclude.push(n); push(list, n, T.FEATURED_SNIPPET); });
    paa().forEach(n => { exclude.push(n); push(list, n, T.PAA); });
    localPack().forEach(n => { exclude.push(n); push(list, n, T.LOCAL_PACK); });
    videos().forEach(n => { exclude.push(n); push(list, n, T.VIDEO); });
    imagePack().forEach(n => { exclude.push(n); push(list, n, T.IMAGE_PACK); });
    topStories().forEach(n => { exclude.push(n); push(list, n, T.TOP_STORIES); });
    discussions().forEach(n => { exclude.push(n); push(list, n, T.DISCUSSIONS); });
    knowledgePanel().forEach(n => push(list, n, T.KNOWLEDGE_PANEL));
    relatedSearches().forEach(n => push(list, n, T.RELATED_SEARCH));

    // Organic last, excluding everything already claimed.
    const orgs = organics(exclude);
    orgs.sort((a, b) => SPS_MEASURE.docOffset(a.block).yTop - SPS_MEASURE.docOffset(b.block).yTop);

    orgs.forEach((o, i) => {
      const domain = hostOf(o.anchor.href);
      const isSocial = SPS.hostMatchesAny(domain, SPS.SOCIAL_HOSTS);
      const type = isSocial ? T.SOCIAL : T.ORGANIC;
      push(list, o.block, type, {
        rank: i + 1,
        domain,
        url: o.anchor.href,
        title: o.title,
        owned: isOwned(domain, owned),
        sitelinkCount: o.sitelinks.length
      });
      o.sitelinks.forEach(sl => {
        push(list, sl, T.SITELINK, {
          rank: i + 1,
          domain,
          url: sl.href,
          title: (sl.textContent || '').trim().slice(0, 80),
          owned: isOwned(domain, owned),
          parentRank: i + 1
        });
      });
    });

    // Anything tall and link-bearing in the main column we did not classify.
    //
    // Skipping every node that merely CONTAINS something classified silenced
    // the alarm exactly when it mattered: a live SERP had a 2,402px section we
    // failed to identify, and because a few organic results sat inside it the
    // unclassified count stayed at 0. The counter is the maintenance alarm — it
    // has to fire on a section we missed, not just on an isolated orphan.
    //
    // So: a wrapper is only forgiven if what we DID classify accounts for most
    // of its height. Anything with a large unexplained gap is reported.
    // Thresholds measured against 19 main-column blocks from six live SERPs.
    // Coverage there ran 20-100%; a 50% bar would have fired on a page that was
    // classified correctly. 35% plus a floor on the absolute unexplained height
    // is silent on all 19 while still catching a section-sized hole.
    const claimed = list.map(e => e.node);
    const claimedSpans = list.map(e => [e.yTop, e.yBottom]);
    const COVERAGE_OK = 0.35;
    const MIN_UNEXPLAINED = 500;

    function explainedFraction(g) {
      if (g.height <= 0) return 1;
      let covered = 0;
      // Spans are already in document order and features do not overlap after
      // the dedupe pass, so a simple sum is close enough for an alarm.
      for (const [top, bottom] of claimedSpans) {
        const lo = Math.max(top, g.yTop);
        const hi = Math.min(bottom, g.yBottom);
        if (hi > lo) covered += hi - lo;
      }
      return Math.min(1, covered / g.height);
    }

    document.querySelectorAll('#rso > div, #center_col > div').forEach(n => {
      if (!SPS_MEASURE.isRendered(n)) return;
      const g = SPS_MEASURE.docOffset(n);
      if (g.height < 120) return;
      if (!n.querySelector('a[href^="http"]')) return;
      if (claimed.some(c => c === n)) return;                       // classified outright
      if (claimed.some(c => c.contains(n))) return;                 // inside something classified
      // Contains classified children — forgiven unless a large slice of it is
      // unexplained, which is what a whole missed section looks like.
      if (claimed.some(c => n.contains(c))) {
        const frac = explainedFraction(g);
        if (frac >= COVERAGE_OK) return;
        if (g.height * (1 - frac) < MIN_UNEXPLAINED) return;
      }
      push(list, n, T.UNCLASSIFIED);
    });

    list.sort((a, b) => a.yTop - b.yTop);
    return list;
  }

  return { run, hostOf, isOwned };
})();

if (typeof globalThis !== 'undefined') globalThis.SPS_CLASSIFY = SPS_CLASSIFY;
