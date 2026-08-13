// Shared vocabulary. Loaded first in every context.
// Attached to globalThis so content scripts (non-module) and the panel both read it.

const SPS = {
  VERSION: '0.5.2',

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
