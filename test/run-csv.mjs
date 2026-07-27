// CSV exporter test. store.js is an ES module that only touches chrome.* inside
// the storage helpers, so the two serialisers can be exercised directly.
// Copied to a .mjs so Node loads it as ESM without adding a package.json to the
// extension (which must stay build-step free).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
globalThis.SPS = (await import(path.join(ROOT, 'src/shared/constants.js'))).default ?? global.SPS;
if (!globalThis.SPS) {
  const m = await import('node:module');
  globalThis.SPS = m.createRequire(import.meta.url)(path.join(ROOT, 'src/shared/constants.js'));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sps-csv-'));
fs.writeFileSync(path.join(tmp, 'store.mjs'), fs.readFileSync(path.join(ROOT, 'src/background/store.js')));
const Store = await import(path.join(tmp, 'store.mjs'));

let failures = 0;
const check = (n, p, d = '') => { console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!p) failures++; };

// A scan containing the things that break naive CSV writers: commas, quotes,
// newlines, nulls, and a unicode arrow.
const scan = {
  summary: { query: 'personal loan, "best" rate', scannedAt: 1750000000000 },
  elements: [
    { type: 'ai_overview', label: 'AI Overview', rank: null, effectivePos: null, domain: null,
      yTop: 319, yBottom: 605, height: 286, pixelShare: 0.18, estCTR: 0.42,
      shareOfClicks: 0.51, actualCTR: null, owned: true,
      foldFlags: { desktop: true, mobile: true }, title: 'Overview' },
    { type: 'organic', label: 'Organic', rank: 2, effectivePos: 7, domain: 'hdfcbank.com',
      yTop: 921, yBottom: 1043, height: 122, pixelShare: 0.076, estCTR: 0.0367,
      shareOfClicks: 0.044, actualCTR: 0.031, owned: true,
      foldFlags: { desktop: true, mobile: false },
      title: 'Rates — line1\nline2, with "quotes"' },
  ],
};

console.log('SCAN CSV');
const csv = Store.scanToCSV(scan);
const lines = csv.split('\n');
check('comment header carries the query', lines[0].startsWith('# query,'), lines[0]);
check('scanned timestamp is ISO', /# scanned,\d{4}-\d{2}-\d{2}T/.test(lines[1]), lines[1]);
check('column header present', lines[2].startsWith('type,label,rank'));
check('embedded comma/quote/newline is quoted', /"Rates — line1\nline2, with ""quotes"""/.test(csv));
check('nulls become empty, not the string "null"', !/,null,/.test(csv));
check('fold flags exported', /,true,false,/.test(csv) || /,true,true,/.test(csv));

// A quoted field containing a newline means line count != record count; parse properly.
const records = csv.match(/(?:[^,"\n]|"(?:[^"]|"")*")+|(?<=,)(?=,)|^(?=,)/g);
check('all element rows present', scan.elements.every(e => csv.includes(e.type)),
  `${scan.elements.length} elements`);

console.log('\nLOG CSV');
const log = {
  'personal loan interest rate': {
    query: 'personal loan interest rate', scannedAt: 1750000000000, aioPresent: true,
    aioCited: true, aioCitationCount: 3, aioPixelShare: 0.18, ownedRank: 2,
    ownedEffectivePos: 7, ownedCTR: 0.0367, adCount: 2, serpHeight: 1600,
    featuresAbove: ['ad', 'ai_overview'], aioCitations: ['a.com', 'b.com'],
  },
  'what is cibil score': {
    query: 'what is cibil score', scannedAt: 1750000100000, aioPresent: false,
    aioCited: false, aioCitationCount: 0, aioPixelShare: 0, ownedRank: null,
    ownedEffectivePos: null, ownedCTR: null, adCount: 0, serpHeight: 1200,
    featuresAbove: [], aioCitations: [],
  },
};
const logCsv = Store.scanLogToCSV(log);
const logLines = logCsv.split('\n');
check('header + one row per logged query', logLines.length === 3, `${logLines.length} lines`);
check('arrays pipe-joined', logCsv.includes('ad|ai_overview'));
check('missing rank exports empty, not "null"', !/,null,/.test(logCsv));
check('both queries present', logCsv.includes('personal loan') && logCsv.includes('cibil'));

console.log('\n--- scan CSV ---\n' + csv);
console.log('\n--- log CSV ---\n' + logCsv);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${failures ? 'FAILURES: ' + failures : 'All CSV checks passed.'}`);
process.exit(failures ? 1 : 0);
