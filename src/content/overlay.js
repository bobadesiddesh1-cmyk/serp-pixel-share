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

  // ---- chip ----------------------------------------------------------------
  //
  // One line, anchored to the result's URL row. That row is short, so the space
  // to its right is already empty, and sitting inside the result keeps us out of
  // the right-hand gutter that other SEO extensions compete for.
  //
  // Every value carries its label. A bare "2 -> 5" assumes the reader has been
  // told what the arrow means; "ranks #2 \u00b7 acts like #5" assumes nothing.

  const ORGANIC_TYPES = [SPS.TYPES.ORGANIC, SPS.TYPES.SOCIAL, SPS.TYPES.SITELINK];

  function seg(parts) {
    const s = document.createElement('span');
    s.className = 'sps-chip__seg';
    for (const [kind, text, colour] of parts) {
      const n = document.createElement('span');
      n.className = kind === 'lab' ? 'sps-chip__lab' : 'sps-chip__val';
      n.textContent = text;
      if (colour) n.style.color = colour;
      s.appendChild(n);
    }
    return s;
  }

  function divider() {
    const d = document.createElement('span');
    d.className = 'sps-chip__sep';
    return d;
  }

  // Severity of the rank-to-effective drop, drawn from the existing palette:
  // coral for a heavy fall, amber for moderate, teal for negligible.
  function severityColour(rank, effectivePos) {
    const drop = (effectivePos || 0) - (rank || 0);
    if (drop >= 4) return SPS.COLORS.ad;
    if (drop >= 2) return SPS.COLORS.ai_overview;
    return SPS.COLORS.OWNED;
  }

  /**
   * Segments in priority order. Index 0 is shed last.
   * The rank gap is the finding, so it outlives the CTR when space runs out.
   */
  function chipSegments(el) {
    const out = [];

    if (ORGANIC_TYPES.includes(el.type)) {
      if (el.rank) {
        const parts = [['lab', 'ranks'], ['val', '#' + el.rank]];
        if (el.effectivePos && el.effectivePos > el.rank) {
          parts.push(['lab', 'acts like']);
          parts.push(['val', '#' + el.effectivePos, severityColour(el.rank, el.effectivePos)]);
        }
        out.push(seg(parts));
      }
      const ctr = [['lab', 'est. CTR'], ['val', pct(el.estCTR)]];
      if (el.actualCTR != null) { ctr.push(['lab', 'actual']); ctr.push(['val', pct(el.actualCTR)]); }
      out.push(seg(ctr));
      return out;
    }

    if (el.type === SPS.TYPES.AI_OVERVIEW) {
      const n = el.citations ? el.citations.length : 0;
      out.push(seg(el.cited
        ? [['lab', 'cites you'], ['val', (el.matched?.length || 1) + ' of ' + n, SPS.COLORS.OWNED]]
        : [['lab', 'cites'], ['val', n + ' sources'], ['lab', 'not you']]));
      out.push(seg([['lab', 'page height'], ['val', pct(el.pixelShare, 0)]]));
      return out;
    }

    out.push(seg([['lab', 'est. clicks'], ['val', pct(el.estCTR)]]));
    out.push(seg([['lab', 'page height'], ['val', pct(el.pixelShare, 0)]]));
    return out;
  }

  /** The URL row. <cite> is semantic and long-lived \u2014 not a rotating class. */
  function urlAnchor(node) {
    if (!node || !node.querySelector) return null;
    const cite = node.querySelector('cite');
    return cite && SPS_MEASURE.isRendered(cite) ? cite : null;
  }

  function buildChip(el) {
    const chip = document.createElement('span');
    chip.className = 'sps-chip';
    if (el.type === SPS.TYPES.UNCLASSIFIED) chip.classList.add('sps-chip--unclassified');

    const dot = document.createElement('span');
    dot.className = 'sps-chip__dot';
    dot.style.background = (el.owned && el.type !== SPS.TYPES.AI_OVERVIEW)
      ? SPS.COLORS.OWNED
      : (SPS.COLORS[el.type] || SPS.COLORS.organic);
    chip.appendChild(dot);

    const segs = chipSegments(el);
    segs.forEach((s, i) => { if (i) chip.appendChild(divider()); chip.appendChild(s); });
    chip._segs = segs;
    chip.title = buildTooltip(el);
    return chip;
  }

  /**
   * Shed segments, lowest priority first, until the chip fits the space left
   * over on the URL row. Anything shed stays in the tooltip and the panel.
   */
  function fitChip(chip, available) {
    let guard = 0;
    while (chip.getBoundingClientRect().width > available && guard++ < 6) {
      const segs = [...chip.querySelectorAll('.sps-chip__seg')];
      if (segs.length <= 1) break;
      const last = segs[segs.length - 1];
      const sep = last.previousElementSibling;
      last.remove();
      if (sep && sep.classList.contains('sps-chip__sep')) sep.remove();
    }
    return chip.getBoundingClientRect().width <= available;
  }

  /**
   * Draw a chip per element. Anything that cannot be placed without covering
   * content is returned so the caller can give it a box instead — an element
   * that silently loses its annotation reads as an element that was never
   * detected, which is a worse failure than a mixed overlay.
   */
  function drawChips(elements, ctx) {
    const r = root();
    const gutterX = labelColumnX();
    const unplaced = [];
    let placed = 0;

    for (const el of elements) {
      if (el.type === SPS.TYPES.SITELINK && !ctx.showSitelinks) continue;
      if (el.type === SPS.TYPES.RELATED_SEARCH) continue;

      const chip = buildChip(el);
      const holder = document.createElement('div');
      holder.className = 'sps-chip-holder';
      holder.appendChild(chip);
      r.appendChild(holder);

      const cite = urlAnchor(el.node);
      const block = { left: el.xLeft ?? 0, width: el.width || 0 };

      if (cite) {
        // Right-align on the URL row, in the space the URL itself does not use.
        const c = SPS_MEASURE.docOffset(cite);
        const available = (block.left + block.width) - (c.xLeft + c.width) - 16;
        holder.style.top = (c.yTop - 3) + 'px';
        holder.style.left = block.left + 'px';
        holder.style.width = block.width + 'px';
        if (fitChip(chip, Math.max(0, available))) { placed++; continue; }
        // Did not fit even stripped back: fall through to the gutter.
      }

      if (gutterX != null) {
        holder.style.top = el.yTop + 'px';
        holder.style.left = gutterX + 'px';
        holder.style.width = 'auto';
        holder.style.textAlign = 'left';
        placed++;
        continue;
      }

      holder.remove();
      unplaced.push(el);
    }

    return { placed, unplaced };
  }

  /**
   * Written as sentences, not field names. This is where depth lives now that
   * the chip no longer shows it — so it has to explain itself, including what a
   * screenful actually is.
   */
  function buildTooltip(el, viewport = 'desktop') {
    const cost = SPS_MEASURE.scrollCost(el.yTop, viewport);
    const depth = cost.screens === 0
      ? `It starts ${el.yTop.toLocaleString()}px down; your screen shows about ` +
        `${cost.foldHeight.toLocaleString()}px, so it is visible without scrolling.`
      : `It starts ${el.yTop.toLocaleString()}px down — a visitor scrolls ` +
        `${cost.label.replace(' scroll', ' time').replace(' scrolls', ' times')} to reach it.`;

    const lines = [];
    lines.push(el.label + (el.rank ? ' #' + el.rank : '') + (el.domain ? ' — ' + el.domain : ''));

    if (el.estCTR != null) {
      lines.push(`Estimated CTR ${pct(el.estCTR)}${el.actualCTR != null
        ? `, against ${pct(el.actualCTR)} actual from Search Console.` : '. Model output, not measured.'}`);
    }
    if (el.rank && el.effectivePos && el.effectivePos > el.rank) {
      lines.push(`You rank #${el.rank}, but this page's layout means it performs like a #${el.effectivePos}.`);
    }
    lines.push(depth);
    lines.push(`It takes up ${pct(el.pixelShare, 0)} of the page's height.`);

    if (el.type === SPS.TYPES.AI_OVERVIEW && el.citations) {
      lines.push(el.cited
        ? `Cites ${el.citations.length} sources and one of them is yours.`
        : `Cites ${el.citations.length} sources; none of them are yours.`);
    }
    return lines.join('\n');
  }

  const LABEL_W = 106;

  /**
   * X for the label gutter, or null when there is no gutter.
   *
   * Returning a position inside the results column would put the labels on top
   * of Google's own text — which is the one thing the overlay must not do. On a
   * narrow window the column fills the viewport and there is no gutter at all,
   * so the caller falls back to box mode instead of covering content.
   */
  function labelColumnX() {
    const col = document.querySelector('#center_col, #rso');
    if (!col) {
      const room = window.innerWidth - LABEL_W - 12;
      return room > 0 ? window.scrollX + room : null;
    }
    const m = SPS_MEASURE.docOffset(col);
    const rightEdge = m.xLeft + m.width;
    const room = document.documentElement.scrollWidth - rightEdge;
    return room >= LABEL_W + 12 ? rightEdge + 12 : null;
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

  function drawHUD(summary, fellBackTo) {
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
    // Say so rather than letting the mode silently disagree with the setting.
    if (fellBackTo) rows.push(['overlay', fellBackTo + ' (no room)']);

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

    // Inline labels need a gutter beside the results column. When the window is
    // too narrow to have one, fall back to boxes — the left-edge accent bands
    // carry the same colour coding without sitting on top of Google's text.
    let effective = mode;
    if (mode === 'inline') {
      const { placed, unplaced } = drawChips(elements, ctx);
      if (!placed) {
        drawBoxes(elements);
        effective = 'boxes';
      } else if (unplaced.length) {
        // Chips where they fit, bands for the rest. Nothing goes unannotated.
        drawBoxes(unplaced);
        effective = 'inline + ' + unplaced.length + ' boxed';
      }
    } else if (mode === 'boxes') {
      drawBoxes(elements);
    }
    drawHUD(ctx.summary, effective !== mode ? effective : null);
  }

  return { render, clear, drawHUD };
})();

if (typeof globalThis !== 'undefined') globalThis.SPS_OVERLAY = SPS_OVERLAY;
