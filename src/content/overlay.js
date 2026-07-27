// Overlay renderer. Three modes:
//   inline  - CTR label pinned to the right of each listing (default)
//   boxes   - left-edge accent bar + type tag on each block
//   off     - measure only, draw nothing
// Plus: fold line, pixel ruler in the left gutter, HUD summary bottom-right.

const SPS_OVERLAY = (() => {
  const ROOT_ID = 'sps-overlay-root';

  function root() {
    let r = document.getElementById(ROOT_ID);
    if (!r) {
      r = document.createElement('div');
      r.id = ROOT_ID;
      r.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;';
      document.body.appendChild(r);
    }
    return r;
  }

  function clear() {
    const r = document.getElementById(ROOT_ID);
    if (r) r.textContent = '';
  }

  function pct(v, d = 1) {
    if (v == null || isNaN(v)) return '—';
    return (v * 100).toFixed(d) + '%';
  }

  // ---- inline labels ----

  function drawInline(elements, ctx) {
    const r = root();
    const colX = labelColumnX();

    for (const el of elements) {
      if (el.type === SPS.TYPES.SITELINK && !ctx.showSitelinks) continue;
      if (el.type === SPS.TYPES.RELATED_SEARCH) continue;

      const d = document.createElement('div');
      d.className = 'sps-label';
      if (el.owned && el.type !== SPS.TYPES.AI_OVERVIEW) d.classList.add('sps-label--owned');
      if (el.type === SPS.TYPES.AI_OVERVIEW) d.classList.add('sps-label--aio');
      if (el.type === SPS.TYPES.UNCLASSIFIED) d.classList.add('sps-label--unclassified');

      d.style.top = el.yTop + 'px';
      d.style.left = colX + 'px';

      const ctr = document.createElement('div');
      ctr.className = 'sps-label__ctr';
      ctr.textContent = pct(el.estCTR);
      d.appendChild(ctr);

      const unit = document.createElement('div');
      unit.className = 'sps-label__unit';
      unit.textContent = 'est. CTR';
      d.appendChild(unit);

      if (el.actualCTR != null) {
        const a = document.createElement('div');
        a.className = 'sps-label__actual';
        a.textContent = pct(el.actualCTR);
        d.appendChild(a);
        const au = document.createElement('div');
        au.className = 'sps-label__unit';
        au.textContent = 'GSC actual';
        d.appendChild(au);
      }

      const meta = document.createElement('div');
      meta.className = 'sps-label__meta';
      meta.textContent = 'y ' + el.yTop.toLocaleString();
      d.appendChild(meta);

      if (el.type === SPS.TYPES.ORGANIC && el.effectivePos && el.rank) {
        const ep = document.createElement('div');
        ep.className = 'sps-label__meta';
        ep.textContent = '#' + el.rank + ' \u2192 eff ' + el.effectivePos;
        d.appendChild(ep);
      }

      d.title = buildTooltip(el);
      r.appendChild(d);
    }
  }

  function buildTooltip(el) {
    const lines = [
      el.label + (el.rank ? ' #' + el.rank : ''),
      el.domain ? el.domain : null,
      'Pixel y: ' + el.yTop + '–' + el.yBottom + ' (' + el.height + 'px tall)',
      'Pixel share: ' + pct(el.pixelShare, 1),
      'Est. click share: ' + pct(el.shareOfClicks, 1),
      el.effectivePos ? 'Effective position: ' + el.effectivePos : null,
      el.type === SPS.TYPES.AI_OVERVIEW && el.citations
        ? 'Cites ' + el.citations.length + ' sources' + (el.cited ? ' — includes you' : ' — you not cited')
        : null,
      el.foldFlags ? 'Above fold: ' + Object.entries(el.foldFlags)
          .filter(([, v]) => v).map(([k]) => k).join(', ') || 'none' : null
    ].filter(Boolean);
    return lines.join('\n');
  }

  /** Park labels in the gutter right of the results column, or inside it if space is tight. */
  function labelColumnX() {
    const col = document.querySelector('#center_col, #rso');
    if (!col) return window.scrollX + window.innerWidth - 120;
    const m = SPS_MEASURE.docOffset(col);
    const rightEdge = m.xLeft + m.width;
    const room = document.documentElement.scrollWidth - rightEdge;
    if (room > 118) return rightEdge + 12;
    return Math.max(4, rightEdge - 104);
  }

  // ---- box mode ----

  function drawBoxes(elements) {
    const r = root();
    for (const el of elements) {
      if (el.type === SPS.TYPES.SITELINK) continue;
      // Teal marks a listing that is yours. On the AI Overview block `owned`
      // means "cites you", which is a different claim — that block stays amber
      // so the colour key holds.
      const color = (el.owned && el.type !== SPS.TYPES.AI_OVERVIEW)
        ? SPS.COLORS.OWNED
        : (SPS.COLORS[el.type] || SPS.COLORS.organic);
      const b = document.createElement('div');
      b.className = 'sps-box';
      b.style.top = el.yTop + 'px';
      b.style.left = (el.xLeft ?? 0) - 6 + 'px';
      b.style.height = el.height + 'px';
      b.style.width = el.width + 'px';
      b.style.borderLeftColor = color;

      const tag = document.createElement('div');
      tag.className = 'sps-box__tag';
      tag.style.background = color;
      tag.textContent = el.label + (el.rank ? ' #' + el.rank : '') +
        ' \u00b7 ' + pct(el.pixelShare, 0) + ' px \u00b7 ' + pct(el.estCTR);
      b.appendChild(tag);
      r.appendChild(b);
    }
  }

  // ---- fold line ----

  function drawFold(viewportKey) {
    const vp = SPS.VIEWPORTS[viewportKey] || SPS.VIEWPORTS.desktop;
    const r = root();
    const f = document.createElement('div');
    f.className = 'sps-fold';
    f.style.top = vp.h + 'px';
    f.style.width = document.documentElement.scrollWidth + 'px';

    const tag = document.createElement('div');
    tag.className = 'sps-fold__tag';
    tag.style.left = '48px';
    tag.textContent = 'fold \u00b7 ' + vp.h + 'px \u00b7 ' + viewportKey;
    f.appendChild(tag);
    r.appendChild(f);
  }

  // ---- pixel ruler (signature element) ----

  function drawRuler(totalHeight, topOffset) {
    const r = root();
    const ruler = document.createElement('div');
    ruler.className = 'sps-ruler';
    ruler.style.top = topOffset + 'px';
    ruler.style.height = totalHeight + 'px';
    ruler.style.left = '2px';

    const step = 200;
    for (let y = 0; y <= totalHeight; y += step) {
      const major = (y % 1000 === 0);
      const t = document.createElement('div');
      t.className = 'sps-ruler__tick' + (major ? ' sps-ruler__tick--major' : '');
      t.style.top = y + 'px';
      ruler.appendChild(t);
      if (major) {
        const n = document.createElement('div');
        n.className = 'sps-ruler__num';
        n.style.top = y + 'px';
        n.textContent = y === 0 ? '0' : (y / 1000) + 'k';
        ruler.appendChild(n);
      }
    }
    r.appendChild(ruler);
  }

  // ---- HUD ----

  function drawHUD(summary) {
    document.querySelectorAll('.sps-hud').forEach(n => n.remove());
    const h = document.createElement('div');
    h.className = 'sps-hud';

    const title = document.createElement('div');
    title.className = 'sps-hud__title';
    title.textContent = 'serp pixel share';
    h.appendChild(title);

    const rows = [
      ['elements', summary.count],
      ['serp height', summary.serpHeight.toLocaleString() + 'px'],
      ['ai overview', summary.aioPresent ? (summary.aioCited ? 'cited' : 'not cited') : 'absent'],
      ['your rank', summary.ownedRank ?? '—'],
      ['effective pos', summary.ownedEffectivePos ?? '—'],
      ['your est. ctr', summary.ownedCTR != null ? pct(summary.ownedCTR) : '—']
    ];
    if (summary.unclassified > 0) rows.push(['unclassified', summary.unclassified]);

    for (const [k, v] of rows) {
      const row = document.createElement('div');
      row.className = 'sps-hud__row';
      const a = document.createElement('span'); a.textContent = k;
      const b = document.createElement('span'); b.textContent = String(v);
      if (k === 'effective pos' && summary.ownedEffectivePos && summary.ownedRank &&
          summary.ownedEffectivePos > summary.ownedRank + 1) b.style.color = 'var(--sps-clay)';
      if (k === 'unclassified') b.style.color = '#c0392b';
      row.append(a, b);
      h.appendChild(row);
    }

    const btn = document.createElement('button');
    btn.className = 'sps-hud__btn';
    btn.textContent = 'open panel';
    btn.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'SPS_OPEN_PANEL' }));
    h.appendChild(btn);

    document.body.appendChild(h);
  }

  // ---- entry ----

  function render(elements, ctx) {
    clear();
    const mode = ctx.settings.overlayMode || 'inline';
    if (mode === 'off') { drawHUD(ctx.summary); return; }

    drawRuler(ctx.serpHeight, ctx.serpTop);
    drawFold(ctx.settings.viewport || 'desktop');
    if (mode === 'inline') drawInline(elements, ctx);
    if (mode === 'boxes') drawBoxes(elements);
    drawHUD(ctx.summary);
  }

  return { render, clear, drawHUD };
})();

if (typeof globalThis !== 'undefined') globalThis.SPS_OVERLAY = SPS_OVERLAY;
