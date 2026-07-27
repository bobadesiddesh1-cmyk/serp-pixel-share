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
node test/run-fixture.mjs              # inline overlay, three viewports
node test/run-fixture.mjs --mode boxes # box overlay
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

## GSC OAuth setup

The extension works fully without this. GSC adds actual CTR beside the estimate,
blue-link CTR, and calibration.

You need your **extension ID** first: `chrome://extensions` → find SERP Pixel
Share → copy the ID (32 lowercase letters).

> **The ID is derived from the folder path.** Loading the same code from a
> different directory produces a different ID and the OAuth client stops
> matching — I hit this moving from the source folder to an unpacked copy of the
> release zip, and the ID changed. Either keep the extension in one fixed
> folder, or pin the ID by adding a `key` to `manifest.json`:
>
> 1. Load unpacked once and pack it: `chrome://extensions` → **Pack extension**.
>    This produces a `.pem` private key alongside a `.crx`.
> 2. Get the public key: `openssl rsa -in key.pem -pubout -outform DER | base64 -w 0`
> 3. Add it as `"key": "<that base64 string>"` at the top level of
>    `manifest.json`.
>
> The ID is then stable across folders and machines. Keep the `.pem` private and
> out of version control. Remove the `key` field before Web Store submission —
> the store assigns its own identity.

1. Go to <https://console.cloud.google.com> → create a project (or pick one).
2. **APIs & Services → Library** → search **Google Search Console API** →
   **Enable**.
3. **APIs & Services → OAuth consent screen** → External → fill the app name and
   your email → add yourself under **Test users**. Do not submit for
   verification; you do not need it for personal use.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
5. Application type: **Chrome App** (listed as *Chrome Extension* in newer
   console UI).
6. **Application ID**: paste your extension ID from above.
7. Copy the generated client ID. It ends in `.apps.googleusercontent.com`.
8. Open `manifest.json` and replace the placeholder:

```json
"oauth2": {
  "client_id": "PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/webmasters.readonly"]
}
```

9. `chrome://extensions` → **Reload** on the extension.
10. Side panel → **Setup → Connect**. Pick your property from the dropdown.

Scope stays `webmasters.readonly` — read-only, no write access to your
properties. If you change the scope, the token cache must be cleared with
Disconnect first.

**If Connect fails:** the two usual causes are an Application ID that does not
match the current extension ID, and not having added yourself as a test user on
the consent screen.

---

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
