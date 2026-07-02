// The target companies Commander watches, one config entry each. Adding/tailoring a company is a
// config edit here — never a core-code change (the UAV lesson). Each entry declares:
//
//   key        unique slug (also the source_key stored on feed rows)
//   label      display name — MUST match the sniper `companies.name` so the SITREP rollup and
//              cross-app links can join by name (like UAV's job_postings.company). GOTCHA: the CRM
//              row for Google is named "Gemini" (and UAV postings use it too) — label accordingly.
//   appLimit   optional {max, windowDays}: the company caps applications in a rolling window
//              (replicated from uav/src/sources.js) so the "apply to open roles" action is
//              quota-aware and goes quiet when the window is full
//   profile    'public' | 'private' — gates the `financial` feed (only public companies have one)
//   homeUrl    the company's site (linked in the UI)
//   xListUrl   optional: a curated X/Twitter List to link OUT to (no in-app scraping in v1)
//   links      optional [{label, url}]: extra header link-outs (e.g. a login-gated events forum we
//              can't fetch)
//   feeds      map of kind -> feed config; kind ∈ {news, blog, event, financial, research, general}.
//              Each config names an `adapter` (see src/feeds/) plus its params, and may set `label`
//              to override the column title in the UI (e.g. OpenAI's news kind shows as "Company").
//              A company only lists the feeds it actually has.
//   intelDocs  seeds for the curated intel panel: {section, title, url, seedable?}. `seedable:true`
//              means the pipeline may fetch+store the page text; otherwise it's a manual paste (e.g.
//              gated pages like OpenAI's interview guide) and only the source_url is pre-filled.
//
// NOTE: html-adapter selectors are best-effort and tuned as each company is brought online (the build
// order: OpenAI → Anthropic → Cursor → NVIDIA/Google → Arize). A stale selector throws and is isolated
// per-feed, exactly like a UAV fetch failure — it never corrupts the other feeds.

export const SOURCES = [
  // --- Top private targets -------------------------------------------------
  {
    key: 'anthropic',
    label: 'Anthropic',
    profile: 'private',
    homeUrl: 'https://www.anthropic.com',
    feeds: {
      // Anthropic card anatomy (hash-proof [class*=…] hooks): featured-grid + publication-list news
      // cards both carry a __title element and a __date element; engineering cards use h3 + __date.
      news: {
        adapter: 'html', url: 'https://www.anthropic.com/news', item: 'a[href^="/news/"]',
        title: '[class*="__title"]', date: '[class*="__date"]', summary: '[class*="__body"]',
      },
      blog: {
        adapter: 'html', url: 'https://www.anthropic.com/engineering', item: 'a[href^="/engineering/"]',
        title: 'h3', date: '[class*="__date"]', summary: '[class*="__description"]',
      },
      // Webflow events list: data lives in fs-list-field attributes on .event_list_item containers
      // (the /events/ <a> itself is just an invisible "Learn more" overlay). No location field —
      // `format` (In-person / Virtual) is the closest thing, shown as the location chip.
      event: {
        adapter: 'html', url: 'https://www.anthropic.com/events', item: '.event_list_item',
        title: '[fs-list-field="title"]', link: 'a[href^="/events/"]',
        date: '[fs-list-field="date"]', location: '[fs-list-field="format"]', eventDates: true,
      },
      // Research publications — same PublicationList component as /news, same hooks. :not() drops
      // the static /research/team/* links (Alignment / Interpretability / …) the hero section adds.
      research: {
        adapter: 'html', url: 'https://www.anthropic.com/research', item: 'a[href^="/research/"]:not([href*="/team/"])',
        title: '[class*="__title"]', date: '[class*="__date"]',
      },
    },
    intelDocs: [
      { section: 'policy', title: 'Candidate AI guidance', url: 'https://www.anthropic.com/candidate-ai-guidance', seedable: true },
      { section: 'values', title: 'Constitution', url: 'https://www.anthropic.com/constitution', seedable: true },
    ],
  },
  {
    key: 'openai',
    label: 'OpenAI',
    profile: 'private',
    homeUrl: 'https://openai.com',
    appLimit: { max: 5, windowDays: 180 },
    // Events live at forum.openai.com/home/events — LOGIN-GATED, can't be fetched; link out instead.
    links: [{ label: 'Events (forum)', url: 'https://forum.openai.com/home/events' }],
    // One RSS, four buckets split by <category> (Doug's 2026-07-02 mapping). Priority is encoded via
    // excludes so a multi-category item lands in exactly ONE bucket: Company wins, then
    // Research+Product, then Safety/Eng/Security, everything else falls through to Other.
    feeds: {
      news: {
        adapter: 'rss', url: 'https://openai.com/news/rss.xml', label: 'Company',
        categories: ['Company'],
      },
      research: {
        adapter: 'rss', url: 'https://openai.com/news/rss.xml', label: 'Research & Product',
        categories: ['Research', 'Product'], excludeCategories: ['Company'],
      },
      blog: {
        adapter: 'rss', url: 'https://openai.com/news/rss.xml', label: 'Safety · Eng · Security',
        categories: ['Safety', 'Safety & Alignment', 'Engineering', 'Security'],
        excludeCategories: ['Company', 'Research', 'Product'],
      },
      general: {
        adapter: 'rss', url: 'https://openai.com/news/rss.xml', label: 'Other',
        excludeCategories: ['Company', 'Research', 'Product', 'Safety', 'Safety & Alignment', 'Engineering', 'Security'],
      },
    },
    intelDocs: [
      { section: 'mission', title: 'Charter', url: 'https://openai.com/charter/', seedable: false },
      { section: 'interview_guide', title: 'Interview guide', url: 'https://openai.com/interview-guide/', seedable: false },
    ],
  },
  {
    key: 'cursor',
    label: 'Cursor',
    profile: 'private',
    homeUrl: 'https://www.cursor.com',
    // Cursor is lean (Doug, 2026-07-02): blog + changelog on cursor.com, announcements + North
    // America events on their Discourse forum — Discourse gives free RSS (append .rss to any
    // category URL), so those two need no HTML parsing at all.
    feeds: {
      news: {
        adapter: 'rss', url: 'https://forum.cursor.com/c/announcements/11.rss', label: 'Announcements',
      },
      event: {
        adapter: 'rss', url: 'https://forum.cursor.com/c/events/north-america/27.rss', label: 'Events (NA)',
      },
      // blog cards (scoped to a[class*=card] — bare /blog/ links like "View all press →" are nav
      // junk; matches both feature cards AND a.blog-directory__row list rows). In every variant the
      // FIRST p[class*=text-theme-text] is the title; date in <time>, excerpt in the -sec p.
      blog: {
        adapter: 'html', url: 'https://www.cursor.com/blog', item: 'a[class*="card"][href^="/blog/"], a[class*="blog-directory__row"]',
        title: 'p[class*="text-theme-text"]', date: 'time', summary: 'p[class*="text-theme-text-sec"]',
      },
      // changelog: each entry's h1 wraps a link with the real title; the sibling date link isn't
      // reachable from it, so entries are undated (first-seen ordering — fine for a changelog)
      general: {
        adapter: 'html', url: 'https://www.cursor.com/changelog', item: 'h1 > a[href^="/changelog/"]', label: 'Changelog',
      },
    },
    intelDocs: [
      { section: 'mission', title: 'About', url: 'https://www.cursor.com/about', seedable: false },
    ],
  },

  // --- Public companies (have a financial feed) ----------------------------
  {
    key: 'nvidia',
    label: 'NVIDIA',
    profile: 'public',
    homeUrl: 'https://www.nvidia.com',
    // All four content feeds are real RSS (source sweep 2026-07-02) — zero HTML parsing:
    //  - newsroom press releases (MediaRoom platform exposes /rss.xml)
    //  - company blog (WordPress /feed/)
    //  - dev blog (WordPress Atom at /blog/feed/)
    //  - The AI Podcast (Megaphone feed, found via the iTunes lookup API)
    // Events page + webinar portal are JS-rendered grids (nav-only server HTML) → link-outs.
    // investor.nvidia.com hard-403s non-browser clients → no financial feed; the financial_brief
    // intel section (manual paste) covers it for now.
    // Also available, skipped: nvidianews.nvidia.com/in-the-news (3rd-party press coverage).
    links: [
      { label: 'Events', url: 'https://www.nvidia.com/en-us/events/' },
      { label: 'Webinars', url: 'https://www.nvidia.com/en-us/about-nvidia/webinar-portal/' },
    ],
    feeds: {
      news: { adapter: 'rss', url: 'https://nvidianews.nvidia.com/rss.xml', label: 'Newsroom' },
      blog: { adapter: 'rss', url: 'https://blogs.nvidia.com/feed/' },
      research: { adapter: 'rss', url: 'https://developer.nvidia.com/blog/feed/', label: 'Dev Blog' },
      general: { adapter: 'rss', url: 'https://feeds.megaphone.fm/nvidiaaipodcast', label: 'AI Podcast' },
    },
    intelDocs: [
      { section: 'financial_brief', title: 'Financial brief (paste Bloomberg/Morningstar seed)', url: 'https://investor.nvidia.com/', seedable: false },
    ],
  },
  {
    key: 'google',
    label: 'Gemini', // the CRM company row (and UAV's posting label) is "Gemini", not "Google"
    profile: 'public',
    homeUrl: 'https://ai.google',
    appLimit: { max: 3, windowDays: 30 },
    feeds: {
      blog: { adapter: 'rss', url: 'https://blog.google/technology/ai/rss/' },
      news: { adapter: 'rss', url: 'https://news.google.com/rss/search?q=%22Google%22%20AI%20when%3A14d&hl=en-US&gl=US&ceid=US:en' },
      financial: { adapter: 'html', url: 'https://abc.xyz/investor/', item: 'a[href*="earnings"], a[href$=".pdf"]' },
    },
    intelDocs: [
      { section: 'financial_brief', title: 'Financial brief (paste Bloomberg/Morningstar seed)', url: 'https://abc.xyz/investor/', seedable: false },
    ],
  },

  // --- Smaller wildcard ----------------------------------------------------
  {
    key: 'arize',
    label: 'Arize',
    profile: 'private',
    homeUrl: 'https://arize.com',
    feeds: {
      blog: { adapter: 'html', url: 'https://arize.com/blog/', item: 'a[href*="/blog/"]' },
      news: { adapter: 'html', url: 'https://arize.com/press/', item: 'a[href*="/press/"]' },
    },
    intelDocs: [],
  },
];

export const KINDS = ['news', 'blog', 'event', 'financial', 'research', 'general'];

export const getSource = (key) => SOURCES.find((s) => s.key === key);

// Every feed as a flat list of {source, kind, feed} — the unit the tracker iterates.
export function allFeeds(sources = SOURCES) {
  const out = [];
  for (const source of sources) {
    for (const [kind, feed] of Object.entries(source.feeds || {})) {
      out.push({ source, kind, feed });
    }
  }
  return out;
}
