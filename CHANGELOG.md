# Changelog

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
