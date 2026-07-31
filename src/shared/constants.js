// Shared vocabulary. Loaded first in every context.
// Attached to globalThis so content scripts (non-module) and the panel both read it.

const SPS = {
  VERSION: '0.3.3',

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
