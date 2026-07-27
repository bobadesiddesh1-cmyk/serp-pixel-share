// Storage. chrome.storage.local only — nothing leaves the browser except the
// GSC call, which goes to Google with the user's own token.

export async function getSettings() {
  const got = await chrome.storage.local.get(SPS.STORAGE.SETTINGS);
  return { ...SPS.DEFAULT_SETTINGS, ...(got[SPS.STORAGE.SETTINGS] || {}) };
}

export async function setSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ [SPS.STORAGE.SETTINGS]: next });
  return next;
}

/**
 * Scan log. Keyed by normalised query so repeated scans overwrite.
 * This log is what makes the blue-link CTR join possible — every scan
 * records whether AIO fired and whether the client was cited.
 */
export async function recordScan(scan) {
  if (!scan?.summary?.query) return;
  const got = await chrome.storage.local.get(SPS.STORAGE.SCANS);
  const log = got[SPS.STORAGE.SCANS] || {};
  const key = scan.summary.query.trim().toLowerCase();

  const featuresAbove = [];
  for (const el of scan.elements || []) {
    if (el.type === SPS.TYPES.ORGANIC && el.owned) break;
    if ([SPS.TYPES.AI_OVERVIEW, SPS.TYPES.PAA, SPS.TYPES.AD, SPS.TYPES.SHOPPING,
         SPS.TYPES.LOCAL_PACK, SPS.TYPES.VIDEO, SPS.TYPES.FEATURED_SNIPPET,
         SPS.TYPES.IMAGE_PACK, SPS.TYPES.TOP_STORIES].includes(el.type)) {
      if (!featuresAbove.includes(el.type)) featuresAbove.push(el.type);
    }
  }

  log[key] = {
    query: scan.summary.query,
    scannedAt: scan.summary.scannedAt,
    aioPresent: scan.summary.aioPresent,
    aioCited: scan.summary.aioCited,
    aioCitationCount: scan.summary.aioCitationCount,
    aioPixelShare: scan.summary.aioPixelShare,
    aioCitations: (scan.summary.aioCitations || []).map(c => c.domain).slice(0, 10),
    featuresAbove,
    ownedRank: scan.summary.ownedRank,
    ownedEffectivePos: scan.summary.ownedEffectivePos,
    ownedCTR: scan.summary.ownedCTR,
    serpHeight: scan.summary.serpHeight,
    adCount: scan.summary.adCount,
    unclassified: scan.summary.unclassified,
    history: [
      ...((log[key]?.history) || []).slice(-11),
      {
        at: scan.summary.scannedAt,
        aio: scan.summary.aioPresent,
        cited: scan.summary.aioCited,
        rank: scan.summary.ownedRank,
        eff: scan.summary.ownedEffectivePos
      }
    ]
  };

  await chrome.storage.local.set({ [SPS.STORAGE.SCANS]: log });
}

export async function getScanLog() {
  const got = await chrome.storage.local.get(SPS.STORAGE.SCANS);
  return got[SPS.STORAGE.SCANS] || {};
}

export async function clearScanLog() {
  await chrome.storage.local.remove(SPS.STORAGE.SCANS);
}

export async function setModelOverrides(coefficients) {
  await chrome.storage.local.set({ [SPS.STORAGE.MODEL]: coefficients || {} });
}

export async function getModelOverrides() {
  const got = await chrome.storage.local.get(SPS.STORAGE.MODEL);
  return got[SPS.STORAGE.MODEL] || {};
}

/** CSV export of the scan log. */
export function scanLogToCSV(log) {
  const cols = ['query', 'scannedAt', 'aioPresent', 'aioCited', 'aioCitationCount',
                'aioPixelShare', 'ownedRank', 'ownedEffectivePos', 'ownedCTR',
                'adCount', 'serpHeight', 'featuresAbove', 'aioCitations'];
  const esc = v => {
    if (v == null) return '';
    const s = Array.isArray(v) ? v.join('|') : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.join(',')];
  for (const row of Object.values(log)) {
    lines.push(cols.map(c => esc(c === 'scannedAt' ? new Date(row[c]).toISOString() : row[c])).join(','));
  }
  return lines.join('\n');
}

/** CSV export of one full scan's element breakdown. */
export function scanToCSV(scan) {
  const cols = ['type', 'label', 'rank', 'effectivePos', 'domain', 'yTop', 'yBottom',
                'height', 'pixelShare', 'estCTR', 'shareOfClicks', 'actualCTR',
                'owned', 'aboveFoldDesktop', 'aboveFoldMobile', 'title'];
  const esc = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = ['# query,' + esc(scan.summary.query), '# scanned,' +
                 new Date(scan.summary.scannedAt).toISOString(), cols.join(',')];
  for (const e of scan.elements) {
    lines.push([
      e.type, e.label, e.rank, e.effectivePos, e.domain, e.yTop, e.yBottom,
      e.height, e.pixelShare, e.estCTR, e.shareOfClicks, e.actualCTR,
      e.owned, e.foldFlags?.desktop, e.foldFlags?.mobile, e.title
    ].map(esc).join(','));
  }
  return lines.join('\n');
}
