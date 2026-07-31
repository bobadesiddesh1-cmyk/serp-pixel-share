# Testing SERP Pixel Share

Read this before loading the extension. It says plainly what has been verified,
what has not, and what you need to do to close the gap.

---

## What is verified, and how

These ran in a real Chrome with the extension loaded unpacked. Re-run them
yourself with the commands below.

| Area | Status | Command |
|---|---|---|
| Extension loads, service worker registers | verified, zero console errors | manual |
| Side panel: all views, all controls | verified, zero console errors | `node test/run-panel.mjs` |
| Side panel: metrics, bars, pixel map, table, verdict, AIO view | verified against a real scan payload | `node test/run-panel.mjs` |
| No-GSC degradation | verified — message, never a blank panel or a throw | `node test/run-panel.mjs` |
| CTR model, effective position, normalisation | verified | `node test/run-csv.mjs`, see below |
| CSV exporters — escaping, nulls, arrays | verified | `node test/run-csv.mjs` |
| Classify → measure → estimate → overlay pipeline | verified against a **synthetic** fixture | `node test/run-fixture.mjs` |
| Overlay at 1920 / 1440 / 390, both modes | verified — adds 0px page width, no column overlap | `node test/run-fixture.mjs --mode boxes` |

```bash
node test/run-units.mjs                # domain matching + model edge cases
node test/run-fixture.mjs              # inline overlay, three viewports
node test/run-fixture.mjs --mode boxes # box overlay
node test/run-stability.mjs            # rescan loop under DOM churn
xvfb-run -a node test/run-panel.mjs    # side panel (needs a display; drop xvfb-run on a desktop)
node test/run-csv.mjs                  # CSV exporters
```

---

## What is NOT verified

**Every DOM selector, against real google.com.**

The test fixture at `test/fixture-serp.html` is hand-built. It mirrors the
structural anchors the classifier is *allowed* to use — `#center_col`, `#rso`,
`#tads` / `[data-text-ad]`, `role` and `aria-expanded` on PAA rows, the
"AI Overview" label, `a > h3` for organics, `#rhs` for the knowledge panel — but
it is not a capture of Google.

If Google's real markup differs from those assumptions, **the fixture will pass
while the live SERP fails.** Treat a green fixture run as "the pipeline is
sound", never as "the selectors are right".

Also unverified: AI Overview lazy-loading and source-carousel expansion (the
fixture cannot lazy-load), GSC OAuth end to end, and batch mode against Google's
real rate limiting.

---

## Closing the gap: capture diagnostics

This is the fastest path to correct selectors.

1. Load unpacked at `chrome://extensions` → Developer mode → **Load unpacked**.
2. Open the side panel → **Setup** → paste your domains → **Save domains**.
3. For each query below, open it on Google, wait for the AI Overview to finish
   streaming, then click **Setup → Download diagnostic JSON**.

```
personal loan interest rate      AI Overview, ads, PAA
hdfc bank                        knowledge panel, sitelinks
best credit card for fuel        AI Overview, discussions, video
banks near me                    local pack
buy running shoes                shopping
what is cibil score              featured snippet or AI Overview
```

Each file records what the classifier decided **and** the structure of every
main-column block it saw. Send the six files back.

What to look at yourself, per query:

- **`summary.unclassified` must be 0.** Above zero means a block was missed —
  that counter is the maintenance alarm, not a nuisance.
- **Element list vs. what is on screen.** Element order is top-to-bottom by
  pixel. If an ad is tagged `organic`, or the AI Overview is missing, that is a
  selector fault.
- **`aio.containerFound`, `aio.citations`, `aio.expanded`.** Citation
  undercounting propagates into blue-link CTR, so this has to be exact. Compare
  the citation list against the sources Google actually shows after you expand
  the carousel by hand.

---
## Google Search Console setup

The extension works fully without this. GSC adds actual CTR beside the estimate,
blue-link CTR, and model calibration.

Google moved these screens into the **Google Auth Platform** console. The paths
below match that UI. Do the steps in this order — the API enable and the test
user are both easy to skip and both fail later rather than immediately.

### Before you start

**Put the extension folder in its permanent home.** The unpacked extension ID is
derived from the folder path, and the OAuth client is bound to that ID. Moving
the folder afterwards breaks the connection and you redo step 4.

Get your ID from the extension: side panel → **Setup** → the Search Console block
shows it with a **Copy** button.

### 1. Enable the API

<https://console.cloud.google.com/apis/library/searchconsole.googleapis.com>

Confirm the project selector at the top shows the project you intend to use,
then **Enable**.

Skipping this still lets you authenticate — every data call then fails with a
403 that names the disabled API.

### 2. Audience — add yourself as a test user

Google Auth Platform → **Audience**

- User type: **External**
- **Test users** → **+ Add users** → the Google account that has access to your
  Search Console property

Without this, consent fails with "access blocked" or "has not completed the
Google verification process".

Note: while the app is in Testing, refresh tokens expire after **7 days**. You
will periodically press Connect again. That is normal, and not a reason to
publish the OAuth app — publishing triggers a verification review you do not
need for personal use.

### 3. Data Access — add the scope

Google Auth Platform → **Data Access** → **Add or remove scopes**

```
https://www.googleapis.com/auth/webmasters.readonly
```

This page also shows how Google classifies the scope. If it is listed as
**Sensitive**, that only matters when you publish the OAuth app to all users —
Testing mode is unaffected.

### 4. Clients — create the OAuth client

Google Auth Platform → **Clients** → **+ Create client**

- **Application type**: `Chrome Extension`
- **Item ID**: the 32-character extension ID from the panel

This UI labels the field **Item ID**; older docs call it Application ID. Same
value.

Copy the generated client ID. It ends in `.apps.googleusercontent.com`.

### 5. Paste it into the manifest

`manifest.json`:

```json
"oauth2": {
  "client_id": "PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/webmasters.readonly"]
}
```

### 6. Reload and connect

`chrome://extensions` → **Reload** on the extension → side panel → **Setup** →
**Connect** → choose your property from the dropdown.

The setup steps disappear from the panel once a real client ID is present. If
they are still showing, the manifest edit did not take or the extension was not
reloaded.

### Verifying it worked

- The chip on your own listing gains an `actual` value beside `est.`
- AI Overview tab → **Rebuild blue-link CTR** returns totals
- Setup → **Calibrate from GSC** reports a sample size

### When Connect fails

| Message | Cause |
|---|---|
| `bad client id: {0}` | The manifest still holds the placeholder. Chrome could not parse it. |
| `Invalid OAuth2 Client ID` / ID mismatch | The Item ID does not match the current extension ID. The folder moved, or the extension was removed and re-added. |
| `access_denied`, "app is blocked" | You are not on the Audience test user list. |
| 403 naming the API | Step 1 was skipped for this project. |
| Worked yesterday, fails today | Testing-mode refresh token expired after 7 days. Press Connect again. |

### Publishing to the Chrome Web Store

The Web Store assigns a **different** extension ID from your unpacked copy, so
the OAuth client above will not work for the published version. Sequence:

1. Upload the zip as a **draft** — the dashboard then shows the permanent ID.
2. Create a second OAuth client (Chrome Extension) using that store ID.
3. Put that client ID in `manifest.json`, rebuild, upload again.
4. To keep local development on the same ID, install the published extension,
   open its folder in your Chrome profile, and copy the `key` field from its
   `manifest.json` into your development copy.

Keep both clients — one for the store build, one for local work.

## Batch mode

Current pacing per keyword: page load, then 2.2–3.6s for the AI Overview to
stream, then 1.2–2.4s before the next. Roughly 4–7s per keyword, so ten
keywords take about a minute.

**This interval is not validated against Google's real rate limiting** — it was
reasoned about, not measured. The runner now watches for Google's `/sorry/`
interstitial and aborts the batch with a visible message rather than logging a
run of empty scans that would look like "no features found".

If you get rate-limited, tell me how many queries in, and raise the interval.

---

## Reporting a failure

Send the diagnostic JSON plus what you saw on screen. Please do not describe the
fix you think is needed — the diagnostic contains the structure, and guessing at
selectors from a description is how they end up loosened into something that
matches everything.
