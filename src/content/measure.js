// Pixel geometry. Everything is DOCUMENT-relative, never viewport-relative,
// because the user may have scrolled before the scan runs.

const SPS_MEASURE = (() => {

  function docOffset(el) {
    const r = el.getBoundingClientRect();
    return {
      yTop: Math.round(r.top + window.scrollY),
      yBottom: Math.round(r.bottom + window.scrollY),
      xLeft: Math.round(r.left + window.scrollX),
      height: Math.round(r.height),
      width: Math.round(r.width)
    };
  }

  function isRendered(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.height < 8 || r.width < 40) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    return true;
  }

  /**
   * Total measurable SERP height — used as the denominator for pixel share.
   * Prefers the main results column so the right-hand knowledge panel and the
   * page footer don't distort the number.
   */
  function serpHeight() {
    const main = document.querySelector('#rcnt, #center_col, [role="main"]');
    if (main) {
      const m = docOffset(main);
      if (m.height > 400) return m.height;
    }
    return Math.max(document.documentElement.scrollHeight, 1);
  }

  function serpTop() {
    const main = document.querySelector('#rcnt, #center_col, [role="main"]');
    return main ? docOffset(main).yTop : 0;
  }

  /**
   * Fold flags for each simulated viewport. We do not resize the window —
   * we compare measured y against each viewport's height, which is what
   * actually matters for "would this be visible without scrolling".
   */
  function foldFlags(yTop) {
    const out = {};
    for (const [k, v] of Object.entries(SPS.VIEWPORTS)) {
      out[k] = yTop <= v.h;
    }
    return out;
  }

  /**
   * Mobile SERPs are not just narrower — feature blocks are taller and stack
   * differently. Without a real mobile render we approximate: scale desktop y
   * by the observed width ratio and inflate feature block heights.
   */
  function projectMobileY(yTop, elementsAbove) {
    const widthRatio = 1920 / 390;              // ~4.9
    const base = yTop / Math.sqrt(widthRatio);  // narrower column = taller content
    const inflate = elementsAbove.reduce((s, t) => {
      if (t === SPS.TYPES.AI_OVERVIEW) return s + 260;
      if (t === SPS.TYPES.AD) return s + 90;
      if (t === SPS.TYPES.PAA) return s + 70;
      if (t === SPS.TYPES.SHOPPING) return s + 140;
      return s;
    }, 0);
    return Math.round(base + inflate);
  }

  /**
   * Depth expressed as what the visitor has to DO, not as a raw number.
   * "826px" only means something to someone who already knows the fold height,
   * which is an assumption the UI should not make about a client reading a report.
   */
  function scrollCost(yTop, viewport = 'desktop') {
    const h = (SPS.VIEWPORTS[viewport] || SPS.VIEWPORTS.desktop).h;
    const screens = Math.max(0, Math.floor((yTop || 0) / h));
    const label = screens === 0 ? 'no scroll'
                : screens === 1 ? '1 scroll'
                : screens + ' scrolls';
    return { screens, label, foldHeight: h };
  }

  /** Total screenfuls a page occupies, for the panel's map header. */
  function screenCount(totalHeight, viewport = 'desktop') {
    const h = (SPS.VIEWPORTS[viewport] || SPS.VIEWPORTS.desktop).h;
    return Math.max(1, Math.ceil((totalHeight || 0) / h));
  }

  function pixelShare(height, total) {
    if (!total) return 0;
    return Math.round((height / total) * 1000) / 1000;
  }

  return { docOffset, isRendered, serpHeight, serpTop, foldFlags, projectMobileY, pixelShare,
           scrollCost, screenCount };
})();

if (typeof globalThis !== 'undefined') globalThis.SPS_MEASURE = SPS_MEASURE;
