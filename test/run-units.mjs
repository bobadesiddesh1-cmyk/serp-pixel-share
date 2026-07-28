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

console.log(`\n${failures ? 'FAILURES: ' + failures : 'All unit checks passed.'}`);
process.exit(failures ? 1 : 0);
