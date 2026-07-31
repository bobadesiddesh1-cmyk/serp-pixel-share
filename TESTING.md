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

### 2. Audience — check the publishing status

Google Auth Platform → **Audience**. What you do here depends on which state the
app is already in. The page tells you at the top under **Publishing status**.

**If it says "In production"** — there is no test user list, and you do not need
one. Anyone can consent. Two consequences:

- Connecting shows a **"Google hasn't verified this app"** screen. Click
  **Advanced** → **Continue to SERP Pixel Share (unsafe)**. That is expected for
  an unverified app requesting a sensitive scope, not a fault.
- A **100-user lifetime cap** is displayed, but it applies only to unapproved
  sensitive or restricted scopes. With `webmasters.readonly` classified as
  non-sensitive, it does not bind. Verify on the Data Access page before
  relying on this.

**If it says "Testing"** — add yourself: **Test users** → **+ Add users** → the
Google account with access to your Search Console property. Without it consent
fails with "access blocked". Note that in Testing, refresh tokens expire after
**7 days**, so you will re-press Connect regularly.

For one person measuring their own properties, **In production is the better
state** — no 7-day expiry, and the unverified warning is a single extra click.

**Do not submit for verification yet.** It is only needed to remove the warning
screen and lift the user cap, which matters when strangers use the extension,
not while you do. Verification wants a hosted privacy policy, a demo video, a
scope justification and domain ownership proof.

**The 100-user cap is permanent per Cloud project.** If you intend to publish
publicly on this project later, every consent spent now is spent for good. Use a
separate throwaway project for experiments if that is a concern.

### 3. Data Access — add the scope

Google Auth Platform → **Data Access** → **Add or remove scopes**

```
https://www.googleapis.com/auth/webmasters.readonly
```

This page also shows how Google classifies the scope. **`webmasters.readonly`
lists under "Your non-sensitive scopes"** — confirmed in the console on
1 Aug 2026, against the expectation that a Search Console scope would be
sensitive.

That matters more than it sounds:

- **No OAuth verification review** is required to publish the app. Verification
  applies to unapproved sensitive and restricted scopes.
- **The 100-user cap does not apply.** The console states the cap covers
  "unapproved sensitive or restricted scopes" only.
- Users are unlikely to see the "unverified app" interstitial, which is also
  driven by sensitive and restricted scopes.

Do not take this as permanent — Google reclassifies scopes. Re-check this page
before any public release, since the privacy disclosure and the store listing
both depend on it.

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
