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
    // Stay deaf to our own overlay writes and to the AI Overview expansion click.
    state.stopObserving?.();

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
      let lastResultCTR = null;
      for (const el of elements) {
        el.xLeft = el.xLeft ?? SPS_MEASURE.docOffset(el.node).xLeft;
        el.pixelShare = SPS_MEASURE.pixelShare(el.height, serpHeight);
        el.foldFlags = SPS_MEASURE.foldFlags(el.yTop);
        el.mobileY = SPS_MEASURE.projectMobileY(el.yTop, typesAbove);

        const yForModel = viewport === 'mobile' && realDevice !== 'mobile' ? el.mobileY : el.yTop;
        el.estCTR = SPS_MODEL.estimate({ ...el, yTop: yForModel }, [...typesAbove], viewport);

        if (el.type === SPS.TYPES.ORGANIC || el.type === SPS.TYPES.SOCIAL) {
          el.effectivePos = SPS_MODEL.effectivePosition(el.estCTR, viewport);
          lastResultCTR = el.estCTR;
        }

        // A sitelink is a sub-link of the result above it and cannot attract
        // more clicks than that result does. The two are scored independently,
        // so without this the arithmetic can invert.
        if (el.type === SPS.TYPES.SITELINK && lastResultCTR != null) {
          el.estCTR = Math.min(el.estCTR, lastResultCTR);
        }
        // Only main-column features displace what follows them. A right-hand
        // knowledge panel overlaps the same y range without pushing anything
        // down, so counting it as "above" over-suppresses every result.
        if (el.column !== 'right' &&
            el.type !== SPS.TYPES.ORGANIC && el.type !== SPS.TYPES.SITELINK &&
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

      // Rendering clears and rebuilds every overlay node, which reads as a
      // flicker. Google mutates the SERP constantly, so most re-scans produce
      // an identical layout — skip the redraw unless something we draw changed.
      const sig = elements
        .map(e => `${e.type}:${e.yTop}:${e.height}:${Math.round((e.estCTR || 0) * 1e4)}:${e.actualCTR ?? ''}`)
        .join('|') + `|${state.settings.overlayMode}|${state.settings.viewport}`;

      if (sig !== state.overlaySig) {
        state.overlaySig = sig;
        SPS_OVERLAY.render(elements, {
          settings: state.settings,
          summary,
          serpHeight,
          serpTop,
          showSitelinks: false
        });
      }

      chrome.runtime.sendMessage({ type: 'SPS_SCAN_RESULT', payload: state.scan });
      return state.scan;

    } catch (err) {
      console.error('[SPS] scan failed', err);
      chrome.runtime.sendMessage({ type: 'SPS_SCAN_ERROR', error: String(err?.message || err) });
      return null;
    } finally {
      state.busy = false;
      state.markScanned?.();
      // Let the DOM settle after our writes before listening again, so the
      // overlay we just drew cannot register as a reason to redraw it.
      setTimeout(() => state.startObserving?.(), 400);
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

  // Re-scan when Google swaps results in without a navigation (continuous
  // scroll, filter chips, AIO streaming in late).
  //
  // This has to be defensive. A scan renders overlay nodes and the AI Overview
  // expansion clicks the page, so a naive observer treats the scan's own side
  // effects as a reason to scan again and the page never settles. Three guards:
  // ignore mutations we caused, stay disconnected while scanning, and never
  // auto-scan more often than MIN_RESCAN_GAP.
  const MIN_RESCAN_GAP = 3000;
  let debounce;
  let lastScanAt = 0;
  let observing = false;

  function isOurs(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.id === 'sps-overlay-root') return true;
    const cls = typeof node.className === 'string' ? node.className : '';
    if (cls.startsWith('sps-') || cls.includes(' sps-')) return true;
    return !!(node.closest && node.closest('#sps-overlay-root, .sps-hud'));
  }

  const obs = new MutationObserver(records => {
    // Only structural changes to Google's own DOM count.
    const relevant = records.some(r =>
      r.type === 'childList' &&
      !isOurs(r.target) &&
      [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === 1 && !isOurs(n))
    );
    if (!relevant) return;

    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (state.busy) return;
      const since = Date.now() - lastScanAt;
      if (since < MIN_RESCAN_GAP) {
        // Too soon — check back once the floor has passed instead of dropping it.
        clearTimeout(debounce);
        debounce = setTimeout(() => { if (!state.busy) scan(); }, MIN_RESCAN_GAP - since);
        return;
      }
      scan();
    }, 900);
  });

  const target = document.querySelector('#center_col') || document.body;
  function startObserving() {
    if (observing) return;
    observing = true;
    obs.observe(target, { childList: true, subtree: true });
  }
  function stopObserving() {
    if (!observing) return;
    observing = false;
    obs.disconnect();
  }

  // Exposed so scan() can bracket its own DOM writes.
  state.startObserving = startObserving;
  state.stopObserving = stopObserving;
  state.markScanned = () => { lastScanAt = Date.now(); };

  startObserving();

  /**
   * Structural fingerprint of a node, for offline selector work.
   * Deliberately records the anchors we are ALLOWED to key on (id, data-*,
   * role, jsname presence, heading nesting) and never the hashed class names,
   * so a diagnostic captured today is still readable after Google rotates them.
   */
  function fingerprint(node) {
    if (!node) return null;
    const attrs = {};
    for (const a of node.attributes || []) {
      if (a.name === 'class' || a.name === 'style') continue;
      if (/^(id|role|jsname|aria-label|data-.*)$/.test(a.name)) {
        attrs[a.name] = a.value.slice(0, 60);
      }
    }
    const parent = node.parentElement;
    return {
      tag: node.tagName.toLowerCase(),
      attrs,
      parent: parent ? { tag: parent.tagName.toLowerCase(), id: parent.id || null } : null,
      headings: [...node.querySelectorAll('h1,h2,h3,[role="heading"]')]
        .slice(0, 3).map(h => (h.textContent || '').trim().slice(0, 60)),
      linkCount: node.querySelectorAll('a[href^="http"]').length,
      firstText: (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120)
    };
  }

  /**
   * Full diagnostic. This is the artefact to send back when a selector is
   * wrong: it pairs what the classifier decided with enough structure to see
   * what it should have decided.
   */
  async function diagnostic() {
    const s = state.scan || await scan();
    if (!s) return { ok: false, error: 'Scan produced no result.' };

    const aioContainer = SPS_AIO.findContainer();
    const unclassified = [];
    document.querySelectorAll('#rso > div, #center_col > div').forEach(n => {
      if (!SPS_MEASURE.isRendered(n)) return;
      if (SPS_MEASURE.docOffset(n).height < 120) return;
      unclassified.push({ ...fingerprint(n), geometry: SPS_MEASURE.docOffset(n) });
    });

    return {
      capturedAt: new Date().toISOString(),
      extensionVersion: SPS.VERSION,
      url: location.href,
      query: queryFromUrl(),
      userAgent: navigator.userAgent,
      innerWidth: window.innerWidth,
      summary: s.summary,
      elements: s.elements.map(e => ({
        type: e.type, rank: e.rank ?? null, yTop: e.yTop, height: e.height,
        domain: e.domain ?? null, title: (e.title || '').slice(0, 80),
        estCTR: e.estCTR, effectivePos: e.effectivePos ?? null, owned: !!e.owned
      })),
      aio: {
        containerFound: !!aioContainer,
        fingerprint: fingerprint(aioContainer),
        citations: s.summary.aioCitations,
        expanded: s.summary.aioExpanded
      },
      mainColumnBlocks: unclassified
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg.type === 'SPS_REQUEST_DIAGNOSTIC') {
      diagnostic().then(d => respond({ ok: true, diagnostic: d }))
        .catch(e => respond({ ok: false, error: String(e?.message || e) }));
      return true;
    }
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
      state.overlaySig = null; // forget the cache, or the next scan skips redraw
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
