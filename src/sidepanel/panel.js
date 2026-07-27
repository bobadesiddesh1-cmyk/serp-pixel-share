// Side panel controller. No framework — the panel is small enough that DOM
// calls are clearer than a render loop, and it ships with zero build step.

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const state = { scan: null, settings: null, batchTimer: null };

const pct = (v, d = 1) => (v == null || isNaN(v)) ? '—' : (v * 100).toFixed(d) + '%';
const num = v => (v == null) ? '—' : Number(v).toLocaleString();

function send(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, r => resolve(r || { ok: false })));
}

function toast(text, isErr = false) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.toggle('toast--err', isErr);
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 3200);
}

// ── tabs ──
$$('.tab').forEach(btn => btn.addEventListener('click', () => {
  $$('.tab').forEach(b => b.classList.toggle('tab--on', b === btn));
  $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + btn.dataset.view; });
  if (btn.dataset.view === 'batch') refreshLogSummary();
}));

// ── scan view ──

function renderScan(scan) {
  state.scan = scan;
  if (!scan) { $('#scan-empty').hidden = false; $('#scan-body').hidden = true; return; }
  $('#scan-empty').hidden = true;
  $('#scan-body').hidden = false;

  const s = scan.summary;
  $('#scan-query').textContent = s.query || '(no query)';

  $('#s-rank').textContent = s.ownedRank ?? '—';
  const eff = $('#s-eff');
  eff.textContent = s.ownedEffectivePos ?? '—';
  eff.className = 'stat__v';
  if (s.ownedRank && s.ownedEffectivePos) {
    eff.classList.add(s.ownedEffectivePos > s.ownedRank + 1 ? 'stat__v--warn' : 'stat__v--good');
  }
  const own = scan.elements.find(e => e.owned && e.type === SPS.TYPES.ORGANIC);
  $('#s-pxs').textContent = own ? pct(own.pixelShare, 1) : '—';
  $('#s-ctr').textContent = own ? pct(own.estCTR) : '—';

  renderVerdict(s, own);
  renderBars(scan);
  renderMap(scan);
  renderTable(scan);

  $('#mode-toggle').textContent = 'Overlay: ' + (state.settings?.overlayMode || 'inline');
}

function renderVerdict(s, own) {
  const v = $('#verdict');
  if (!own) {
    if (!s.ownedRank && state.settings?.ownedDomains?.length) {
      v.hidden = false; v.className = 'verdict verdict--warn';
      v.textContent = 'None of your domains rank on this page. Every click here goes elsewhere.';
      return;
    }
    v.hidden = true; return;
  }
  v.hidden = false;
  const gap = (s.ownedEffectivePos || 0) - (s.ownedRank || 0);
  if (s.aioPresent && !s.aioCited) {
    v.className = 'verdict verdict--warn';
    v.textContent = `AI Overview holds ${pct(s.aioPixelShare, 0)} of the page and does not cite you. ` +
      `Rank ${s.ownedRank} behaves like ${s.ownedEffectivePos}. Citation share is the fix, not rank.`;
  } else if (gap >= 3) {
    v.className = 'verdict verdict--warn';
    v.textContent = `Rank ${s.ownedRank} sits at ${num(own.yTop)}px — ${gap} positions of interference above it. ` +
      `Clearing features above beats climbing one rank.`;
  } else if (s.aioPresent && s.aioCited) {
    v.className = 'verdict';
    v.textContent = `Cited in the AI Overview and ranking ${s.ownedRank}. Both surfaces held on this query.`;
  } else {
    v.className = 'verdict';
    v.textContent = `Clean SERP. Rank ${s.ownedRank} performs close to its base curve.`;
  }
}

function colorFor(el) {
  // On the AI Overview block `owned` means "cites you", not "is your listing".
  // Amber must survive that, or the legend stops matching the overlay.
  if (el.owned && el.type !== SPS.TYPES.AI_OVERVIEW) return SPS.COLORS.OWNED;
  return SPS.COLORS[el.type] || SPS.COLORS.organic;
}

function renderBars(scan) {
  const wrap = $('#bars');
  wrap.textContent = '';
  const rows = scan.elements
    .filter(e => e.type !== SPS.TYPES.SITELINK && e.type !== SPS.TYPES.RELATED_SEARCH)
    .sort((a, b) => (b.shareOfClicks || 0) - (a.shareOfClicks || 0))
    .slice(0, 10);
  const max = Math.max(...rows.map(r => r.shareOfClicks || 0), 0.001);

  for (const el of rows) {
    const row = document.createElement('div');
    row.className = 'bar' + (el.owned ? ' bar--own' : '');

    const k = document.createElement('div');
    k.className = 'bar__k';
    k.textContent = el.label + (el.rank ? ' #' + el.rank : '') + (el.owned ? ' (you)' : '');
    k.title = el.domain || el.label;

    const t = document.createElement('div');
    t.className = 'bar__t';
    const f = document.createElement('div');
    f.className = 'bar__f';
    f.style.width = Math.max(2, ((el.shareOfClicks || 0) / max) * 100) + '%';
    f.style.background = colorFor(el);
    t.appendChild(f);

    const v = document.createElement('div');
    v.className = 'bar__v';
    v.textContent = pct(el.shareOfClicks);

    row.append(k, t, v);
    wrap.appendChild(row);
  }
}

function renderMap(scan) {
  const col = $('#map-col');
  const key = $('#map-key');
  col.textContent = ''; key.textContent = '';

  const rows = scan.elements
    .filter(e => e.type !== SPS.TYPES.SITELINK && e.height > 24)
    .sort((a, b) => a.yTop - b.yTop)
    .slice(0, 9);

  for (const el of rows) {
    const seg = document.createElement('div');
    seg.className = 'map__seg';
    seg.style.flex = String(Math.max(1, el.height));
    seg.style.background = colorFor(el);
    seg.style.opacity = el.owned || el.type === SPS.TYPES.AI_OVERVIEW ? '1' : '0.62';
    seg.title = el.label + ' · ' + el.height + 'px';
    col.appendChild(seg);

    const r = document.createElement('div');
    r.className = 'map__row';
    const sw = document.createElement('span');
    sw.className = 'map__sw';
    sw.style.background = colorFor(el);
    const lbl = document.createElement('span');
    lbl.className = 'map__lbl';
    lbl.textContent = el.label + (el.rank ? ' #' + el.rank : '') + (el.owned ? ' (you)' : '');
    const n = document.createElement('span');
    n.className = 'map__num';
    n.textContent = el.height + 'px · ' + pct(el.pixelShare, 0);
    r.append(sw, lbl, n);
    key.appendChild(r);
  }
}

function renderTable(scan) {
  const tb = $('#el-table tbody');
  tb.textContent = '';
  for (const el of scan.elements) {
    if (el.type === SPS.TYPES.SITELINK) continue;
    const tr = document.createElement('tr');
    if (el.owned) tr.className = 'own';
    else if (el.type === SPS.TYPES.AI_OVERVIEW) tr.className = 'aio';
    else if (el.type === SPS.TYPES.UNCLASSIFIED) tr.className = 'unk';

    const td1 = document.createElement('td');
    const box = document.createElement('div');
    box.className = 'tbl__el';
    const dot = document.createElement('span');
    dot.className = 'tbl__dot';
    dot.style.background = colorFor(el);
    const txt = document.createElement('span');
    const strong = document.createElement('span');
    strong.textContent = el.label + (el.rank ? ' #' + el.rank : '');
    txt.appendChild(strong);
    if (el.domain) {
      const d = document.createElement('span');
      d.className = 'tbl__dom';
      d.textContent = el.domain;
      txt.appendChild(d);
    }
    box.append(dot, txt);
    td1.appendChild(box);

    const cells = [
      num(el.yTop),
      pct(el.pixelShare, 0),
      pct(el.estCTR),
      el.actualCTR != null ? pct(el.actualCTR) : '—'
    ].map(v => { const td = document.createElement('td'); td.className = 'num'; td.textContent = v; return td; });

    tr.append(td1, ...cells);
    tb.appendChild(tr);
  }
}

// ── AIO view ──

function renderAIO(scan) {
  const st = $('#aio-status');
  const cites = $('#aio-cites');
  cites.textContent = '';
  if (!scan) { st.textContent = 'No scan yet.'; return; }
  const s = scan.summary;
  if (!s.aioPresent) { st.textContent = 'No AI Overview on this query.'; return; }

  st.textContent = [
    'present',
    s.aioCited ? 'you are cited' : 'you are not cited',
    pct(s.aioPixelShare, 0) + ' of page height',
    s.aioCitationCount + ' sources',
    s.aioExpanded ? 'expanded' : 'collapsed view only'
  ].join(' \u00b7 ');

  const owned = (state.settings?.ownedDomains || [])
    .map(d => d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase());

  (s.aioCitations || []).forEach((c, i) => {
    const row = document.createElement('div');
    const mine = owned.some(o => c.domain === o || c.domain.endsWith('.' + o));
    row.className = 'cite' + (mine ? ' cite--own' : '');
    const n = document.createElement('span'); n.className = 'cite__n'; n.textContent = String(i + 1);
    const d = document.createElement('span'); d.className = 'cite__d';
    d.textContent = c.domain + (mine ? '  \u2190 you' : '');
    d.title = c.title || c.url;
    row.append(n, d);
    cites.appendChild(row);
  });
}

$('#run-blue').addEventListener('click', async () => {
  const out = $('#blue-out');
  out.textContent = 'Querying Search Console…';
  const res = await send({ type: 'SPS_BLUE_LINK_CTR', days: 28 });
  out.textContent = '';
  if (!res.ok) { out.appendChild(errBox(res.error)); return; }
  const r = res.result;

  const split = document.createElement('div');
  split.className = 'split';
  const a = document.createElement('div'); a.className = 'split__a';
  const b = document.createElement('div'); b.className = 'split__b';
  const ex = r.aio.exposureRate;
  a.style.flex = String(Math.max(0.03, ex));
  b.style.flex = String(Math.max(0.03, 1 - ex));
  a.textContent = 'AIO ' + pct(ex, 0);
  b.textContent = 'blue link ' + pct(1 - ex, 0);
  split.append(a, b);
  out.appendChild(split);

  const meta = document.createElement('div');
  meta.className = 'mono';
  meta.textContent = num(r.totals.impressions) + ' impressions across ' +
    r.coverage.matchedQueries + ' matched queries \u00b7 ' +
    num(r.aio.impressions) + ' under an AI Overview';
  out.appendChild(meta);

  const grid = document.createElement('div');
  grid.className = 'stats';
  grid.style.marginTop = '11px';
  [
    ['reported ctr', pct(r.reportedCTR), 'warn'],
    ['blue-link ctr', pct(r.blueLink.ctr), 'good'],
    ['aio citation rate', pct(r.aio.citationRate, 0), ''],
    ['suppression delta', r.suppressionDelta != null ? (r.suppressionDelta * 100).toFixed(1) + 'pp' : '—', '']
  ].forEach(([k, v, cls]) => {
    const st = document.createElement('div'); st.className = 'stat';
    const kk = document.createElement('span'); kk.className = 'stat__k'; kk.textContent = k;
    const vv = document.createElement('span');
    vv.className = 'stat__v' + (cls ? ' stat__v--' + cls : '');
    vv.textContent = v;
    st.append(kk, vv); grid.appendChild(st);
  });
  out.appendChild(grid);

  if (r.topSuppressed.length) {
    const h = document.createElement('h2'); h.className = 'sec'; h.textContent = 'Most suppressed queries';
    out.appendChild(h);
    const wrap = document.createElement('div'); wrap.className = 'tblwrap';
    const t = document.createElement('table'); t.className = 'tbl';
    t.innerHTML = '<thead><tr><th>Query</th><th class="num">impr</th><th class="num">ctr</th><th class="num">pos</th><th class="num">cited</th></tr></thead>';
    const tb = document.createElement('tbody');
    for (const q of r.topSuppressed.slice(0, 15)) {
      const tr = document.createElement('tr');
      const c0 = document.createElement('td'); c0.textContent = q.query; c0.title = q.query;
      const rest = [num(q.impressions), pct(q.ctr), q.position.toFixed(1), q.cited ? 'yes' : 'no']
        .map(v => { const td = document.createElement('td'); td.className = 'num'; td.textContent = v; return td; });
      tr.append(c0, ...rest); tb.appendChild(tr);
    }
    t.appendChild(tb); wrap.appendChild(t); out.appendChild(wrap);
  }

  if (r.coverage.unscannedImpressions > 0) {
    const n = document.createElement('p'); n.className = 'note'; n.style.marginTop = '11px';
    n.textContent = num(r.coverage.unscannedImpressions) + ' impressions sit on queries you have not scanned yet. ' +
      'Batch-scan them to bring them into the split.';
    out.appendChild(n);
  }
});

function errBox(text) {
  const p = document.createElement('p');
  p.className = 'note';
  p.style.color = 'var(--clay)';
  p.textContent = text || 'Something failed.';
  return p;
}

// ── batch view ──

$('#batch-go').addEventListener('click', async () => {
  const queries = $('#batch-input').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!queries.length) return toast('Add at least one keyword.', true);
  $('#batch-out').textContent = '';
  $('#batch-prog').hidden = false;
  $('#batch-go').disabled = true;
  $('#batch-stop').hidden = false;
  await send({ type: 'SPS_BATCH_START', queries, engine: $('#batch-engine').value });
  pollBatch();
});

$('#batch-stop').addEventListener('click', () => send({ type: 'SPS_BATCH_CANCEL' }));

function pollBatch() {
  clearInterval(state.batchTimer);
  state.batchTimer = setInterval(async () => {
    const r = await send({ type: 'SPS_BATCH_STATUS' });
    if (!r.ok) return;
    $('#batch-fill').style.width = (r.total ? (r.done / r.total) * 100 : 0) + '%';
    $('#batch-count').textContent = r.done + ' / ' + r.total + ' scanned';
    if (!r.running) {
      clearInterval(state.batchTimer);
      $('#batch-go').disabled = false;
      $('#batch-stop').hidden = true;
      renderBatchResults(r.results);
      refreshLogSummary();
      if (r.rateLimited) {
        toast('Google rate-limited the batch after ' + r.done + ' of ' + r.total +
              '. Wait a few minutes and raise the pacing interval.', true);
      } else {
        toast('Batch complete: ' + r.done + ' queries logged.');
      }
    }
  }, 900);
}

function renderBatchResults(results) {
  const out = $('#batch-out');
  out.textContent = '';
  if (!results?.length) return;
  const aio = results.filter(r => r.aioPresent).length;
  const cited = results.filter(r => r.aioCited).length;

  const sum = document.createElement('div');
  sum.className = 'mono';
  sum.style.marginTop = '11px';
  sum.textContent = `${results.length} scanned \u00b7 AIO on ${aio} (${pct(aio / results.length, 0)}) \u00b7 you cited in ${cited}`;
  out.appendChild(sum);

  const wrap = document.createElement('div'); wrap.className = 'tblwrap';
  const t = document.createElement('table'); t.className = 'tbl';
  t.innerHTML = '<thead><tr><th>Query</th><th class="num">aio</th><th class="num">cited</th><th class="num">rank</th><th class="num">eff</th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const r of results) {
    const tr = document.createElement('tr');
    if (r.aioPresent && !r.aioCited) tr.className = 'aio';
    const c0 = document.createElement('td'); c0.textContent = r.query; c0.title = r.query;
    const rest = [
      r.aioPresent == null ? '—' : (r.aioPresent ? 'yes' : 'no'),
      r.aioCited == null ? '—' : (r.aioCited ? 'yes' : 'no'),
      r.ownedRank ?? '—',
      r.ownedEffectivePos ?? '—'
    ].map(v => { const td = document.createElement('td'); td.className = 'num'; td.textContent = String(v); return td; });
    tr.append(c0, ...rest); tb.appendChild(tr);
  }
  t.appendChild(tb); wrap.appendChild(t); out.appendChild(wrap);
}

async function refreshLogSummary() {
  const r = await send({ type: 'SPS_SCAN_LOG' });
  if (!r.ok) return;
  const rows = Object.values(r.log || {});
  if (!rows.length) { $('#log-summary').textContent = 'Empty.'; return; }
  const aio = rows.filter(x => x.aioPresent).length;
  const cited = rows.filter(x => x.aioCited).length;
  $('#log-summary').textContent =
    `${rows.length} queries \u00b7 AIO on ${aio} \u00b7 cited on ${cited} \u00b7 citation rate ${aio ? pct(cited / aio, 0) : '—'}`;
}

$('#exp-log').addEventListener('click', async () => {
  const r = await send({ type: 'SPS_EXPORT_LOG_CSV' });
  if (!r.ok) return toast(r.error, true);
  download('sps-scan-log.csv', r.csv);
});

$('#exp-scan').addEventListener('click', async () => {
  const r = await send({ type: 'SPS_EXPORT_SCAN_CSV' });
  if (!r.ok) return toast(r.error, true);
  const q = (state.scan?.summary?.query || 'scan').replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
  download('sps-' + q + '.csv', r.csv);
});

$('#clear-log').addEventListener('click', async () => {
  await send({ type: 'SPS_CLEAR_LOG' });
  refreshLogSummary();
  toast('Scan log cleared.');
});

$('#diag').addEventListener('click', async () => {
  toast('Collecting diagnostic…');
  const r = await send({ type: 'SPS_DIAGNOSTIC' });
  if (!r.ok) return toast(r.error || 'Diagnostic failed.', true);
  const d = r.diagnostic;
  const q = (d.query || 'query').replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
  download('sps-diagnostic-' + q + '.json', JSON.stringify(d, null, 2), 'application/json');
  toast('Diagnostic saved: ' + d.elements.length + ' elements, ' +
        d.summary.unclassified + ' unclassified.');
});

function download(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

// ── setup view ──

$('#save-owned').addEventListener('click', async () => {
  const list = $('#owned').value.split('\n').map(s => s.trim()).filter(Boolean);
  const r = await send({ type: 'SPS_SET_SETTINGS', patch: { ownedDomains: list } });
  if (r.ok) { state.settings = r.settings; toast('Saved ' + list.length + ' domains.'); }
});

$('#viewport').addEventListener('change', async e => {
  const r = await send({ type: 'SPS_SET_SETTINGS', patch: { viewport: e.target.value } });
  if (r.ok) state.settings = r.settings;
});

$('#mode-toggle').addEventListener('click', async () => {
  const order = ['inline', 'boxes', 'off'];
  const cur = state.settings?.overlayMode || 'inline';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  const r = await send({ type: 'SPS_SET_SETTINGS', patch: { overlayMode: next } });
  if (r.ok) { state.settings = r.settings; $('#mode-toggle').textContent = 'Overlay: ' + next; }
});

$('#rescan').addEventListener('click', async () => {
  $('#rescan').disabled = true;
  const r = await send({ type: 'SPS_RESCAN' });
  $('#rescan').disabled = false;
  if (!r.ok) return toast(r.error || 'No results page found.', true);
  if (r.payload) { renderScan(r.payload); renderAIO(r.payload); }
});

$('#gsc-connect').addEventListener('click', async () => {
  $('#gsc-state').textContent = 'Opening Google sign-in…';
  const r = await send({ type: 'SPS_GSC_CONNECT' });
  if (!r.ok) { $('#gsc-state').textContent = 'Connect failed: ' + r.error; return; }
  fillProperties(r.properties);
  $('#gsc-state').textContent = 'Connected \u00b7 ' + r.properties.length + ' properties';
  $('#gsc-disconnect').hidden = false;
});

$('#gsc-disconnect').addEventListener('click', async () => {
  await send({ type: 'SPS_GSC_DISCONNECT' });
  $('#gsc-state').textContent = 'Not connected';
  $('#gsc-prop').hidden = true;
  $('#gsc-disconnect').hidden = true;
});

function fillProperties(props) {
  const sel = $('#gsc-prop');
  sel.textContent = '';
  const blank = document.createElement('option');
  blank.value = ''; blank.textContent = 'Select a property…';
  sel.appendChild(blank);
  for (const p of props) {
    const o = document.createElement('option');
    o.value = p.url; o.textContent = p.url;
    if (state.settings?.gscProperty === p.url) o.selected = true;
    sel.appendChild(o);
  }
  sel.hidden = false;
}

$('#gsc-prop').addEventListener('change', async e => {
  const r = await send({ type: 'SPS_SET_SETTINGS', patch: { gscProperty: e.target.value } });
  if (r.ok) { state.settings = r.settings; toast('Property set.'); }
});

$('#calibrate').addEventListener('click', async () => {
  $('#cal-out').textContent = 'Solving…';
  const r = await send({ type: 'SPS_CALIBRATE', days: 90 });
  if (!r.ok) { $('#cal-out').textContent = r.error; return; }
  const coeffs = Object.entries(r.coefficients).filter(([k]) => !k.endsWith('__n'));
  if (!coeffs.length) {
    $('#cal-out').textContent = 'Sample of ' + r.sampleSize + ' rows. Not enough single-feature queries yet — scan more keywords.';
    return;
  }
  $('#cal-out').textContent = 'Sample ' + r.sampleSize + ' \u00b7 ' +
    coeffs.map(([k, v]) => k.replace('ai_overview', 'AIO') + ' ' + v).join(' \u00b7 ');
});

// ── boot ──

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'SPS_PANEL_UPDATE') { renderScan(msg.payload); renderAIO(msg.payload); }
  if (msg.type === 'SPS_PANEL_ERROR') toast(msg.error, true);
  if (msg.type === 'SPS_BATCH_PROGRESS') {
    $('#batch-count').textContent = msg.done + ' / ' + msg.total + ' scanned';
    $('#batch-fill').style.width = (msg.total ? (msg.done / msg.total) * 100 : 0) + '%';
  }
});

(async function boot() {
  const vp = $('#viewport');
  for (const [k, v] of Object.entries(SPS.VIEWPORTS)) {
    const o = document.createElement('option');
    o.value = k; o.textContent = v.label;
    vp.appendChild(o);
  }

  const s = await send({ type: 'SPS_GET_SETTINGS' });
  if (s.ok) {
    state.settings = s.settings;
    $('#owned').value = (s.settings.ownedDomains || []).join('\n');
    vp.value = s.settings.viewport || 'desktop';
    if (s.settings.gscProperty) {
      $('#gsc-state').textContent = 'Connected \u00b7 ' + s.settings.gscProperty;
      $('#gsc-disconnect').hidden = false;
      const p = await send({ type: 'SPS_GSC_PROPERTIES' });
      if (p.ok) fillProperties(p.properties);
    }
  }

  const latest = await send({ type: 'SPS_GET_LATEST' });
  if (latest.ok && latest.payload) { renderScan(latest.payload); renderAIO(latest.payload); }
  refreshLogSummary();
})();
