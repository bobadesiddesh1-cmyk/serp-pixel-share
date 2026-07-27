// CTR estimation model.
//
//   Est. CTR = BaseCurve(rank) x PixelDecay(y) x FeatureSuppression(elements above)
//
// Every coefficient here is a DEFAULT, meant to be overwritten by calibration
// against your own GSC properties. See calibrate() at the bottom.
// Never present model output as measured truth.

const SPS_MODEL = (() => {
  // ---- 1. Base curve: organic CTR by rank, no SERP features present ----
  // Desktop, informational-commercial blend. Positions 1-20.
  const BASE_CURVE = {
    desktop: [0.279, 0.152, 0.099, 0.071, 0.052, 0.041, 0.033, 0.027, 0.023, 0.020,
              0.017, 0.015, 0.013, 0.012, 0.011, 0.010, 0.009, 0.008, 0.008, 0.007],
    mobile:  [0.242, 0.131, 0.086, 0.062, 0.046, 0.036, 0.029, 0.024, 0.020, 0.017,
              0.015, 0.013, 0.011, 0.010, 0.009, 0.008, 0.008, 0.007, 0.006, 0.006]
  };

  // Non-organic element click share, applied when the element is present.
  // These are shares of total SERP clicks, not CTRs of a ranked link.
  const ELEMENT_SHARE = {
    ai_overview: 0.42,
    ad: 0.030,            // per ad slot
    shopping: 0.055,
    paa: 0.068,
    featured_snippet: 0.185,
    video: 0.032,
    image_pack: 0.028,
    local_pack: 0.115,
    discussions: 0.022,
    social: 0.014,
    knowledge_panel: 0.040,
    top_stories: 0.035,
    related_search: 0.011,
    sitelink: 0.012
  };

  // ---- 2. Pixel decay ----
  // Exponential decay past the fold. Sharper on mobile because scroll cost is higher.
  // decay = exp(-k * max(0, y - fold) / 1000)
  const DECAY_K = { desktop: 0.34, laptop: 0.38, mobile: 0.52 };

  function pixelDecay(y, viewport) {
    const fold = (SPS.VIEWPORTS[viewport] || SPS.VIEWPORTS.desktop).h;
    const k = DECAY_K[viewport] ?? DECAY_K.desktop;
    if (y <= fold) return 1;
    return Math.exp(-k * ((y - fold) / 1000));
  }

  // ---- 3. Feature suppression ----
  // Multiplicative penalty on an organic result for each feature sitting ABOVE it.
  // Calibrate these first — they move the answer more than anything else.
  const SUPPRESSION = {
    ai_overview: 0.35,
    featured_snippet: 0.62,
    paa: 0.78,
    local_pack: 0.60,
    shopping: 0.72,
    video: 0.88,
    image_pack: 0.90,
    top_stories: 0.85,
    discussions: 0.93,
    ad: 0.94,             // compounds per ad slot
    knowledge_panel: 0.97
  };

  function featureSuppression(elementsAbove) {
    let m = 1;
    for (const t of elementsAbove) {
      const s = SUPPRESSION[t];
      if (s) m *= s;
    }
    // Floor it. Below 8% of base the model is extrapolating past any real data.
    return Math.max(m, 0.08);
  }

  // ---- Public API ----

  function baseCTR(rank, viewport) {
    const curve = viewport === 'mobile' ? BASE_CURVE.mobile : BASE_CURVE.desktop;
    if (rank < 1) return curve[0];
    if (rank > curve.length) {
      // Tail: decay from the last known point.
      return curve[curve.length - 1] * Math.pow(0.92, rank - curve.length);
    }
    return curve[rank - 1];
  }

  /**
   * Estimate click share for one element.
   * @param {object} el   - { type, rank, yTop, ownedFlag }
   * @param {string[]} typesAbove - element types positioned above this one
   * @param {string} viewport
   */
  function estimate(el, typesAbove, viewport = 'desktop') {
    const overrides = SPS_MODEL._overrides || {};

    if (el.type === SPS.TYPES.ORGANIC || el.type === SPS.TYPES.SITELINK) {
      const base = baseCTR(el.rank || 20, viewport);
      const decay = pixelDecay(el.yTop, viewport);
      const supp = featureSuppression(typesAbove);
      const raw = base * decay * supp;
      return clamp(raw);
    }

    const share = overrides[el.type] ?? ELEMENT_SHARE[el.type] ?? 0.01;
    const decay = pixelDecay(el.yTop, viewport);
    // Non-organic blocks are less position-sensitive: soften the decay.
    return clamp(share * (0.45 + 0.55 * decay));
  }

  /**
   * Effective position: the organic rank whose BASE curve value matches this
   * element's suppressed, decayed estimate. Answers "what does #2 actually feel like".
   */
  function effectivePosition(estCTR, viewport = 'desktop') {
    const curve = viewport === 'mobile' ? BASE_CURVE.mobile : BASE_CURVE.desktop;
    for (let i = 0; i < curve.length; i++) {
      if (estCTR >= curve[i]) return i + 1;
    }
    return curve.length + Math.ceil(Math.log(estCTR / curve[curve.length - 1]) / Math.log(0.92)) || curve.length + 1;
  }

  /**
   * Normalise a scan's estimates so total click share sums to ~1.
   * Keeps the ranking intact, makes the bars honest.
   */
  function normalise(elements) {
    const total = elements.reduce((s, e) => s + (e.estCTR || 0), 0);
    if (total <= 0) return elements;
    const f = 1 / total;
    return elements.map(e => ({ ...e, shareOfClicks: (e.estCTR || 0) * f }));
  }

  /**
   * Calibrate suppression coefficients from your own GSC data.
   * rows: [{ query, position, ctr, aioPresent, featuresAbove: [] }]
   * Solves per-feature: observed CTR / expected-without-feature, median across queries.
   */
  function calibrate(rows, viewport = 'desktop') {
    const buckets = {};
    for (const r of rows) {
      if (!r.position || !r.ctr) continue;
      const expected = baseCTR(Math.round(r.position), viewport);
      if (expected <= 0) continue;
      const ratio = r.ctr / expected;
      const feats = r.featuresAbove && r.featuresAbove.length
        ? r.featuresAbove
        : (r.aioPresent ? ['ai_overview'] : []);
      if (feats.length !== 1) continue;   // only single-feature rows are cleanly attributable
      const f = feats[0];
      (buckets[f] ||= []).push(ratio);
    }
    const out = {};
    for (const [f, arr] of Object.entries(buckets)) {
      if (arr.length < 8) continue;       // not enough signal
      arr.sort((a, b) => a - b);
      out[f] = round(arr[Math.floor(arr.length / 2)], 3);
      out[f + '__n'] = arr.length;
    }
    return out;
  }

  function applyOverrides(o) { SPS_MODEL._overrides = o || {}; }

  function clamp(v) { return Math.max(0, Math.min(1, v)); }
  function round(v, d = 4) { const m = Math.pow(10, d); return Math.round(v * m) / m; }

  return {
    BASE_CURVE, ELEMENT_SHARE, SUPPRESSION, DECAY_K,
    baseCTR, pixelDecay, featureSuppression,
    estimate, effectivePosition, normalise, calibrate, applyOverrides,
    _overrides: {}
  };
})();

if (typeof globalThis !== 'undefined') globalThis.SPS_MODEL = SPS_MODEL;
if (typeof module !== 'undefined') module.exports = SPS_MODEL;
