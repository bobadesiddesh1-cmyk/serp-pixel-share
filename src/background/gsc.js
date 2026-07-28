// Google Search Console API.
//
// Two jobs:
//   1. Fetch actual CTR for a query/page, cached, for the inline label.
//   2. Rebuild blue-link CTR: split a query set's impressions into AIO-present
//      and AIO-absent pools using the extension's own scan log, then recompute
//      CTR on the clean pool only.
//
// Auth: chrome.identity.getAuthToken with the webmasters.readonly scope.
// You must create an OAuth client of type "Chrome App" and paste the ID into
// manifest.json, using your unpacked extension's ID.

const API = 'https://searchconsole.googleapis.com/webmasters/v3';
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6h

export async function getToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, token => {
      if (chrome.runtime.lastError || !token) {
        return reject(new Error(chrome.runtime.lastError?.message || 'No token'));
      }
      resolve(token);
    });
  });
}

export async function revokeToken() {
  try {
    const token = await getToken(false);
    await fetch('https://oauth2.googleapis.com/revoke?token=' + token, { method: 'POST' });
    await new Promise(r => chrome.identity.removeCachedAuthToken({ token }, r));
  } catch (_) { /* already gone */ }
}

async function call(path, body, method = 'POST') {
  const token = await getToken(false);
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) {
    const token2 = await getToken(true);
    const retry = await fetch(API + path, {
      method,
      headers: { Authorization: 'Bearer ' + token2, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!retry.ok) throw new Error('GSC ' + retry.status + ' ' + (await retry.text()).slice(0, 200));
    return retry.json();
  }
  if (!res.ok) throw new Error('GSC ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return res.json();
}

export async function listProperties() {
  const data = await call('/sites', null, 'GET');
  return (data.siteEntry || []).map(s => ({
    url: s.siteUrl,
    permission: s.permissionLevel
  }));
}

function dateRange(days = 28, lagDays = 3) {
  const end = new Date(Date.now() - lagDays * 86400000);
  const start = new Date(end.getTime() - days * 86400000);
  const f = d => d.toISOString().slice(0, 10);
  return { startDate: f(start), endDate: f(end) };
}

/**
 * Rows for a property, grouped by query (and optionally page).
 */
export async function queryRows(property, { days = 28, dimensions = ['query'], rowLimit = 25000, filters = [] } = {}) {
  const { startDate, endDate } = dateRange(days);
  const body = {
    startDate, endDate, dimensions, rowLimit,
    dataState: 'all'
  };
  if (filters.length) {
    body.dimensionFilterGroups = [{ groupType: 'and', filters }];
  }
  const data = await call('/sites/' + encodeURIComponent(property) + '/searchAnalytics/query', body);
  return (data.rows || []).map(r => ({
    keys: r.keys,
    query: dimensions[0] === 'query' ? r.keys[0] : undefined,
    page: dimensions.includes('page') ? r.keys[dimensions.indexOf('page')] : undefined,
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position
  }));
}

/** Single-query actual, cached in chrome.storage. */
export async function actualsFor(property, query, pageUrl) {
  if (!property || !query) return null;
  const key = SPS_STORAGE_KEY(property, query, pageUrl);
  const cached = await chrome.storage.local.get(SPS.STORAGE.GSC);
  const bag = cached[SPS.STORAGE.GSC] || {};
  const hit = bag[key];
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;

  const filters = [{ dimension: 'query', operator: 'equals', expression: query }];
  if (pageUrl) filters.push({ dimension: 'page', operator: 'equals', expression: pageUrl });

  const rows = await queryRows(property, {
    days: 28,
    dimensions: pageUrl ? ['query', 'page'] : ['query'],
    rowLimit: 5,
    filters
  });
  const data = rows[0] || null;
  bag[key] = { at: Date.now(), data };

  // Drop expired entries, then cap the cache. chrome.storage.local is a ~10MB
  // quota and nothing else prunes this — a long batch run would otherwise grow
  // it until writes start failing.
  const now = Date.now();
  for (const [k, v] of Object.entries(bag)) {
    if (!v || now - v.at > CACHE_TTL) delete bag[k];
  }
  const MAX_ENTRIES = 500;
  const keys = Object.keys(bag);
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => bag[a].at - bag[b].at)          // oldest first
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach(k => delete bag[k]);
  }

  await chrome.storage.local.set({ [SPS.STORAGE.GSC]: bag });
  return data;
}

function SPS_STORAGE_KEY(property, query, pageUrl) {
  return [property, query, pageUrl || ''].join('||').toLowerCase();
}

/**
 * The core AIO calculation.
 *
 * scanLog: { [normalisedQuery]: { aioPresent: bool, aioCited: bool, scannedAt } }
 * Returns reported vs blue-link CTR for the query set.
 */
export async function blueLinkCTR(property, scanLog, { days = 28, queryFilter = null } = {}) {
  const rows = await queryRows(property, { days, dimensions: ['query'], rowLimit: 25000 });

  const norm = s => (s || '').trim().toLowerCase();
  const log = {};
  for (const [q, v] of Object.entries(scanLog || {})) log[norm(q)] = v;

  let aioClicks = 0, aioImpr = 0, cleanClicks = 0, cleanImpr = 0;
  let unknownClicks = 0, unknownImpr = 0;
  let citedQueries = 0, aioQueries = 0, matchedQueries = 0;
  const suppressed = [];

  for (const r of rows) {
    if (queryFilter && !queryFilter(r.query)) continue;
    const entry = log[norm(r.query)];
    if (!entry) {
      unknownClicks += r.clicks; unknownImpr += r.impressions;
      continue;
    }
    matchedQueries += 1;
    if (entry.aioPresent) {
      aioQueries += 1;
      if (entry.aioCited) citedQueries += 1;
      aioClicks += r.clicks; aioImpr += r.impressions;
      suppressed.push({
        query: r.query, clicks: r.clicks, impressions: r.impressions,
        ctr: r.ctr, position: r.position, cited: !!entry.aioCited
      });
    } else {
      cleanClicks += r.clicks; cleanImpr += r.impressions;
    }
  }

  const totalClicks = aioClicks + cleanClicks;
  const totalImpr = aioImpr + cleanImpr;
  const reportedCTR = totalImpr ? totalClicks / totalImpr : null;
  const blueCTR = cleanImpr ? cleanClicks / cleanImpr : null;
  const aioCTR = aioImpr ? aioClicks / aioImpr : null;

  suppressed.sort((a, b) => b.impressions - a.impressions);

  return {
    property,
    days,
    coverage: {
      queriesInGSC: rows.length,
      queriesScanned: Object.keys(log).length,
      matchedQueries,
      unscannedClicks: unknownClicks,
      unscannedImpressions: unknownImpr
    },
    totals: { clicks: totalClicks, impressions: totalImpr },
    aio: {
      queries: aioQueries,
      clicks: aioClicks,
      impressions: aioImpr,
      ctr: aioCTR,
      exposureRate: totalImpr ? aioImpr / totalImpr : 0,
      citationRate: aioQueries ? citedQueries / aioQueries : 0,
      citedQueries
    },
    blueLink: { clicks: cleanClicks, impressions: cleanImpr, ctr: blueCTR },
    reportedCTR,
    suppressionDelta: (blueCTR != null && reportedCTR != null) ? blueCTR - reportedCTR : null,
    topSuppressed: suppressed.slice(0, 25)
  };
}

/**
 * Calibrate the model's suppression coefficients against this property.
 * Uses only queries where the scan log recorded exactly one feature above.
 */
export async function calibrateFromGSC(property, scanLog, days = 90) {
  const rows = await queryRows(property, { days, dimensions: ['query'], rowLimit: 25000 });
  const norm = s => (s || '').trim().toLowerCase();
  const log = {};
  for (const [q, v] of Object.entries(scanLog || {})) log[norm(q)] = v;

  let skippedUnanchored = 0;
  const enriched = rows
    .map(r => {
      const e = log[norm(r.query)];
      if (!e) return null;
      // Scans that never located the owned result cannot say what sat above it.
      // `ownedFound` is absent on logs written before 0.2.2 — fall back to
      // ownedRank so old entries are still judged, not silently trusted.
      const anchored = e.ownedFound ?? (e.ownedRank != null);
      if (!anchored) { skippedUnanchored++; return null; }
      return {
        query: r.query, position: r.position, ctr: r.ctr,
        aioPresent: e.aioPresent,
        featuresAbove: e.featuresAbove || (e.aioPresent ? ['ai_overview'] : [])
      };
    })
    .filter(Boolean);

  return {
    sampleSize: enriched.length,
    skippedUnanchored,
    coefficients: SPS_MODEL.calibrate(enriched)
  };
}
