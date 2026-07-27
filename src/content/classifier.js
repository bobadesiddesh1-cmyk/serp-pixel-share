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
    if (!domain || !ownedDomains?.length) return false;
    return ownedDomains
      .map(d => d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase())
      .some(o => domain === o || domain.endsWith('.' + o));
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
    const out = [];
    const blocks = document.querySelectorAll('#center_col div[jsname], #rso > div');
    for (const b of blocks) {
      const rows = b.querySelectorAll('[role="button"][aria-expanded], div[jsname][role="button"]');
      if (rows.length >= 3 && b.querySelectorAll('a[href^="http"]').length <= rows.length * 3) {
        if (!out.some(o => o.contains(b) || b.contains(o))) out.push(b);
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

  function localPack() {
    const sel = ['[data-async-context*="local"]', '#rso [data-record-hover]',
                 '[aria-label*="Places" i]', '#lclbjs'].join(',');
    return uniqueBlocks(document.querySelectorAll(sel), 2);
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
        .filter(a => SPS.FORUM_HOSTS.some(f => (hostOf(a.href) || '').endsWith(f)));
      if (forumLinks.length >= 2) {
        const parent = forumLinks[0].closest('#rso > div, div[jsname]');
        if (parent) out.push(parent);
      }
    }
    return out;
  }

  function topStories() {
    const heads = [...document.querySelectorAll('#center_col [role="heading"], #center_col h2')]
      .filter(h => /top stories|news/i.test(h.textContent || ''));
    return heads.map(h => h.closest('div[jsname], #rso > div, #center_col > div')).filter(Boolean);
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
  function organics(excludeNodes) {
    const out = [];
    const anchors = document.querySelectorAll('#search a h3, #rso a h3, #center_col a h3');
    for (const h3 of anchors) {
      const a = h3.closest('a[href^="http"]');
      if (!a) continue;
      const block = a.closest('#rso > div, #search .g, div[data-hveid], div[jsname]') || a.parentElement;
      if (!block || !SPS_MEASURE.isRendered(block)) continue;
      if (excludeNodes.some(n => n.contains(block) || n === block)) continue;
      if (block.querySelector('[data-text-ad]') || block.closest('#tads, #tadsb, #bottomads')) continue;
      if (out.some(o => o.block === block)) continue;

      // Sitelinks: extra anchors inside the same block, below the h3
      const h3Y = SPS_MEASURE.docOffset(h3).yTop;
      const sitelinks = [...block.querySelectorAll('a[href^="http"]')]
        .filter(x => x !== a && !x.contains(h3) && SPS_MEASURE.isRendered(x) &&
                     SPS_MEASURE.docOffset(x).yTop > h3Y &&
                     (x.textContent || '').trim().length > 3)
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

  function push(list, node, type, extra = {}) {
    if (!node || !SPS_MEASURE.isRendered(node)) return;
    const g = SPS_MEASURE.docOffset(node);
    list.push({
      type,
      label: SPS.LABELS[type] || type,
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
      const isSocial = SPS.SOCIAL_HOSTS.some(s => (domain || '').endsWith(s));
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
    const claimed = list.map(e => e.node);
    document.querySelectorAll('#rso > div, #center_col > div').forEach(n => {
      if (!SPS_MEASURE.isRendered(n)) return;
      if (SPS_MEASURE.docOffset(n).height < 120) return;
      if (claimed.some(c => c === n || c.contains(n) || n.contains(c))) return;
      if (!n.querySelector('a[href^="http"]')) return;
      push(list, n, T.UNCLASSIFIED);
    });

    list.sort((a, b) => a.yTop - b.yTop);
    return list;
  }

  return { run, hostOf, isOwned };
})();

if (typeof globalThis !== 'undefined') globalThis.SPS_CLASSIFY = SPS_CLASSIFY;
