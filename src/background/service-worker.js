// Service worker. Message router.

import * as GSC from './gsc.js';
import * as Store from './store.js';

// Service workers do not get content_scripts' shared files, so import constants.
import '../shared/constants.js';
import '../model/estimate.js';

const latest = { scan: null, tabId: null, error: null };

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
          // Incognito scans are measured and shown, but never written to disk.
          // The extension runs in spanning mode, so chrome.storage.local is the
          // SAME store for both contexts — recording here would leave the user's
          // incognito queries in the scan log after the window closed, which is
          // the one thing someone working in incognito is relying on not to
          // happen. The cost is that blue-link CTR and calibration cannot see
          // these scans; the panel says so rather than leaving it to be guessed.
          const incognito = sender.tab?.incognito === true;
          latest.scan = msg.payload;
          latest.tabId = sender.tab?.id ?? null;
          latest.incognito = incognito;
          latest.error = null;
          if (!incognito) await Store.recordScan(msg.payload);
          chrome.runtime.sendMessage({
            type: 'SPS_PANEL_UPDATE', payload: msg.payload, incognito
          }).catch(() => {});
          return respond({ ok: true, logged: !incognito });
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
          return respond({
            ok: true, payload: latest.scan, error: latest.error,
            incognito: latest.incognito === true
          });

        case 'SPS_RESCAN': {
          const { tab, error } = await requireSerpTab();
          if (!tab) return respond({ ok: false, error });
          const res = await chrome.tabs.sendMessage(tab.id, { type: 'SPS_REQUEST_SCAN' });
          return respond(res || { ok: false });
        }

        case 'SPS_DIAGNOSTIC': {
          const { tab, error } = await requireSerpTab();
          if (!tab) return respond({ ok: false, error });
          const res = await chrome.tabs.sendMessage(tab.id, { type: 'SPS_REQUEST_DIAGNOSTIC' });
          return respond(res || { ok: false, error: 'No response from the results page.' });
        }

        case 'SPS_GET_SETTINGS':
          return respond({ ok: true, settings: await Store.getSettings() });

        case 'SPS_SET_SETTINGS': {
          const next = await Store.setSettings(msg.patch);
          const { tab } = await findSerpTab();
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
            return respond({ ok: false, error: 'No scans logged yet. Measure a few results pages first.' });
          }
          const result = await GSC.blueLinkCTR(s.gscProperty, log, { days: msg.days || 28 });
          return respond({ ok: true, result });
        }

        case 'SPS_MODEL_ACCURACY': {
          const s = await Store.getSettings();
          if (!s.gscProperty) return respond({ ok: false, error: 'Connect a GSC property first.' });
          const log = await Store.getScanLog();
          if (!Object.keys(log).length) {
            return respond({ ok: false, error: 'No scans logged yet. Measure a few results pages first.' });
          }
          const out = await GSC.accuracyVsActuals(s.gscProperty, log, { days: msg.days || 28 });
          return respond({ ok: true, ...out });
        }

        case 'SPS_CALIBRATE': {
          const s = await Store.getSettings();
          if (!s.gscProperty) return respond({ ok: false, error: 'Connect a GSC property first.' });
          const log = await Store.getScanLog();
          const out = await GSC.calibrateFromGSC(s.gscProperty, log, msg.days || 90);
          // calibrate() now returns only solved coefficients, so there is
          // nothing to strip before storing them.
          await Store.setModelOverrides(out.coefficients);
          return respond({ ok: true, ...out });
        }

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

/**
 * The results tab a panel action should act on.
 *
 * Two corrections over the obvious version, both found by driving a real
 * incognito window:
 *
 * `currentWindow` is meaningless in a service worker — there is no window the
 * worker is "in" — so it resolves to whatever Chrome last decided. The
 * documented way for a background context to mean "the window the user is
 * looking at" is `lastFocusedWindow`.
 *
 * The fallback used to return the first matching tab in the whole profile. With
 * a results page open in both a normal and an incognito window — the normal
 * state of affairs for anyone who researches in incognito — Re-scan could
 * silently measure the other window's page and report it as the current one.
 * The fallback now stays inside the context the user is working in, and returns
 * nothing rather than crossing the boundary.
 *
 * Returns { tab } when there is one to act on, or { unsupported } naming the
 * host when the user IS on a Google results page that this build does not
 * cover. Saying "no results tab" while one is plainly open on screen is the
 * kind of answer that gets an extension uninstalled.
 */
async function findSerpTab() {
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (SPS.isSupportedSerp(focused?.url)) return { tab: focused };

  const wantIncognito = focused?.incognito === true;
  const tabs = await chrome.tabs.query({ url: SPS.serpMatchPatterns() });
  const hit = tabs.find(t => t.incognito === wantIncognito);
  if (hit) return { tab: hit };

  // Nothing supported. Is the user looking at a Google results page anyway?
  if (SPS.isGoogleSerp(focused?.url)) {
    try { return { unsupported: new URL(focused.url).hostname.replace(/^www\./i, '') }; }
    catch { /* fall through */ }
  }
  const all = await chrome.tabs.query({ active: true });
  const other = all.find(t => t.incognito === wantIncognito && SPS.isGoogleSerp(t.url));
  if (other) {
    try { return { unsupported: new URL(other.url).hostname.replace(/^www\./i, '') }; }
    catch { /* fall through */ }
  }
  return {};
}

/** Message-handler shorthand: the tab, or the error to answer with. */
async function requireSerpTab() {
  const r = await findSerpTab();
  if (r.tab) return r;
  return {
    error: r.unsupported
      ? `${r.unsupported} is a Google results page this build does not measure yet. ` +
        'Supported domains are listed in the extension description — tell me which one you need.'
      : 'No Google results tab in focus.'
  };
}

