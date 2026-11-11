// Shared vocabulary. Loaded first in every context.
// Attached to globalThis so content scripts (non-module) and the panel both read it.

const SPS = {
  VERSION: '0.6.0',

  // Maker credit. Rendered in the panel footer and the on-page HUD, and it is
  // a plain link — nothing is fetched from this host, no parameters are
  // appended, and nothing is reported back. It exists so someone who finds the
  // extension useful can find out who wrote it.
  BRAND: {
    name: 'BuildWithSiddesh',
    host: 'buildwithsiddesh.com',
    url: 'https://www.buildwithsiddesh.com/',
    line: 'Rank trackers report a number. This one reads the page.'
  },

  // Element taxonomy. Order = rough top-of-page precedence, not guaranteed.
  TYPES: {
    AI_OVERVIEW: 'ai_overview',
    AD: 'ad',
    SHOPPING: 'shopping',
    PAA: 'paa',
    ORGANIC: 'organic',
    SITELINK: 'sitelink',
    FEATURED_SNIPPET: 'featured_snippet',
    VIDEO: 'video',
    IMAGE_PACK: 'image_pack',
    LOCAL_PACK: 'local_pack',
    DISCUSSIONS: 'discussions',
    SOCIAL: 'social',
    KNOWLEDGE_PANEL: 'knowledge_panel',
    TOP_STORIES: 'top_stories',
    RELATED_SEARCH: 'related_search',
    UNCLASSIFIED: 'unclassified'
  },

  LABELS: {
    ai_overview: 'AI Overview',
    ad: 'Paid ad',
    shopping: 'Shopping',
    paa: 'People also ask',
    organic: 'Organic',
    sitelink: 'Sitelink',
    featured_snippet: 'Featured snippet',
    video: 'Video',
    image_pack: 'Image pack',
    local_pack: 'Local pack',
    discussions: 'Discussions',
    social: 'Social profile',
    knowledge_panel: 'Knowledge panel',
    top_stories: 'Top stories',
    related_search: 'Related search',
    unclassified: 'Unclassified'
  },

  // Measurement-instrument palette. Amber = contamination, teal = yours.
  COLORS: {
    ai_overview: '#C77D0A',
    ad: '#B04A22',
    shopping: '#B04A22',
    paa: '#4A47A3',
    organic: '#6B6A63',
    sitelink: '#8A8880',
    featured_snippet: '#4A47A3',
    video: '#6B6A63',
    image_pack: '#6B6A63',
    local_pack: '#6B6A63',
    discussions: '#8A8880',
    social: '#8A8880',
    knowledge_panel: '#6B6A63',
    top_stories: '#6B6A63',
    related_search: '#A8A69E',
    unclassified: '#C0392B',
    OWNED: '#0B7A5E'
  },

  VIEWPORTS: {
    desktop: { w: 1920, h: 1080, label: 'Desktop 1920x1080' },
    laptop: { w: 1440, h: 900, label: 'Laptop 1440x900' },
    mobile: { w: 390, h: 844, label: 'Mobile 390x844' }
  },

  // Social hosts recognised inside organic results and knowledge panels.
  SOCIAL_HOSTS: [
    'linkedin.com', 'instagram.com', 'facebook.com', 'x.com', 'twitter.com',
    'youtube.com', 'pinterest.com', 'threads.net', 'tiktok.com'
  ],

  FORUM_HOSTS: [
    'reddit.com', 'quora.com', 'stackexchange.com', 'stackoverflow.com',
    'trustpilot.com', 'mouthshut.com'
  ],

  STORAGE: {
    SCANS: 'sps_scans',
    SETTINGS: 'sps_settings',
    GSC: 'sps_gsc_cache',
    MODEL: 'sps_model_overrides'
  },

  DEFAULT_SETTINGS: {
    ownedDomains: [],
    viewport: 'desktop',
    overlayMode: 'inline', // 'inline' | 'boxes' | 'off'
    hudState: 'open',      // on-page summary: 'open' | 'min' | 'off'
    gscProperty: '',
    showEstimates: true
  }
};

/**
 * The BuildWithSiddesh mark, built as DOM rather than markup.
 *
 * The content script draws this into google.com, so it cannot be an <img>
 * pointing at an extension file without declaring the icon a web-accessible
 * resource — which would expose it to every page. Building the nodes avoids
 * that, and avoids innerHTML, and lets the panel and the HUD share one source.
 *
 * Geometry matches icons/bws-mark.svg exactly.
 *
 * @param {number} size rendered edge length in px
 */
SPS.brandMark = function (size) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.style.display = 'block';
  svg.style.flex = 'none';

  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', '32');
  bg.setAttribute('height', '32');
  bg.setAttribute('rx', '8');
  bg.setAttribute('fill', '#c8f135');
  svg.appendChild(bg);

  const strokes = [
    'M7.4 7.6 C5.9 8.2 5.2 9.4 5.4 11 C5.6 12.4 5.2 13.4 4.2 14 C5.4 14.7 5.9 15.8 5.7 17.3 C5.5 18.9 6.1 20.2 7.6 20.9',
    'M24.6 7.6 C26.1 8.2 26.8 9.4 26.6 11 C26.4 12.4 26.8 13.4 27.8 14 C26.6 14.7 26.1 15.8 26.3 17.3 C26.5 18.9 25.9 20.2 24.4 20.9'
  ];
  for (const d of strokes) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('stroke', '#0a0a0c');
    p.setAttribute('stroke-width', '1.8');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    p.setAttribute('fill', 'none');
    svg.appendChild(p);
  }

  const b = document.createElementNS(NS, 'path');
  b.setAttribute('d', 'M12 7.8 H17 C19.2 7.8 20.7 9 20.7 11 C20.7 12.4 19.9 13.4 18.6 13.9 ' +
    'C20.2 14.3 21.1 15.5 21.1 17.1 C21.1 19.2 19.5 20.4 17.2 20.4 H12 Z ' +
    'M14.7 10.1 V12.9 H16.7 C17.7 12.9 18.3 12.4 18.3 11.5 C18.3 10.6 17.7 10.1 16.7 10.1 Z ' +
    'M14.7 15 V18.1 H17 C18 18.1 18.6 17.5 18.6 16.5 C18.6 15.6 18 15 17 15 Z');
  b.setAttribute('fill', '#0a0a0c');
  svg.appendChild(b);

  return svg;
};

/**
 * Google search domains the content script is declared for.
 *
 * Kept here so the service worker and the panel agree with the manifest
 * instead of each carrying their own copy — the drift that produced is a tab
 * the panel can see but cannot act on, with no explanation.
 *
 * MUST stay in step with content_scripts[0].matches in manifest.json;
 * test/run-units.mjs asserts that.
 */
SPS.GOOGLE_TLDS = [
    "com",
    "co.in",
    "co.uk",
    "ca",
    "com.au",
    "de",
    "fr",
    "es",
    "it",
    "nl",
    "be",
    "ch",
    "at",
    "se",
    "no",
    "dk",
    "fi",
    "ie",
    "pt",
    "pl",
    "cz",
    "gr",
    "com.tr",
    "ru",
    "co.za",
    "ae",
    "com.sa",
    "com.eg",
    "com.ng",
    "co.ke",
    "com.sg",
    "com.my",
    "co.id",
    "co.th",
    "com.ph",
    "com.vn",
    "co.jp",
    "com.hk",
    "com.tw",
    "com.br",
    "com.mx",
    "com.ar",
    "cl",
    "com.co",
    "com.pe",
    "co.nz",
    "com.pk",
    "com.bd",
    "lk",
    "com.np"
  ];

/** Match patterns for chrome.tabs.query. */
SPS.serpMatchPatterns = function () {
  return SPS.GOOGLE_TLDS.map(t => `https://*.google.${t}/search*`);
};

/**
 * Any Google results page, supported or not.
 *
 * Parsed rather than pattern-matched against the whole URL. The regex version
 * of this accepted `google.com.evil.example`, because a character class of
 * [a-z.] for the TLD happily swallows further labels — so an attacker-chosen
 * host read as Google. The suffix after "google." is now capped at two
 * letters-only labels, which is every real Google domain and nothing else.
 */
SPS.isGoogleSerp = function (url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (!/^\/search\b/.test(u.pathname)) return false;
  const host = u.hostname.toLowerCase();
  return /^(?:[a-z0-9-]+\.)*google\.[a-z]{2,}(?:\.[a-z]{2,})?$/.test(host);
};

/** A Google results page this build actually measures. */
SPS.isSupportedSerp = function (url) {
  if (!SPS.isGoogleSerp(url)) return false;
  let host;
  try { host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); }
  catch { return false; }
  return SPS.GOOGLE_TLDS.some(t => host === 'google.' + t || host.endsWith('.google.' + t));
};

/**
 * Normalise whatever the user typed into a bare registrable domain.
 *
 * People paste URLs. "https://www.example.com/personal/borrow" has to become
 * "example.com" or the domain silently never matches and the panel stays
 * empty, which is indistinguishable from "you do not rank here".
 *
 * Returns '' for anything that cannot be a hostname, so callers can reject it.
 */
SPS.normaliseDomain = function (input) {
  const d = String(input || '')
    .trim()
    .replace(/^[a-z]+:\/\//i, '')   // scheme
    .replace(/^[^/@]*@/, '')        // userinfo
    .split(/[/?#]/)[0]              // path, query, fragment
    .split(':')[0]                  // port
    .replace(/^www\./i, '')
    .replace(/\.$/, '')
    .toLowerCase();
  // Must look like a hostname: at least one dot, no whitespace, legal chars.
  if (!d || /\s/.test(d) || !d.includes('.') || !/^[a-z0-9.-]+$/.test(d)) return '';
  return d;
};

/**
 * Registrable-domain match, anchored at a label boundary.
 *
 * `host.endsWith(domain)` is wrong and quietly so: "notgoogle.com" ends with
 * "google.com", and "xyzx.com" ends with "x.com". Used for citation filtering
 * that mistake DROPS real citations, which is the one number that has to be
 * exact.
 *
 * @param {string} host   hostname, no scheme, no leading www.
 * @param {string} domain registrable domain to test against
 */
SPS.hostMatches = function (host, domain) {
  if (!host || !domain) return false;
  const h = String(host).replace(/^www\./, '').toLowerCase().replace(/\.$/, '');
  const d = String(domain).replace(/^https?:\/\//, '').replace(/^www\./, '')
    .replace(/\/.*$/, '').toLowerCase().replace(/\.$/, '');
  if (!h || !d) return false;
  return h === d || h.endsWith('.' + d);
};

/** True if the host matches any domain in the list. */
SPS.hostMatchesAny = function (host, domains) {
  if (!host || !domains?.length) return false;
  return domains.some(d => SPS.hostMatches(host, d));
};

if (typeof globalThis !== 'undefined') globalThis.SPS = SPS;
if (typeof module !== 'undefined') module.exports = SPS;
