# Changelog

## 0.3.0

Overlay and side panel redesigned. The old label put four values at four
near-identical sizes, so the rank-to-effective drop — the entire point of the
tool — read as the least important thing in the box.

### Changed

- **The label is now a one-line chip anchored to the result's URL row.** That
  row is short, so the space beside it is already empty, and sitting inside the
  result keeps the overlay out of the right-hand gutter that other SEO
  extensions compete for. `<cite>` is the anchor — semantic and long-lived,
  not a rotating class.
- **Every value carries its label.** `2 -> 5` became
  `ranks #2 · acts like #5`. The arrow assumed the reader had been told what it
  meant; the words assume nothing. Same for `est. CTR`, `page height`,
  `est. clicks`, `cites you`.
- **Monospace is gone from the overlay.** It read as debug output, and nothing
  in a one-line chip needs fixed-width alignment.
- **Depth moved out of the chip** and into the tooltip and panel, where there is
  room to explain it. It is now expressed as what the visitor has to *do* —
  `no scroll`, `1 scroll`, `2 scrolls` — because a raw pixel offset only means
  something to someone who already knows the fold height.
- **The panel leads with the finding.** Four equal stat tiles became one number
  — positions lost — and a sentence stating it. The subtraction was the insight;
  it should not have been homework.
- **The pixel map has a scale.** Screen-edge markers labelled in scrolls, plus
  the page height in pixels and screenfuls. Previously it was colour with
  nothing to measure against.
- **A glossary ships in the Scan view** — est. CTR, acts like #N, depth and
  scrolls, page height share. Always visible, not a tooltip a client will never
  hover, and the depth entry rewrites itself to match the chosen fold reference.
- **The custom hover panel was removed** in favour of the browser's own tooltip.
  Nothing to dismiss and nothing that can cover a result.

### Fixed

- **Elements could silently lose their annotation.** When a chip did not fit and
  no gutter existed, it was dropped — which reads as an element that was never
  detected. Anything that cannot be placed now gets a box instead, and the test
  suite asserts every annotatable element carries something.

### Added

- Zero-added-**height** assertion in the fixture test, beside the existing
  zero-added-width one. The overlay is absolutely positioned and must never
  lengthen the page.
- `SPS_MEASURE.scrollCost()` and `screenCount()`.
- The fixture now uses `<cite>` for result URLs, so the chip's anchor is
  exercised rather than assumed.

## 0.2.2

Full audit pass. Six bugs, none of which announce themselves at runtime — they
produce plausible wrong numbers rather than errors.

### Fixed

- **Domain matching ran off the end of a label.** Every host test used
  `endsWith()`, so `notgoogle.com` matched `google.com` and `xyzx.com` matched
  `x.com`. Three consequences, worst first: legitimate AI Overview citations on
  hosts merely *ending* in `google.com` or `gstatic.com` were discarded as
  Google-internal, **undercounting citations**, which propagates straight into
  blue-link CTR; unrelated domains were tagged as social profiles or forums; and
  owned-domain matching had the same hole. Replaced with a single anchored
  matcher, `SPS.hostMatches`, used everywhere. 22 unit tests cover it.
- **The overlay covered Google's content on narrow windows.** When there was no
  gutter beside the results column, inline labels were deliberately positioned
  *inside* it, on top of the results. Inline mode now falls back to box mode
  when no gutter exists, and the readout says which mode is actually in effect.
  The fixture is responsive so the 390px run genuinely exercises this instead of
  passing against a fixed-width page.
- **Calibration could be fed rows describing a result that was not there.**
  `featuresAbove` means "features stacked above your result", but when the scan
  never located an owned result the loop collected every feature on the page.
  Scans now record `ownedFound`, and calibration skips unanchored rows and
  reports how many it dropped.
- **The Search Console cache grew without bound.** Nothing pruned it, against a
  ~10MB `chrome.storage.local` quota. Expired entries are now dropped and the
  cache is capped at 500 entries, oldest evicted first.
- **`chrome.runtime.lastError` was never read** in the side panel's message
  helper, so any dropped message produced an "Unchecked runtime.lastError"
  console error. It is now read and surfaced as a normal failed response.
- **Owned results classified as social profiles never terminated the
  `featuresAbove` walk**, because only `organic` was checked.

### Added

- `test/run-units.mjs` — 34 assertions covering domain matching and model edge
  cases, no browser required.

### Audited, no action needed

Both `innerHTML` uses are static literals with no interpolation. No `eval`, no
`new Function`, no inline handlers. Every division is guarded against a zero
denominator. The outbound-call audit is unchanged: three `fetch` sites, both
Google, nothing else.

## 0.2.1

Fixes for two faults reported from live testing on Windows: the page churning
continuously, and CTR labels appearing only on the AI Overview and the first
result.

### Fixed

- **Only the first organic result got a label.** Google wraps consecutive
  organic results in a single `#rso > div`. The block resolver added in 0.2.0
  accepted "direct child of the results container" as a single result *before*
  checking how many `h3` headings it covered, so the whole group collapsed into
  one element and every result after the first was deduplicated away. The
  heading count is now checked first. Reproduced in the fixture before fixing;
  the fixture now carries the grouping wrapper permanently.
- **People Also Ask swallowed the entire result group.** The detector scanned
  containers inward, so any ancestor that merely *contained* a PAA block
  matched — including that same group wrapper, which then excluded every
  organic result inside it. It now resolves from the rows outward to the
  tightest container holding at least three of them, and rejects candidates
  containing `h3` headings.
- **The page refreshed continuously.** The scan clicked the AI Overview
  expander, which mutates the DOM, which the scan's own MutationObserver
  treated as a reason to scan again — a self-sustaining loop, on top of an
  unbounded rescan rate against Google's normal background churn. Four guards:
  the AI Overview is expanded at most once per URL, the observer ignores
  mutations from the extension's own nodes, it stays disconnected while a scan
  runs, and auto-rescans are floored at 3s apart.
- **Overlay flicker.** Every scan cleared and rebuilt every overlay node. The
  overlay now redraws only when the layout it depicts actually changed.

### Added

- `test/run-stability.mjs` — drives the fixture under bursty DOM churn and
  asserts the scan count, expander clicks and overlay redraws all converge.
  Verified to fail against the 0.2.0 behaviour (6 scans and 6 expander clicks
  in 10.5s) and pass after the fix (4 scans, 1 click, 1 redraw).

## 0.2.0

First pass of verification against a running Chrome. Everything below was found
by executing the code, not by reading it.

### Fixed

- **GSC disconnect never revoked the token.** `oauth2.googleapis.com` was absent
  from `host_permissions`, so the revoke `fetch` in `gsc.js` was blocked as a
  cross-origin request. The failure was swallowed by a bare `catch`, so
  Disconnect reported success while the grant stayed live on Google's side.
  Added the host permission.
- **`effectivePosition(0)` returned `Infinity`.** Any element estimated at zero
  CTR produced `Infinity` in the HUD, the side panel and the CSV export. Now
  clamped to a finite maximum, with non-finite input guarded.
- **Duplicate elements.** Detectors that resolved to the same node — a heading's
  `closest()` and a container id both matching the related-searches block —
  pushed it twice, doubling its pixel share and corrupting the normalised click
  share. `push()` now rejects a node already in the list.
- **Right-column blocks suppressed the results column.** A knowledge panel in
  `#rhs` shares the vertical range of the results but does not displace them. It
  was being counted as a feature "above" every organic result and inflating
  suppression. Elements now carry a `column` flag and only main-column features
  accumulate.
- **Organic result blocks resolved too narrowly.** `closest()` with a
  `div[jsname]` selector returns the *nearest* matching ancestor, which is
  usually an inner fragment wrapper rather than the whole listing — under-
  measuring height and mis-placing the overlay. Replaced with a climb that stops
  at the last ancestor still covering exactly one `h3`.
- **Sitelink over-capture.** Any anchor below the `h3` counted as a sitelink,
  including "About this result" and breadcrumb chips. Now restricted to anchors
  on the same host as the parent result.
- **AI Overview rendered teal when it cited you.** On the AIO block, `owned`
  means "cites you", not "is your listing", but it was routed through the
  ownership colour. Amber now wins in both the overlay and the panel legend.

### Added

- **Diagnostics export** (Setup → Download diagnostic JSON). Dumps what the
  classifier decided on the active results page alongside a structural
  fingerprint of every main-column block — tag, `id`, `role`, `jsname`,
  `data-*`, heading nesting, link counts. Deliberately records only the anchors
  the classifier is allowed to key on, never hashed class names, so a capture
  stays readable after Google rotates them. This is the artefact to send when a
  result is misclassified.
- **Rate-limit detection in batch mode.** The runner now checks for Google's
  `/sorry/` interstitial after each load and aborts the batch instead of logging
  a run of silently empty scans that would read as "no features found".
- **Test harnesses** under `test/` — pipeline, side panel, and CSV exporters.
  Plain Node, no dependencies beyond a local Playwright.

### Changed

- `estimate.js` no longer hard-depends on the `SPS` global, so the model can be
  exercised standalone. No coefficient values were altered.

### Known unverified

Selector correctness against live google.com. See `TESTING.md`.
