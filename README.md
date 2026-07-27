# SERP Pixel Share

Chrome extension. Measures where clicks actually go on a Google SERP — pixel position, effective rank, AI Overview citation share, and blue-link CTR.

Built because rank tracking lies. Position 2 sitting at 1,680px under an AI Overview is functionally position 9.

---

## What it does

| Feature | Detail |
|---|---|
| Element classifier | Tags every clickable block: AI Overview, ads, shopping, PAA, organic, sitelinks, featured snippet, video, image pack, local pack, discussions, social, knowledge panel, top stories |
| Pixel measurement | `y` offset, height, and vertical share for each element. Fold line per viewport |
| Effective position | Your rank re-expressed as the rank whose clean-SERP CTR matches your suppressed estimate |
| Inline CTR labels | Estimated CTR rendered beside every listing on the live SERP |
| Overlay boxes | Left-border accent bands, colour-coded by element type |
| AI Overview detection | Presence flag plus citation extraction — expands the source carousel before reading domains |
| Blue-link CTR | Rebuilds CTR excluding impressions where AIO fired. The number that ends the CTR-drop panic |
| Batch mode | Paste a keyword set, auto-scan across google.com / .co.in / .ae, aggregate |
| Calibration | Derives suppression coefficients from your own GSC data instead of published averages |
| Export | Per-scan CSV and full scan-log CSV |

---

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Open a Google search results page
4. Click the toolbar icon to open the side panel

Works without any Google account setup. GSC features are optional.

---

## Connect Google Search Console (optional)

Needed only for actual-CTR overlay, blue-link CTR, and calibration.

1. [Google Cloud Console](https://console.cloud.google.com) → new project
2. Enable **Google Search Console API**
3. Credentials → **Create credentials** → OAuth client ID → **Chrome App**
4. Application ID = your extension ID from `chrome://extensions`
5. Paste the client ID into `manifest.json` → `oauth2.client_id`
6. Reload the extension → side panel → **Connect GSC**

Scope requested is `webmasters.readonly`. Read-only, no write access to your properties.

---

## Architecture

```
manifest.json                  MV3, content scripts + side panel + service worker

src/shared/constants.js        Element taxonomy, colours, viewports, storage keys
src/model/estimate.js          CTR model — base curve x pixel decay x feature suppression
                               plus calibrate() and effectivePosition()

src/content/measure.js         Geometry: absolute y, height, fold flags
src/content/classifier.js      DOM -> element type, structural + attribute anchors
src/content/aio.js             AI Overview detect, MutationObserver, citation domains
src/content/overlay.js         Inline CTR labels and overlay box rendering
src/content/index.js           Orchestrator, scan lifecycle, messaging
src/content/overlay.css        Injected styles, namespaced .sps-

src/background/service-worker.js   Message router, batch runner, panel wiring
src/background/gsc.js              OAuth, Search Console queries, blue-link join
src/background/store.js            chrome.storage wrappers, CSV serialisers

src/sidepanel/panel.{html,js,css} Report UI — metrics, bars, pixel map, batch, GSC
```

### Message API

Service worker handles: `SPS_SCAN_RESULT` `SPS_SCAN_ERROR` `SPS_OPEN_PANEL` `SPS_GET_LATEST` `SPS_RESCAN` `SPS_GET_SETTINGS` `SPS_SET_SETTINGS` `SPS_GET_ACTUALS` `SPS_GSC_CONNECT` `SPS_GSC_DISCONNECT` `SPS_GSC_PROPERTIES` `SPS_BLUE_LINK_CTR` `SPS_CALIBRATE` `SPS_BATCH_START` `SPS_BATCH_CANCEL` `SPS_BATCH_STATUS` `SPS_SCAN_LOG` `SPS_CLEAR_LOG` `SPS_EXPORT_LOG_CSV` `SPS_EXPORT_SCAN_CSV`

---

## The CTR model

```
Est. CTR = BaseCurve(rank) x PixelDecay(y) x FeatureSuppression(types above)
```

- **BaseCurve** — organic CTR by rank on a feature-free SERP, desktop and mobile variants
- **PixelDecay** — `exp(-k * (y - fold) / 1000)`, k = 0.34 desktop / 0.38 laptop / 0.52 mobile
- **FeatureSuppression** — multiplicative penalty per feature above, floored at 0.08

Default suppression coefficients: AI Overview 0.35, featured snippet 0.62, local pack 0.60, shopping 0.72, PAA 0.78, top stories 0.85, video 0.88, image pack 0.90, discussions 0.93, ads 0.94 compounding, knowledge panel 0.97.

**Every coefficient is a default meant to be replaced.** Run **Calibrate** with GSC connected — `calibrate()` takes single-feature query rows, divides observed CTR by expected base CTR, and takes the median ratio per feature. Needs 8+ rows per feature to emit a coefficient. Calibrating across your own properties is what makes the output defensible.

Never present model output as measured truth. The panel labels estimates as estimates — keep it that way in client decks.

---

## AI Overview handling

The measurement problem: GSC counts an impression when your link appears inside an AI Overview, in the same bucket as a blue link. Clicks don't follow. Result is impressions up, clicks flat, position stable, CTR collapsing — and nothing is actually broken.

The extension separates the pools:

| Metric | Definition |
|---|---|
| Reported CTR | GSC raw. Clicks / all impressions |
| Blue-link CTR | Clicks / impressions where no AIO fired |
| AIO exposure rate | Share of impressions with AIO present |
| AIO citation rate | Share of AIO appearances citing you |
| Suppression delta | Blue-link CTR − reported CTR |

Blue-link CTR requires batch scanning a keyword set first — that builds the AIO-presence flags the GSC join needs. Scan, then join.

Citation extraction expands the lazy-loaded source carousel before reading domains. Without that step, citations undercount badly.

---

## Maintenance

Google rotates class names. The classifier uses structural and attribute anchors (`[data-attrid]`, `[data-text-ad]`, `role`, heading nesting) rather than hashed classes like `.MjjYud` — but selectors still rot.

When a Google update lands:

1. Panel shows an **unclassified** count. Non-zero means selectors need attention.
2. Unclassified elements are logged with their outer HTML shape.
3. Patch `src/content/classifier.js`, bump `manifest.json` version.

Budget selector maintenance roughly monthly. Treat the unclassified counter as the alarm.

---

## Scope and limits

- Scans the current user's own browser session only. No server-side scraping, no proxying, no SERP data leaving the machine except GSC API calls to Google.
- Personalisation, location, and login state affect the SERP you measure. Batch runs from one machine are not a neutral sample.
- Estimated CTR is a model. Actual CTR comes only from GSC, and only for your own properties.
- Chrome 116+ for `chrome.sidePanel`.

---

## Roadmap

- Historical re-scan scheduling, SERP layout drift charts
- Competitor pixel-share tracking across a keyword set
- Share-of-AIO-citation leaderboard by domain
- Mobile emulation via CDP instead of viewport arithmetic
