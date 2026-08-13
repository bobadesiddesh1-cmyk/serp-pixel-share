# Chrome Web Store listing copy

Draft. Read the privacy disclosure section before submitting — one claim in it
depends on the shipped code staying as it is.

---

## Name

SERP Pixel Share

## Short description (132 char max)

Measure where clicks actually go on a Google results page: pixel position, effective rank, AI Overview citations, blue-link CTR.

## Detailed description

Rank tracking tells you that you are position 2. It does not tell you that
position 2 renders at 1,680 pixels, below an AI Overview and two ad blocks,
where it performs closer to position 9.

SERP Pixel Share measures the gap.

**What it measures**

- Every clickable block on the page, classified: AI Overview, ads, shopping,
  People Also Ask, organic, sitelinks, featured snippets, video, image packs,
  local packs, discussions, knowledge panels, top stories.
- Pixel geometry per element — vertical offset, height, share of total page
  height, and whether it falls above the fold at desktop, laptop and mobile.
- Effective position: your rank restated as the rank whose clean-SERP CTR
  matches your suppressed estimate.
- AI Overview presence, how much page height it occupies, and which domains it
  cites — including whether one of them is yours.
- Blue-link CTR: your Search Console CTR recomputed over only the impressions
  where no AI Overview fired. This is the number that answers "did our CTR
  really collapse, or did the SERP change shape?"

**How it shows it**

Two overlay modes on the live results page — inline CTR labels beside each
listing, or colour-coded accent bands by element type — plus a pixel ruler and a
summary readout. A side panel carries the full breakdown: metrics, click share
by element, a vertical pixel map, and CSV export.

**Calibration**

Every coefficient in the CTR model is a default meant to be replaced. Connect
Search Console and the extension solves feature-suppression coefficients from
your own data rather than published averages.

**On estimates**

Estimated CTR is model output, not measured data, and the interface labels it
that way everywhere it appears. Connect Search Console to see actual CTR beside
the estimate. Keep the distinction when this goes into a client report.

---

## Permission justifications

Written to be pasted into the Web Store's per-permission fields.

**storage** — Saves your settings (owned domains, fold reference viewport,
overlay mode, selected Search Console property) and the local scan log that
powers blue-link CTR, CSV export and model calibration. All of it stays in
local extension storage on this machine.

**activeTab** — Lets the side panel act on the results page you are looking at
when you press Re-scan, without standing access to any other tab.

**scripting** — Runs the measurement pass in the results page so element
geometry is read from the rendered layout. Pixel position cannot be derived from
HTML alone; it has to be measured after render.

**sidePanel** — The report interface is a side panel, so the full breakdown can
sit beside the results page instead of covering it.

**tabs** — Locates the active Google results tab when you press Re-scan or
export a diagnostic, so the side panel acts on the page you are looking at.

**identity** — Google's OAuth flow for connecting Search Console. Requested only
when you press Connect, and only for the read-only scope
`https://www.googleapis.com/auth/webmasters.readonly`. The extension never
requests write access to your properties.

**Host permissions** — `www.google.com`, `www.google.co.in`, `www.google.ae` are
the results pages being measured. `searchconsole.googleapis.com` is the Search
Console API. `oauth2.googleapis.com` is used only to revoke your token when you
press Disconnect.

---

## Privacy disclosure

**What leaves your machine: nothing about the pages you measure.**

Element classification, pixel measurement, CTR estimation and AI Overview
citation extraction all run locally in the page and the extension. Results are
written to local extension storage. There is no analytics, no telemetry, no
crash reporting, and no server operated by us — there is no backend at all.

The only outbound network requests the extension makes are to Google's own
endpoints, and only if you choose to connect Search Console:

- `https://searchconsole.googleapis.com` — reads your Search Console
  performance data, read-only scope.
- `https://oauth2.googleapis.com/revoke` — revokes your token when you press
  Disconnect.
- Google's OAuth consent flow, via Chrome's `identity` API, when you press
  Connect.

If you never connect Search Console, the extension makes no outbound requests at
all.

Your scan history and measured SERP data are never transmitted
anywhere. Uninstalling removes them.

**Verification note — re-check before each submission.** The claim above is only
true while the shipped code contains no other network calls. Re-run as of 0.5.1,
the archive being submitted: three `fetch` call sites, all in
`src/background/gsc.js`, targeting only `searchconsole.googleapis.com` and
`oauth2.googleapis.com/revoke`; no `XMLHttpRequest`, no `sendBeacon`, no
`WebSocket`, no remote script loading.

Two host strings in the source are never fetched, and the host grep below will
show both:

- `www.googleapis.com` — the OAuth scope identifier in `manifest.json`.
- `www.buildwithsiddesh.com` — the `href` of the maker-credit link in the panel
  footer and the on-page HUD. It navigates only when the user clicks it, carries
  no query parameters, and nothing is sent to it.

Re-run before publishing:

```bash
grep -rnE "fetch\(|XMLHttpRequest|sendBeacon|new WebSocket|importScripts" src/
grep -rnoE "https?://[a-zA-Z0-9._/-]+" src/ manifest.json | sort -u
```

If either turns up a host outside that list, this disclosure is wrong and must be
corrected before submitting.

---

## Single purpose statement

Measuring the pixel-level layout of Google search results pages and estimating
how that layout redistributes clicks, for SEO analysis.

## Category

Developer Tools (alternative: Workflow & Planning)
