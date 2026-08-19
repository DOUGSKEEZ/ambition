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
//   fiscal     optional fiscal-calendar rules (see src/fiscal.js) — sales-team deadline intel,
//              public or not. Omitted → assumed calendar year (Dec 31 FY, confirmed:false); only
//              declare it where the calendar is known/non-default (NVIDIA, Google, Palantir,
//              Databricks). `confirmed:true` = publicly documented, not our assumption.
//   category   market-map bucket, one of CATEGORIES below — drives the dashboard grouping/filtering
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
    category: 'labs',
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
    category: 'labs',
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
    category: 'labs',
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
    category: 'silicon',
    profile: 'public',
    homeUrl: 'https://www.nvidia.com',
    // 52/53-week fiscal year ending the LAST SUNDAY of January, named for the year it ends in
    // (FY2027 ends Jan 2027); quarters close late Apr / Jul / Oct / Jan.
    fiscal: { pattern: 'last-sunday', fyEndMonth: 1, confirmed: true },
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
    category: 'hyperscaler',
    profile: 'public',
    homeUrl: 'https://gemini.google',
    fiscal: { fyEndMonth: 12, fyEndDay: 31, confirmed: true }, // Alphabet: calendar year
    appLimit: { max: 3, windowDays: 30 },
    // Doug's source map (2026-07-02): the Gemini product category on blog.google (real RSS at
    // <category>/rss/) + the Google Cloud blog (cloudblog.withgoogle.com/rss/ — carries the
    // Gemini Enterprise / GTM stories). gemini.google/latest-news and the "What's new with Google
    // Cloud" roundup are JS-rendered single pages → link-outs. news stays the Google-News search
    // (3rd-party coverage). abc.xyz (Alphabet IR) 403s non-browsers → no financial feed; the
    // financial_brief intel section covers it manually.
    links: [
      { label: 'Latest news', url: 'https://gemini.google/latest-news/' },
      { label: "What's new (Cloud)", url: 'https://cloud.google.com/blog/topics/inside-google-cloud/whats-new-google-cloud' },
    ],
    feeds: {
      news: {
        adapter: 'rss', url: 'https://news.google.com/rss/search?q=%22Google%22%20AI%20when%3A14d&hl=en-US&gl=US&ceid=US:en',
        label: 'In the News',
      },
      blog: {
        adapter: 'rss', url: 'https://blog.google/products-and-platforms/products/gemini/rss/', label: 'Gemini Blog',
      },
      general: {
        adapter: 'rss', url: 'https://cloudblog.withgoogle.com/rss/', label: 'Cloud Blog',
      },
    },
    intelDocs: [
      { section: 'financial_brief', title: 'Financial brief (paste Bloomberg/Morningstar seed)', url: 'https://abc.xyz/investor/', seedable: false },
    ],
  },
  {
    key: 'palantir',
    label: 'Palantir', // matches the CRM company row + UAV's posting label
    category: 'infra',
    profile: 'public',
    homeUrl: 'https://www.palantir.com',
    fiscal: { fyEndMonth: 12, fyEndDay: 31, confirmed: true }, // calendar year (10-K)
    // Source sweep 2026-07-05: the blog is Medium-hosted → real RSS at blog.palantir.com/feed (the
    // one first-party feed; ~monthly cadence). The newsroom is Next.js with its items locked inside
    // the __NEXT_DATA__ Contentful JSON — no anchors in the rendered HTML for the html adapter —
    // and investors.palantir.com is a JS shell whose Q4-style RSS paths all bounce back to the SPA
    // shell. So newsroom + IR are link-outs and financial_brief stays a manual paste (the
    // NVIDIA/Google pattern). No public events program to track.
    links: [
      { label: 'Newsroom', url: 'https://www.palantir.com/newsroom/' },
      { label: 'Investor relations', url: 'https://investors.palantir.com/' },
    ],
    feeds: {
      // 3rd-party coverage. PLTR is a retail-investor magnet — the minus-terms cut the worst of the
      // stock-picker listicle spam (Motley Fool / Zacks / "stocks to buy"); some analyst noise still
      // gets through (publisher names like Seeking Alpha aren't searchable body text).
      news: {
        adapter: 'rss', url: 'https://news.google.com/rss/search?q=%22Palantir%22%20-%22price%20target%22%20-%22stock%20prediction%22%20-Zacks%20-%22Motley%20Fool%22%20-%22stocks%20to%20buy%22%20when%3A14d&hl=en-US&gl=US&ceid=US:en',
        label: 'In the News',
      },
      blog: { adapter: 'rss', url: 'https://blog.palantir.com/feed' },
    },
    intelDocs: [
      { section: 'financial_brief', title: 'Financial brief (paste Bloomberg/Morningstar seed)', url: 'https://investors.palantir.com/', seedable: false },
      { section: 'mission', title: 'About', url: 'https://www.palantir.com/about/', seedable: false },
    ],
  },

  {
    key: 'mistral',
    label: 'Mistral', // matches the CRM company row + UAV's posting label
    category: 'labs',
    profile: 'private',
    homeUrl: 'https://mistral.ai',
    // Lean like the company: one advertised RSS feed (rel=alternate on /news) covering all their
    // posts; the /news page itself is JS-rendered, so the feed is also the better source.
    feeds: {
      news: { adapter: 'rss', url: 'https://mistral.ai/rss.xml' },
    },
    intelDocs: [],
  },

  {
    key: 'xai',
    label: 'xAI', // matches the CRM company row + UAV's posting label
    category: 'labs',
    profile: 'private',
    homeUrl: 'https://x.ai',
    // x.ai runs a Cloudflare JS challenge — every path (news, blog, rss.xml) 403s non-browser
    // clients even with full browser headers, so there is NO fetchable first-party feed. Coverage
    // comes from a Google-News search (which also picks up x.ai's own posts); the site link-out
    // works fine in a real browser.
    links: [{ label: 'News (x.ai)', url: 'https://x.ai/news' }],
    feeds: {
      // NOTE: XAI is also a NYSE ticker (XAI Octagon / Madison funds) — the minus-terms keep the
      // fund-dividend noise out of the feed.
      news: {
        adapter: 'rss', url: 'https://news.google.com/rss/search?q=(%22xAI%22%20OR%20%22Grok%22)%20-%22Income%20Fund%22%20-Octagon%20-%22XAI%20Madison%22%20when%3A14d&hl=en-US&gl=US&ceid=US:en',
        label: 'In the News',
      },
    },
    intelDocs: [],
  },

  {
    key: 'scale',
    label: 'Scale', // matches the CRM company row + UAV's posting label
    category: 'infra',
    profile: 'private',
    homeUrl: 'https://scale.com',
    // Source sweep 2026-07-03: NO first-party RSS anywhere (/blog/rss.xml just 302s back to /blog).
    // scale.com is Next.js/Sanity but SSRs real content, so blog + events parse with the html
    // adapter. Research lives at labs.scale.com/papers — fully client-rendered → link-out.
    links: [{ label: 'Papers (labs)', url: 'https://labs.scale.com/papers' }],
    feeds: {
      // 3rd-party coverage via Google-News search (the xAI pattern). "Scale AI" alone is hopeless —
      // it matches the verb phrase ("…partners to scale AI…") and the entire rack-scale-AI hardware
      // beat (intitle: variant tested even worse). Entity-anchored phrases ("Scale AI's" / "Scale AI
      // Inc" / "Scale AI CEO" / "startup Scale AI") are sparse-but-precise; some Meta/Wang bleed
      // remains from body-text possessives (Wang left Scale for Meta in 2025 — his news is NOT ours).
      news: {
        adapter: 'rss', url: 'https://news.google.com/rss/search?q=%22Scale%20AI%27s%22%20OR%20%22Scale%20AI%20Inc%22%20OR%20%22Scale%20AI%20CEO%22%20OR%20%22startup%20Scale%20AI%22%20when%3A14d&hl=en-US&gl=US&ceid=US:en',
        label: 'In the News',
      },
      // Blog tiles carry ONLY a title (h3 inside a.BlogPreviewTile) — no date/excerpt in the card,
      // so posts are undated (first-seen ordering, like Cursor's changelog). The landing page SSRs
      // just the ~5 featured tiles; new posts rotate through as they're featured.
      blog: {
        adapter: 'html', url: 'https://scale.com/blog', item: 'a[class*="BlogPreviewTile"]',
        title: 'h3',
      },
      // Event cards (internal /events/* AND external conference links share the same card class —
      // the rounded-[28px] hook is the one distinctive hook). Category ("Conference") and date are
      // IDENTICAL sibling spans, so date = last-child of the .flex-wrap row; the category span
      // doubles as the location chip (Scale lists no venue), like Anthropic's In-person/Virtual.
      event: {
        adapter: 'html', url: 'https://scale.com/events', item: 'a[class*="rounded-[28px]"]',
        title: 'h3', summary: 'p', eventDates: true,
        date: '[class*="flex-wrap"] > span:last-child', location: '[class*="flex-wrap"] > span:first-child',
      },
    },
    intelDocs: [],
  },

  {
    key: 'databricks',
    label: 'Databricks', // matches the CRM company row + UAV's posting label
    category: 'infra',
    profile: 'private',
    homeUrl: 'https://www.databricks.com',
    // Private but publicly reports on a Salesforce-style FY ending Jan 31 (named for the ending
    // year); quarters close Apr 30 / Jul 31 / Oct 31 / Jan 31.
    fiscal: { fyEndMonth: 1, fyEndDay: 31, confirmed: true },
    // Source sweep 2026-07-05: the site is Gatsby and everything editorial (newsroom, the
    // press-release index, the events grid) is client-rendered — no content in server HTML — so
    // none of it parses. What IS real: the blog RSS at /feed (also served at /blog/feed.xml),
    // dated + multi-category like OpenAI's. First-party news therefore comes via Google News
    // ("Databricks" is unambiguous and high-volume: ~90 hits/14d, incl. their own posts); events
    // are link-outs (Data + AI Summit is the flagship).
    links: [
      { label: 'Events', url: 'https://www.databricks.com/events' },
      { label: 'Data + AI Summit', url: 'https://www.databricks.com/dataaisummit' },
    ],
    feeds: {
      news: {
        adapter: 'rss', url: 'https://news.google.com/rss/search?q=%22Databricks%22%20when%3A14d&hl=en-US&gl=US&ceid=US:en',
        label: 'In the News',
      },
      // One RSS, two buckets (the OpenAI pattern): the technical categories vs everything else
      // (Platform/Product launches, Industries, Data Strategy thought-leadership, Company news).
      blog: {
        adapter: 'rss', url: 'https://www.databricks.com/feed', label: 'Eng & Research',
        categories: ['Engineering', 'Mosaic Research', 'Data Science and ML', 'Databricks AI'],
      },
      general: {
        adapter: 'rss', url: 'https://www.databricks.com/feed', label: 'Blog (Other)',
        excludeCategories: ['Engineering', 'Mosaic Research', 'Data Science and ML', 'Databricks AI'],
      },
    },
    intelDocs: [
      { section: 'mission', title: 'About', url: 'https://www.databricks.com/company/about', seedable: false },
    ],
  },

  // --- Smaller wildcard ----------------------------------------------------
  {
    key: 'arize',
    label: 'Arize',
    category: 'infra',
    profile: 'private',
    homeUrl: 'https://arize.com',
    // WordPress site: the blog has a real (unadvertised) feed at /feed/. Press has no feed
    // (/press/feed/ 404s) — HTML cards: h3 title + a text-content-secondary date span.
    feeds: {
      blog: { adapter: 'rss', url: 'https://arize.com/feed/' },
      news: {
        adapter: 'html', url: 'https://arize.com/press/', item: 'a[href*="/press/"]', label: 'Press',
        title: 'h3', date: 'span[class*="text-content-secondary"]',
      },
    },
    intelDocs: [],
  },

  {
    key: 'kindo',
    label: 'Kindo', // matches the CRM company row
    category: 'infra',
    profile: 'private',
    homeUrl: 'https://www.kindo.ai',
    // Source sweep 2026-07-05: Webflow site, NO RSS anywhere (all the usual paths 404; the only
    // feed-typed URL is sitemap.xml). /dev/blog is an empty stub (sitemap shows only /dev/test),
    // so the blog + the HubSpot events page (go.kindo.ai — SSRs real cards) are the two sources.
    links: [{ label: 'Videos', url: 'https://www.kindo.ai/resources-categories/video-library' }],
    feeds: {
      // 3rd-party coverage: bare "Kindo" is hopeless — it's a Burkinabé surname AND an NZ
      // school-payments brand. Entity-anchored terms are sparse-but-precise (WhiteRabbitNeo, their
      // open cyber-model, carries most of the coverage). 90d window instead of the house-style 14d:
      // at ~2 hits per half-year a 14d feed would sit permanently empty.
      news: {
        adapter: 'rss', url: 'https://news.google.com/rss/search?q=%22Kindo%20AI%22%20OR%20%22kindo.ai%22%20OR%20%22WhiteRabbitNeo%22%20when%3A90d&hl=en-US&gl=US&ceid=US:en',
        label: 'In the News',
      },
      // Cards carry NO date (undated first-seen ordering, like Scale's blog). The title lives in a
      // <div class="blog-card_text heading-style-h3"> — a div, not a real h3, so the adapter's
      // heading fallback would miss it and mash the whole card text: explicit title required.
      // Scoped to .blog-gallery_list to skip the hero gallery's repeats (href dedup would drop them
      // anyway, but the hero also holds w-condition-invisible ghosts). Some cards link out to
      // go.kindo.ai gated guides — those are real content, kept.
      blog: {
        adapter: 'html', url: 'https://www.kindo.ai/blog', item: '.blog-gallery_list .blog-card',
        title: '.blog-card_text',
      },
      // HubSpot event grid: the whole card is one <a>. Date is a range string ("August 1-6, 2026")
      // Date.parse can't read → events land undated; the location chip is the first
      // .event-grid-location (the inner flip-card reuses that class for the DATE — .first() saves us).
      event: {
        adapter: 'html', url: 'https://go.kindo.ai/events', item: 'a.event-grid-layout-card-link',
        title: '.event-grid-title', date: '.event-grid-date', location: '.event-grid-location',
        eventDates: true,
      },
    },
    intelDocs: [
      { section: 'mission', title: 'Company', url: 'https://www.kindo.ai/company', seedable: true },
    ],
  },

  // --- Added 2026-07-08 (alongside their UAV sources) -----------------------
  {
    key: 'perplexity',
    label: 'Perplexity', // matches the CRM company row + UAV's posting label
    category: 'apps',
    profile: 'private',
    homeUrl: 'https://www.perplexity.ai',
    // Source sweep 2026-07-08: perplexity.ai runs a Cloudflare challenge — every path (hub, blog,
    // rss) 403s non-browser clients even with browser headers (the xAI pattern), so there is NO
    // fetchable first-party feed. Coverage comes from an entity-anchored Google News search (bare
    // "perplexity" is an LLM metric and a common noun); the hub link-out works in a real browser.
    links: [{ label: 'Hub (blog/news)', url: 'https://www.perplexity.ai/hub' }],
    feeds: {
      news: {
        adapter: 'rss', url: 'https://news.google.com/rss/search?q=%22Perplexity%20AI%22%20OR%20%22Aravind%20Srinivas%22%20OR%20%22Perplexity%27s%22%20when%3A14d&hl=en-US&gl=US&ceid=US:en',
        label: 'In the News',
      },
    },
    intelDocs: [],
  },
  {
    key: 'togetherai',
    label: 'Together AI', // matches the CRM company row + UAV's posting label
    category: 'infra',
    profile: 'private',
    homeUrl: 'https://www.together.ai',
    // Source sweep 2026-07-08: Webflow site with one real first-party feed at /blog/rss.xml
    // (announcements + research + eng together, the Mistral pattern — no categories to split on).
    // Press coverage is sparse and funding-round-shaped, so news is an entity-anchored Google News
    // search on a 90d window (the Kindo pattern; "Together AI" bare matches "…bring together AI…").
    feeds: {
      news: {
        adapter: 'rss', url: 'https://news.google.com/rss/search?q=%22Together%20AI%27s%22%20OR%20%22Together%20AI%20CEO%22%20OR%20%22startup%20Together%20AI%22%20OR%20%22Together%20AI%20announced%22%20OR%20%22Together%20AI%20raise%22%20when%3A90d&hl=en-US&gl=US&ceid=US:en',
        label: 'In the News',
      },
      blog: { adapter: 'rss', url: 'https://www.together.ai/blog/rss.xml' },
    },
    intelDocs: [],
  },
  {
    key: 'notion',
    label: 'Notion', // matches the CRM company row + UAV's posting label
    category: 'apps',
    profile: 'private',
    homeUrl: 'https://www.notion.com',
    // Source sweep 2026-07-08: NO RSS anywhere (/rss.xml 307s to an app.notion.com "File not found";
    // the blog advertises no rel=alternate). But notion.com is Next.js that SSRs real content:
    //  - blog cards are article.post-preview — h3 title; the post link needs :not() because every
    //    card also carries a /blog/topic/* chip that would win the default first-<a> rule; cards
    //    show no date (undated first-seen ordering, like Scale's blog) and their only <p> is the
    //    author byline, so no summary selector.
    //  - /releases ("What's New") is one <article class=release_*> per release with a real <time> —
    //    the changelog-as-general feed (Cursor pattern). Strategically load-bearing: Notion 3.x
    //    releases ARE the AI-agents pivot story.
    // News is an entity-anchored Google News search ("notion" alone is a common noun).
    feeds: {
      news: {
        adapter: 'rss', url: 'https://news.google.com/rss/search?q=%22Notion%20AI%22%20OR%20%22Notion%20Labs%22%20OR%20%22Notion%20app%22%20OR%20%22Notion%20Agents%22%20when%3A14d&hl=en-US&gl=US&ceid=US:en',
        label: 'In the News',
      },
      blog: {
        adapter: 'html', url: 'https://www.notion.com/blog', item: 'article.post-preview',
        title: 'h3', link: 'a[href^="/blog/"]:not([href*="/blog/topic"])',
      },
      general: {
        adapter: 'html', url: 'https://www.notion.com/releases', item: 'article[class*="release_release"]',
        title: '[class*="release_title"]', date: 'time', label: "What's New",
      },
    },
    intelDocs: [
      { section: 'mission', title: 'About', url: 'https://www.notion.com/about', seedable: false },
    ],
  },
];

export const KINDS = ['news', 'blog', 'event', 'financial', 'research', 'general'];

// Market-map buckets, in dashboard display order. Colors live in styles.css keyed by slug
// (.cat-<key>), mirroring the .fk.<kind> / .badge.<profile> class-per-type pattern.
export const CATEGORIES = [
  { key: 'labs',        label: 'Foundational Model Labs',        short: 'Labs' },
  { key: 'hyperscaler', label: 'Hyperscaler AI',                 short: 'Hyperscaler' },
  { key: 'silicon',     label: 'Silicon / Accelerated Compute',  short: 'Silicon' },
  { key: 'infra',       label: 'AI Infra & Observability',       short: 'Infra' },
  { key: 'apps',        label: 'AI Applications',                short: 'Apps' },
];

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
