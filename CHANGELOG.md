# Changelog

## 0.5.1

### Added

- **Maker credit.** The panel carries a footer — a `BWS` mark, "Built by
  BuildWithSiddesh", and the line *"Rank trackers report a number. This one
  reads the page."* — linking to buildwithsiddesh.com. The on-page HUD carries
  a one-line version under the panel button.

  Both are plain `<a>` elements with `target="_blank"` and
  `rel="noopener noreferrer"`. Nothing is fetched from that host, no query
  parameters are appended, and no click is reported anywhere — the extension
  still makes zero outbound requests until you connect Search Console. The host
  string now shows up in the privacy audit's host grep, so `STORE_LISTING.md`
  names it explicitly alongside the OAuth scope string rather than leaving the
  next person to work out whether it is a fourth endpoint.

  Styling follows the existing tokens: hairline top rule, muted ink, teal only
  on hover. It reads as a signature on the instrument, not an ad inside it.

### Known issue

- **Search Console cannot connect in the published build.** The store assigns
  its own extension ID, and the OAuth client shipped in this version is
  registered against the local unpacked ID. `chrome.identity` rejects the
  mismatch with `bad client id`. Everything else — classification, geometry,
  overlay, panel, pixel map, CSV export — is unaffected. Fixing it needs an
  OAuth client created against the store-assigned ID; that value is only
  visible in the Web Store dashboard after publishing.

## 0.5.0

Hardening pass driven by the six live captures rather than by guesswork. Every
item below was either observed in real data or reproduced in the fixture first.

### Fixed

- **A single organic result could be measured as a 900px block.** The block
  resolver climbed to the last ancestor covering exactly one `h3` — but a
  container holding one result *plus unrelated content* still has exactly one
  heading, so the climb happily took it and inflated that result's height and
  pixel share ninefold. The climb now also stops when an ancestor adds height
  the result cannot explain. Real result blocks measured 102-192px across all
  six captures.

- **A sitelink could out-earn its own parent result.** Observed live: a sitelink
  at 5.5% under a parent at 1.1%. Two causes, both fixed. `social` was scored as
  a flat 0.014 feature share even though it carries a rank and is given an
  effective position, while its sitelinks used the organic curve — so the two
  disagreed. `social` now uses the organic curve. And a sitelink's estimate is
  clamped to its parent's, since a sub-link cannot attract more clicks than the
  result it hangs off.

- **The maintenance alarm was silent exactly when it mattered.** A missed
  section was forgiven if it happened to contain anything classified — which is
  how a 2,402px unidentified block sat on a live SERP with `unclassified: 0`. A
  wrapper is now only forgiven when what we classified explains enough of its
  height. Thresholds were measured against 19 main-column blocks from the six
  captures, where coverage ran 20-100%: a 50% bar would have raised a false
  alarm on a correctly-classified page, so the test is under 35% coverage *and*
  at least 500px unexplained. Silent on all 19, fires on a section-sized hole.

- **The scan log had no cap.** One entry per distinct query, kept forever,
  against a ~10MB quota, and a failed write lost the scan silently. Capped at
  1,000 entries, oldest evicted, with a quota-failure path that keeps the newest
  half rather than dropping the write.

### Added

Regression tests for each: the over-climb guard, the sitelink/parent invariant,
social-scores-as-organic, and an unrecognised-section alarm test.


## 0.4.2

### Fixed

- **Local packs were not detected at all.** Two live captures showed two
  different shapes and neither was found: a self-contained "Places" block whose
  heading sat at a level the selector did not cover, and a "Local results"
  heading whose nearest structural ancestor was a 2,402px block that *also*
  contained organic results 3-6. Accepting that ancestor would double-count the
  results; rejecting it lost the pack entirely.

  Sections are now resolved from their heading **outward** to the tightest
  ancestor tall enough to be the section but which does not wrap the results
  list — the module sits between the two. The heading search covers `h1`-`h3`
  as well as `role="heading"`.

  The fixture carries the harder shape, and the guard is verified to be what
  catches it: with the old `closest()` resolver the fixture finds 0 local packs;
  with the fix it finds exactly 1, at 210px rather than the 1,200px wrapper,
  and every organic result survives.


## 0.4.1

Six live SERP captures. Three of them exposed a fault that made the extension
confidently wrong rather than merely broken.

### Fixed

- **The AI Overview detector invented AI Overviews on pages that had none.**
  On three of six real SERPs it claimed `#gevUs` — the entire results column —
  reporting 88–91% of page height as "AI Overview", manufacturing citations out
  of ordinary result links, and driving the organic count to **zero** because
  the column was then excluded as already-classified. On `hdfc bank` it went
  further and reported **"cites you"**, which is the single most damaging claim
  this tool can get wrong. Those rows also write `aioPresent: true` into the
  scan log, which corrupts blue-link CTR — the number the product exists for.

  Cause: an over-broad attribute selector (`[data-mcpr]`, which sits on ordinary
  containers) plus a structural fallback that guessed at "a tall block above the
  first result". Both are gone. A candidate now has to carry the **"AI Overview"
  label** Google always renders, and must not wrap the results list. Verified
  against the captures: the three real overviews all carry the label and
  `data-lhcontainer`; the three false positives carry neither.

- **A 2,692px "Local results" block was classified as `top_stories`.** The
  detector matched a bare `/news/`, which appears all over a SERP. It now
  anchors on the section label and rejects anything wrapping the results list.
  `localPack()` gained label-driven detection so that block is found correctly
  instead of falling through.

- **Degenerate feature fragments.** Live captures produced People Also Ask
  blocks 23px and 44px tall beside the real 200px+ ones. Feature blocks below
  48px are now rejected; organic results, sitelinks and social stay exempt.

### Verified against live markup

Real AI Overview anchor is `data-lhcontainer="1"` with the label in a heading.
Expansion works on live SERPs. Organic ranks, domains and sitelinks are correct
across all six captures, and `unclassified` was 0 on every one.


## 0.4.0

### Removed

- **Batch mode.** The keyword runner, its tab orchestration, progress reporting,
  cancel, rate-limit detection and the whole Batch tab are gone. The scan log it
  fed remains, and is now written the same way it always was — by measuring
  results pages normally. Its controls moved to Setup, where the other data
  management lives. Blue-link CTR and calibration are unaffected; both read the
  log, not the runner.

### Fixed

- **Duplicate People Also Ask block, found in a live SERP capture.** Two PAA
  containers were classified on the same page, covering `[1347-1593]` and
  `[1383-1593]` — geometrically nested but *not* in a DOM ancestor/descendant
  relationship, so the existing `contains()` guard missed both directions. That
  double-counted PAA pixel share and applied its suppression twice to every
  organic result beneath it. `push()` now also rejects same-type blocks that
  overlap ≥60% vertically, keeping the outer and dropping the subset.
  Reproduced in the fixture first; verified the fixture fails without the new
  guard (2 PAA, 15 elements) and passes with it (1 PAA, 13 elements).


## 0.3.3

### Added

- **The extension ID is pinned via a `key` field in the manifest**, so it no
  longer depends on the install path. Verified by loading the same build from
  two unrelated directories and confirming both resolved to
  `nmkandfnjmliclpbbjggcndfcmjbnomh`. This removes the failure mode where
  moving or re-extracting the folder silently invalidated the OAuth client.
  The field must be removed before Web Store submission.

### Fixed

- **"bad client id" told you nothing when the ID was valid.** Google returns
  that same message both for an unparseable client ID and for a valid one
  registered against a different extension — and never says which. The second
  case is far more common, because the unpacked extension ID changes whenever
  the folder moves or the extension is re-added. Connect now names the
  extension ID the OAuth client must be registered against, and says a moved
  folder is the likely cause.


## 0.3.2

- OAuth client ID configured in `manifest.json`, so Search Console connects
  without further setup. The Setup instructions in the panel hide themselves
  once a real client is present.

Note: the client ID is not a secret. It ships inside every copy of an extension
and is public by design; the Chrome Extension client type has no client secret
at all. Access is bound to the extension ID registered against it.


## 0.3.1

### Fixed

- **"bad client id: {0}" on Connect.** With the placeholder still in
  `manifest.json`, Chrome answers an unparseable OAuth client with an unfilled
  error template — it names neither the cause nor the fix. The extension now
  detects the placeholder before calling `chrome.identity`, disables Connect,
  and says what is actually missing.

### Added

- **Setup steps in the panel**, shown only while no real client ID is
  configured, with the **extension ID displayed and copyable**. That ID is the
  Application ID the OAuth client needs, and `chrome://extensions` was the only
  place to read it.


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
