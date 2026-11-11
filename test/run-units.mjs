// Unit tests for the pure logic: domain matching and model edge cases.
// No browser needed.
//
// Usage: node test/run-units.mjs

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const SPS = require(path.join(ROOT, 'src/shared/constants.js'));
globalThis.SPS = SPS;
const M = require(path.join(ROOT, 'src/model/estimate.js'));

let failures = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!ok) failures++;
};

console.log('DOMAIN MATCHING (SPS.hostMatches)');
// The whole point: a suffix test must not match across a label boundary.
eq('exact match', SPS.hostMatches('google.com', 'google.com'), true);
eq('subdomain matches', SPS.hostMatches('maps.google.com', 'google.com'), true);
eq('deep subdomain matches', SPS.hostMatches('a.b.google.com', 'google.com'), true);
eq('notgoogle.com does NOT match google.com', SPS.hostMatches('notgoogle.com', 'google.com'), false);
eq('fakegoogle.com does NOT match', SPS.hostMatches('fakegoogle.com', 'google.com'), false);
eq('xyzx.com does NOT match x.com', SPS.hostMatches('xyzx.com', 'x.com'), false);
eq('x.com matches x.com', SPS.hostMatches('x.com', 'x.com'), true);
eq('www. stripped on host', SPS.hostMatches('www.hdfcbank.com', 'hdfcbank.com'), true);
eq('www. stripped on pattern', SPS.hostMatches('hdfcbank.com', 'www.hdfcbank.com'), true);
eq('scheme stripped on pattern', SPS.hostMatches('hdfcbank.com', 'https://hdfcbank.com'), true);
eq('path stripped on pattern', SPS.hostMatches('hdfcbank.com', 'hdfcbank.com/loans'), true);
eq('case insensitive', SPS.hostMatches('HDFCBank.COM', 'hdfcbank.com'), true);
eq('trailing dot tolerated', SPS.hostMatches('hdfcbank.com.', 'hdfcbank.com'), true);
eq('parent does not match child', SPS.hostMatches('google.com', 'maps.google.com'), false);
eq('empty host', SPS.hostMatches('', 'google.com'), false);
eq('null host', SPS.hostMatches(null, 'google.com'), false);
eq('null pattern', SPS.hostMatches('google.com', null), false);

console.log('\nDOMAIN LIST (SPS.hostMatchesAny)');
eq('matches one of several', SPS.hostMatchesAny('in.linkedin.com', SPS.SOCIAL_HOSTS), true);
eq('unrelated host', SPS.hostMatchesAny('example.com', SPS.SOCIAL_HOSTS), false);
eq('near-miss host', SPS.hostMatchesAny('notlinkedin.com', SPS.SOCIAL_HOSTS), false);
eq('empty list', SPS.hostMatchesAny('linkedin.com', []), false);
eq('undefined list', SPS.hostMatchesAny('linkedin.com', undefined), false);

console.log('\nEFFECTIVE POSITION EDGE CASES');
eq('zero CTR is finite', Number.isFinite(M.effectivePosition(0)), true);
eq('negative CTR is finite', Number.isFinite(M.effectivePosition(-1)), true);
eq('NaN is finite', Number.isFinite(M.effectivePosition(NaN)), true);
eq('Infinity is finite', Number.isFinite(M.effectivePosition(Infinity)), true);
eq('top CTR maps to position 1', M.effectivePosition(0.99), 1);
eq('rank-2 curve value maps to 2', M.effectivePosition(M.baseCTR(2)), 2);

console.log('\nMODEL SANITY');
const clean = M.estimate({ type: 'organic', rank: 2, yTop: 300 }, []);
const supp = M.estimate({ type: 'organic', rank: 2, yTop: 1680 }, ['ai_overview']);
eq('suppressed CTR is lower than clean', supp < clean, true);
eq('effective position degrades under suppression', M.effectivePosition(supp) > M.effectivePosition(clean), true);
eq('CTR stays within [0,1]', clean >= 0 && clean <= 1 && supp >= 0 && supp <= 1, true);
const n = M.normalise([{ estCTR: 0.2 }, { estCTR: 0.1 }, { estCTR: 0 }]);
eq('normalise sums to 1', Math.round(n.reduce((s, e) => s + e.shareOfClicks, 0) * 1e6) / 1e6, 1);
eq('normalise of all-zero does not divide by zero',
   M.normalise([{ estCTR: 0 }, { estCTR: 0 }]).every(e => e.shareOfClicks === undefined || Number.isFinite(e.shareOfClicks)), true);

console.log('\nSOCIAL IS A RANKED RESULT, NOT A FEATURE');
// A social result carries a rank and gets an effective position, so it must be
// scored on the organic curve. Scoring it as a flat feature share produced a
// live case where its own sitelink came out at 5x its CTR.
const args = [{ rank: 2, yTop: 2523 }, ['ai_overview', 'paa']];
eq('social scores identically to organic',
   M.estimate({ type: 'social', ...args[0] }, args[1]),
   M.estimate({ type: 'organic', ...args[0] }, args[1]));
eq('a deeper sitelink scores at or below its parent rank',
   M.estimate({ type: 'sitelink', rank: 2, yTop: 2622 }, args[1])
     <= M.estimate({ type: 'organic', rank: 2, yTop: 2523 }, args[1]), true);

console.log('\nMODEL ACCURACY VS GSC');
// Pure join + stats, split out of gsc.js so it runs with no account attached.
const { accuracyFromRows } = await import(
  'file://' + path.join(ROOT, 'src/background/gsc.js'));

const mkLog = (q, est, found = true) =>
  [q, { query: q, ownedCTR: est, ownedFound: found, ownedRank: found ? 2 : null }];
const mkRow = (q, ctr, impressions = 500) => ({ query: q, ctr, impressions, position: 2 });

// Estimate is exactly double actual everywhere: median ratio must be 2.
const double = accuracyFromRows(
  [mkRow('a', 0.05), mkRow('b', 0.04), mkRow('c', 0.10)],
  Object.fromEntries([mkLog('a', 0.10), mkLog('b', 0.08), mkLog('c', 0.20)]));
eq('sample counts every comparable query', double.sampleSize, 3);
eq('reports the ratio, not a correlation', double.medianRatio, 2);
eq('nothing is within 25% when it is all 2x off', double.within25, 0);

// One freak result must not decide the verdict — that is why it is a median.
const freak = accuracyFromRows(
  [mkRow('a', 0.05), mkRow('b', 0.05), mkRow('c', 0.05), mkRow('d', 0.0001)],
  Object.fromEntries([mkLog('a', 0.05), mkLog('b', 0.05), mkLog('c', 0.05), mkLog('d', 0.05)]));
eq('an outlier does not move the median', freak.medianRatio, 1);
eq('but it is still counted in the sample', freak.sampleSize, 4);

// Exclusions.
const excl = accuracyFromRows(
  [mkRow('known', 0.05), mkRow('thin', 0.05, 3), mkRow('stranger', 0.05), mkRow('lost', 0.05)],
  Object.fromEntries([mkLog('known', 0.05), mkLog('thin', 0.05), mkLog('lost', null, false)]));
eq('counts only the comparable one', excl.sampleSize, 1);
eq('thin-impression queries are excluded, not silently averaged in', excl.thin, 1);
eq('GSC queries never scanned are reported separately', excl.unmatched, 1);
eq('scans that never found your result are reported separately', excl.unanchored, 1);

eq('no comparable rows reports an empty sample rather than throwing',
   accuracyFromRows([], {}).sampleSize, 0);
// Case and whitespace must not split a query from its own log entry.
eq('query matching is normalised',
   accuracyFromRows([mkRow('  HDFC Bank ', 0.05)],
     Object.fromEntries([mkLog('hdfc bank', 0.05)])).sampleSize, 1);

console.log('\nCALIBRATION PROGRESS');
// Below the threshold the old version returned nothing at all, so the panel
// could only say "not enough data" — identical from one row or seven.
const calRows = [
  ...Array.from({ length: 10 }, (_, i) => ({ query: 'aio' + i, position: 2, ctr: 0.05, featuresAbove: ['ai_overview'] })),
  ...Array.from({ length: 3 }, (_, i) => ({ query: 'paa' + i, position: 3, ctr: 0.06, featuresAbove: ['paa'] })),
  // Two features above: not cleanly attributable, must be ignored entirely.
  { query: 'both', position: 4, ctr: 0.01, featuresAbove: ['ai_overview', 'paa'] },
];
const cal = M.calibrate(calRows);
eq('solves a feature that clears the threshold', 'ai_overview' in cal.coefficients, true);
eq('does not solve one below it', 'paa' in cal.coefficients, false);
eq('counts the feature that solved', cal.counts.ai_overview, 10);
eq('still counts the one that did not', cal.counts.paa, 3);
eq('multi-feature rows are excluded from the counts', cal.counts.ai_overview + cal.counts.paa, 13);
eq('reports the threshold so the UI need not hardcode it', cal.minRows, M.MIN_CALIBRATION_ROWS);
eq('a feature never seen is simply absent', 'local_pack' in cal.counts, false);

console.log('\nSERP DOMAIN COVERAGE');
// The manifest decides where the content script actually runs; constants.js
// decides where the worker and panel think it runs. If they drift, you get a
// tab the panel can see but cannot act on, and no message explaining why.
const manifest = require(path.join(ROOT, 'manifest.json'));
eq('manifest matches the shared pattern list',
   manifest.content_scripts[0].matches, SPS.serpMatchPatterns());
eq('google.com is covered', SPS.isSupportedSerp('https://www.google.com/search?q=x'), true);
eq('bare google.com is covered', SPS.isSupportedSerp('https://google.com/search?q=x'), true);
eq('google.co.in is covered', SPS.isSupportedSerp('https://www.google.co.in/search?q=x'), true);
eq('google.co.uk is covered', SPS.isSupportedSerp('https://www.google.co.uk/search?q=x'), true);
eq('an uncovered Google domain is still recognised AS Google',
   SPS.isGoogleSerp('https://www.google.lv/search?q=x'), true);
eq('...but reports as unsupported',
   SPS.isSupportedSerp('https://www.google.lv/search?q=x'), false);
eq('google maps is not a results page', SPS.isGoogleSerp('https://www.google.com/maps'), false);
eq('a lookalike host is not Google', SPS.isGoogleSerp('https://notgoogle.com/search?q=x'), false);
eq('a host merely containing google is not Google',
   SPS.isGoogleSerp('https://google.com.evil.example/search?q=x'), false);

console.log('\nDOMAIN NORMALISATION (SPS.normaliseDomain)');
// People paste URLs. An un-normalised value never matches anything, and the
// panel then reads exactly like "you do not rank here" — the one failure the
// user cannot tell apart from a real result.
eq('bare domain survives', SPS.normaliseDomain('hdfc.bank.in'), 'hdfc.bank.in');
eq('strips scheme', SPS.normaliseDomain('https://hdfc.bank.in'), 'hdfc.bank.in');
eq('strips www', SPS.normaliseDomain('www.hdfc.bank.in'), 'hdfc.bank.in');
eq('strips scheme, www and path',
   SPS.normaliseDomain('https://www.hdfc.bank.in/personal/borrow'), 'hdfc.bank.in');
eq('strips query and fragment',
   SPS.normaliseDomain('hdfc.bank.in/x?utm=1#top'), 'hdfc.bank.in');
eq('strips port', SPS.normaliseDomain('example.com:8080'), 'example.com');
eq('strips trailing dot', SPS.normaliseDomain('example.com.'), 'example.com');
eq('lowercases', SPS.normaliseDomain('HDFC.Bank.IN'), 'hdfc.bank.in');
eq('trims whitespace', SPS.normaliseDomain('  example.com  '), 'example.com');
eq('keeps a subdomain the user meant', SPS.normaliseDomain('blog.example.com'), 'blog.example.com');
// Rejections — these must come back empty so the caller can say so rather than
// storing a value that silently matches nothing.
eq('rejects empty', SPS.normaliseDomain(''), '');
eq('rejects a bare word', SPS.normaliseDomain('hdfc'), '');
eq('rejects a sentence', SPS.normaliseDomain('my site is example.com'), '');
eq('rejects null', SPS.normaliseDomain(null), '');
// The output has to be something hostMatches can actually use.
eq('output matches the host it came from',
   SPS.hostMatches('www.hdfc.bank.in', SPS.normaliseDomain('https://www.hdfc.bank.in/personal')), true);

console.log(`\n${failures ? 'FAILURES: ' + failures : 'All unit checks passed.'}`);
process.exit(failures ? 1 : 0);
