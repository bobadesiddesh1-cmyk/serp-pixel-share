// Service worker. Message router + batch runner.

import * as GSC from './gsc.js';
import * as Store from './store.js';

// Service workers do not get content_scripts' shared files, so import constants.
import '../shared/constants.js';
import '../model/estimate.js';

const latest = { scan: null, tabId: null, error: null };
const batch = { running: false, queue: [], done: [], total: 0, cancel: false, tabId: null, rateLimited: false };

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  (async () => {
    try {
      switch (msg.type) {

        case 'SPS_SCAN_RESULT': {
          latest.scan = msg.payload;
          latest.tabId = sender.tab?.id ?? null;
          latest.error = null;
          await Store.recordScan(msg.payload);
          chrome.runtime.sendMessage({ type: 'SPS_PANEL_UPDATE', payload: msg.payload }).catch(() => {});
          return respond({ ok: true });
        }

        case 'SPS_SCAN_ERROR': {
          latest.error = msg.error;
          chrome.runtime.sendMessage({ type: 'SPS_PANEL_ERROR', error: msg.error }).catch(() => {});
          return respond({ ok: true });
        }

        case 'SPS_OPEN_PANEL': {
          const tabId = sender.tab?.id;
          if (tabId) await chrome.sidePanel.open({ tabId });
          return respond({ ok: true });
        }

        case 'SPS_GET_LATEST':
          return respond({ ok: true, payload: latest.scan, error: latest.error });

        case 'SPS_RESCAN': {
          const tab = await activeSerpTab();
          if (!tab) return respond({ ok: false, error: 'No Google results tab in focus.' });
          const res = await chrome.tabs.sendMessage(tab.id, { type: 'SPS_REQUEST_SCAN' });
          return respond(res || { ok: false });
        }

        case 'SPS_DIAGNOSTIC': {
          const tab = await activeSerpTab();
          if (!tab) return respond({ ok: false, error: 'No Google results tab in focus.' });
          const res = await chrome.tabs.sendMessage(tab.id, { type: 'SPS_REQUEST_DIAGNOSTIC' });
          return respond(res || { ok: false, error: 'No response from the results page.' });
        }

        case 'SPS_GET_SETTINGS':
          return respond({ ok: true, settings: await Store.getSettings() });

        case 'SPS_SET_SETTINGS': {
          const next = await Store.setSettings(msg.patch);
          const tab = await activeSerpTab();
          if (tab) chrome.tabs.sendMessage(tab.id, { type: 'SPS_SETTINGS_CHANGED' }).catch(() => {});
          return respond({ ok: true, settings: next });
        }

        case 'SPS_GET_ACTUALS': {
          const s = await Store.getSettings();
          if (!s.gscProperty) return respond({ ok: false, error: 'No GSC property selected.' });
          const data = await GSC.actualsFor(s.gscProperty, msg.query, msg.pageUrl);
          return respond({ ok: true, data });
        }

        case 'SPS_GSC_SETUP_INFO':
          return respond({
            ok: true,
            extensionId: GSC.extensionId(),
            configured: GSC.clientIdConfigured()
          });

        case 'SPS_GSC_CONNECT': {
          await GSC.getToken(true);
          const props = await GSC.listProperties();
          return respond({ ok: true, properties: props });
        }

        case 'SPS_GSC_DISCONNECT': {
          await GSC.revokeToken();
          await Store.setSettings({ gscProperty: '' });
          return respond({ ok: true });
        }

        case 'SPS_GSC_PROPERTIES':
          return respond({ ok: true, properties: await GSC.listProperties() });

        case 'SPS_BLUE_LINK_CTR': {
          const s = await Store.getSettings();
          if (!s.gscProperty) return respond({ ok: false, error: 'Connect a GSC property first.' });
          const log = await Store.getScanLog();
          if (!Object.keys(log).length) {
            return respond({ ok: false, error: 'No scans logged yet. Run a batch scan first.' });
          }
          const result = await GSC.blueLinkCTR(s.gscProperty, log, { days: msg.days || 28 });
          return respond({ ok: true, result });
        }

        case 'SPS_CALIBRATE': {
          const s = await Store.getSettings();
          if (!s.gscProperty) return respond({ ok: false, error: 'Connect a GSC property first.' });
          const log = await Store.getScanLog();
          const out = await GSC.calibrateFromGSC(s.gscProperty, log, msg.days || 90);
          const clean = {};
          for (const [k, v] of Object.entries(out.coefficients)) {
            if (!k.endsWith('__n')) clean[k] = v;
          }
          await Store.setModelOverrides(clean);
          return respond({ ok: true, ...out });
        }

        case 'SPS_BATCH_START':
          startBatch(msg.queries || [], msg.engine || 'https://www.google.com/search?q=');
          return respond({ ok: true, total: batch.total });

        case 'SPS_BATCH_CANCEL':
          batch.cancel = true;
          return respond({ ok: true });

        case 'SPS_BATCH_STATUS':
          return respond({
            ok: true,
            running: batch.running,
            done: batch.done.length,
            total: batch.total,
            results: batch.done,
            rateLimited: batch.rateLimited
          });

        case 'SPS_SCAN_LOG':
          return respond({ ok: true, log: await Store.getScanLog() });

        case 'SPS_CLEAR_LOG':
          await Store.clearScanLog();
          return respond({ ok: true });

        case 'SPS_EXPORT_LOG_CSV': {
          const log = await Store.getScanLog();
          return respond({ ok: true, csv: Store.scanLogToCSV(log) });
        }

        case 'SPS_EXPORT_SCAN_CSV': {
          if (!latest.scan) return respond({ ok: false, error: 'Nothing scanned yet.' });
          return respond({ ok: true, csv: Store.scanToCSV(latest.scan) });
        }

        default:
          return respond({ ok: false, error: 'Unknown message: ' + msg.type });
      }
    } catch (err) {
      console.error('[SPS bg]', msg.type, err);
      respond({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true; // async
});

async function activeSerpTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && /google\.[a-z.]+\/search/.test(tab.url || '')) return tab;
  const tabs = await chrome.tabs.query({ url: ['*://www.google.com/search*', '*://www.google.co.in/search*', '*://www.google.ae/search*'] });
  return tabs[0] || null;
}

/**
 * Batch runner. Opens one reusable tab, walks the keyword list, waits for each
 * scan to land, records it. Paced to stay well inside normal browsing behaviour.
 */
async function startBatch(queries, engine) {
  if (batch.running) return;
  batch.running = true;
  batch.cancel = false;
  batch.rateLimited = false;
  batch.queue = queries.map(q => q.trim()).filter(Boolean);
  batch.done = [];
  batch.total = batch.queue.length;

  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  batch.tabId = tab.id;

  for (const q of batch.queue) {
    if (batch.cancel) break;
    try {
      await chrome.tabs.update(tab.id, { url: engine + encodeURIComponent(q) });
      await waitForComplete(tab.id, 15000);
      await sleep(2200 + Math.random() * 1400); // AIO stream + human-ish pacing

      // Google answers rate limiting with an interstitial at /sorry/. Pushing
      // more requests into that only deepens the block, and every scan after it
      // would be silently empty — which reads as "no features found" rather
      // than "we were stopped". Abort loudly instead.
      const current = await chrome.tabs.get(tab.id).catch(() => null);
      if (current && /\/sorry\/|\/httpservice\/retry/.test(current.url || '')) {
        batch.rateLimited = true;
        batch.done.push({ query: q, ok: false, error: 'Rate limited by Google (/sorry/ interstitial). Batch stopped.' });
        break;
      }

      const res = await chrome.tabs.sendMessage(tab.id, { type: 'SPS_REQUEST_SCAN' }).catch(() => null);
      const s = res?.payload?.summary;
      batch.done.push({
        query: q,
        ok: !!s,
        aioPresent: s?.aioPresent ?? null,
        aioCited: s?.aioCited ?? null,
        ownedRank: s?.ownedRank ?? null,
        ownedEffectivePos: s?.ownedEffectivePos ?? null,
        ownedCTR: s?.ownedCTR ?? null,
        unclassified: s?.unclassified ?? null
      });
    } catch (err) {
      batch.done.push({ query: q, ok: false, error: String(err?.message || err) });
    }
    chrome.runtime.sendMessage({
      type: 'SPS_BATCH_PROGRESS',
      done: batch.done.length,
      total: batch.total,
      last: batch.done[batch.done.length - 1]
    }).catch(() => {});
    await sleep(1200 + Math.random() * 1200);
  }

  try { await chrome.tabs.remove(tab.id); } catch (_) {}
  batch.running = false;
  batch.tabId = null;
  chrome.runtime.sendMessage({
    type: 'SPS_BATCH_DONE',
    results: batch.done,
    rateLimited: !!batch.rateLimited
  }).catch(() => {});
}

function waitForComplete(tabId, timeout) {
  return new Promise(resolve => {
    const done = () => { chrome.tabs.onUpdated.removeListener(fn); clearTimeout(t); resolve(); };
    const fn = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    chrome.tabs.onUpdated.addListener(fn);
    const t = setTimeout(done, timeout);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
