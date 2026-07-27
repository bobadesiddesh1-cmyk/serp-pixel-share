// Orchestrator. Runs the scan pipeline, publishes the result, keeps it fresh.
//
// Pipeline:
//   settings -> wait for AIO -> classify -> measure -> estimate -> normalise
//   -> attach GSC actuals -> render overlay -> publish to background

(async function () {
  if (window.__spsBooted) return;
  window.__spsBooted = true;

  const state = { settings: null, scan: null, busy: false };

  async function getSettings() {
    const got = await chrome.storage.local.get(SPS.STORAGE.SETTINGS);
    return { ...SPS.DEFAULT_SETTINGS, ...(got[SPS.STORAGE.SETTINGS] || {}) };
  }

  async function loadModelOverrides() {
    const got = await chrome.storage.local.get(SPS.STORAGE.MODEL);
    SPS_MODEL.applyOverrides(got[SPS.STORAGE.MODEL] || {});
  }

  function queryFromUrl() {
    const p = new URLSearchParams(location.search);
    return (p.get('q') || '').trim();
  }

  function deviceFromUrl() {
    // Google serves a mobile layout when the UA is mobile; we detect it so the
    // model uses the mobile curve rather than projecting.
    return /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  }

  async function scan() {
    if (state.busy) return state.scan;
    state.busy = true;

    try {
      state.settings = await getSettings();
      await loadModelOverrides();

      const viewport = state.settings.viewport || 'desktop';
      const realDevice = deviceFromUrl();

      const aioResult = await SPS_AIO.read(state.settings.ownedDomains);
      const elements = SPS_CLASSIFY.run({
        ownedDomains: state.settings.ownedDomains,
        aioResult
      });

      const serpHeight = SPS_MEASURE.serpHeight();
      const serpTop = SPS_MEASURE.serpTop();

      // Estimate. typesAbove is cumulative and order-dependent, so walk in y order.
      const typesAbove = [];
      for (const el of elements) {
        el.xLeft = el.xLeft ?? SPS_MEASURE.docOffset(el.node).xLeft;
        el.pixelShare = SPS_MEASURE.pixelShare(el.height, serpHeight);
        el.foldFlags = SPS_MEASURE.foldFlags(el.yTop);
        el.mobileY = SPS_MEASURE.projectMobileY(el.yTop, typesAbove);

        const yForModel = viewport === 'mobile' && realDevice !== 'mobile' ? el.mobileY : el.yTop;
        el.estCTR = SPS_MODEL.estimate({ ...el, yTop: yForModel }, [...typesAbove], viewport);

        if (el.type === SPS.TYPES.ORGANIC || el.type === SPS.TYPES.SOCIAL) {
          el.effectivePos = SPS_MODEL.effectivePosition(el.estCTR, viewport);
        }
        if (el.type !== SPS.TYPES.ORGANIC && el.type !== SPS.TYPES.SITELINK &&
            el.type !== SPS.TYPES.SOCIAL && el.type !== SPS.TYPES.UNCLASSIFIED) {
          typesAbove.push(el.type);
        }
      }

      const normalised = SPS_MODEL.normalise(elements);
      normalised.forEach((n, i) => { elements[i].shareOfClicks = n.shareOfClicks; });

      const ownedEl = elements.find(e => e.owned && e.type === SPS.TYPES.ORGANIC);

      const summary = {
        query: queryFromUrl(),
        url: location.href,
        scannedAt: Date.now(),
        viewport,
        realDevice,
        count: elements.length,
        serpHeight,
        serpTop,
        aioPresent: aioResult.present,
        aioCited: aioResult.cited,
        aioCitationCount: aioResult.citations.length,
        aioExpanded: aioResult.expanded,
        aioCitations: aioResult.citations,
        aioPixelShare: aioResult.geometry
          ? SPS_MEASURE.pixelShare(aioResult.geometry.height, serpHeight) : 0,
        unclassified: elements.filter(e => e.type === SPS.TYPES.UNCLASSIFIED).length,
        ownedRank: ownedEl?.rank ?? null,
        ownedEffectivePos: ownedEl?.effectivePos ?? null,
        ownedCTR: ownedEl?.estCTR ?? null,
        ownedUrl: ownedEl?.url ?? null,
        adCount: elements.filter(e => e.type === SPS.TYPES.AD).length,
        organicCount: elements.filter(e => e.type === SPS.TYPES.ORGANIC).length
      };

      // GSC actuals, best-effort. Never blocks the render.
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'SPS_GET_ACTUALS',
          query: summary.query,
          pageUrl: summary.ownedUrl
        });
        if (res?.ok && res.data) {
          summary.actual = res.data;
          if (ownedEl) ownedEl.actualCTR = res.data.ctr ?? null;
        }
      } catch (_) { /* panel not open / not authed */ }

      state.scan = { summary, elements: elements.map(serialise) };

      SPS_OVERLAY.render(elements, {
        settings: state.settings,
        summary,
        serpHeight,
        serpTop,
        showSitelinks: false
      });

      chrome.runtime.sendMessage({ type: 'SPS_SCAN_RESULT', payload: state.scan });
      return state.scan;

    } catch (err) {
      console.error('[SPS] scan failed', err);
      chrome.runtime.sendMessage({ type: 'SPS_SCAN_ERROR', error: String(err?.message || err) });
      return null;
    } finally {
      state.busy = false;
    }
  }

  // Strip DOM nodes before crossing the message boundary.
  function serialise(el) {
    const { node, citations, matched, ...rest } = el;
    return {
      ...rest,
      citationCount: citations ? citations.length : undefined,
      citations: citations ? citations.slice(0, 12) : undefined,
      matched: matched ? matched.map(m => m.domain) : undefined
    };
  }

  // Re-scan when Google swaps results in without a navigation (continuous scroll,
  // filter chips, AIO streaming in late).
  let debounce;
  const obs = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { if (!state.busy) scan(); }, 900);
  });
  const target = document.querySelector('#center_col') || document.body;
  obs.observe(target, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg.type === 'SPS_REQUEST_SCAN') {
      scan().then(s => respond({ ok: true, payload: s }));
      return true;
    }
    if (msg.type === 'SPS_SETTINGS_CHANGED') {
      scan().then(() => respond({ ok: true }));
      return true;
    }
    if (msg.type === 'SPS_CLEAR_OVERLAY') {
      SPS_OVERLAY.clear();
      respond({ ok: true });
      return true;
    }
    if (msg.type === 'SPS_GET_CACHED') {
      respond({ ok: true, payload: state.scan });
      return true;
    }
  });

  // First pass. Slight delay lets AIO begin streaming.
  setTimeout(scan, 600);
})();
