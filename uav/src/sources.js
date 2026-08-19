// Config-driven job-board sources. Each entry = one company's board (via a provider adapter) +
// the filter rules that decide which postings land on the radar. Filtering runs on the NORMALIZED
// job (see tracker.matchesFilter), so the same rule shapes work across providers:
//
//   titleContains: [..]   case-insensitive substring; passes if the title contains ANY of them
//   requireGroups: [{type?, id?, name?}]   each entry must match at least one of the job's groups
//                          (AND across entries). Match by `id` when given (exact), else by `name`
//                          (case-insensitive substring); `type` optionally scopes which groups count.
//
// Adding a company is a config append — no code change. (Provider must exist in providers/index.js.)
export const SOURCES = [
  {
    key: 'anthropic',
    label: 'Anthropic',
    careersUrl: 'https://job-boards.greenhouse.io/anthropic',
    provider: 'greenhouse',
    endpoint: 'https://boards-api.greenhouse.io/v1/boards/anthropic/jobs?content=true',
    // Account Executive roles in Sales (dept 4002062008) based anywhere in the US — Doug targets AE
    // titles, not the rest of the Sales org (Customer Success, Sales Ops, etc.). Greenhouse offices
    // carry no country, and the ", CA" suffix is ambiguous (San Francisco CA = California, but
    // "Ontario, CA"/"British Columbia, CA" = Canada), so we match an explicit list of US office
    // NAMES (substring) rather than a suffix. Office name (org tag) also catches US-available roles
    // whose office is tagged in one city, e.g. "Enterprise Account Executive, Tech" (NYC office,
    // location lists SF). Add a city here (e.g. 'Austin') if Anthropic opens a new US office.
    filter: {
      titleContains: ['Account Executive'],
      requireGroups: [
        { type: 'department', id: 4002062008 }, // Sales
        { type: 'office', name: ['San Francisco', 'New York', 'Boston', 'Seattle', 'Washington', 'Remote-Friendly US'] },
      ],
    },
  },
  {
    key: 'openai',
    label: 'OpenAI',
    careersUrl: 'https://openai.com/careers/search/',
    provider: 'ashby',
    board: 'openai',
    // OpenAI (Ashby) has NO "Account Executive" titles — their AE-equivalent is "Account Director".
    // We match by TITLE rather than the `team` field: every Account Director sits in the "Go To
    // Market" department, but the finer `team` is tagged inconsistently ("Sales" on most, "Go To
    // Market" on some — e.g. Manufacturing/Insurance), so a team:Sales filter silently drops the
    // mis-tagged ones. Title-based catches them all. Scope to the US via the country group (drops
    // Tokyo/London/Seoul/etc.); city is left open so SF + NYC + Seattle + DC roles all show.
    filter: {
      titleContains: ['Account Director'],
      requireGroups: [
        { type: 'country', name: 'United States' },
      ],
    },
    // OpenAI caps applications at 5 per rolling 180-day window. The header quota badge counts the
    // applied/reapplied events in that window (see GET /api/quota).
    appLimit: { max: 5, windowDays: 180 },
  },
  {
    key: 'cursor',
    label: 'Cursor',
    careersUrl: 'https://cursor.com/careers',
    provider: 'ashby',
    board: 'cursor',
    // Cursor embeds the Ashby board on its own page; the hosted jobs.ashbyhq.com/cursor/<id> URL is
    // a dead shell. Real postings live at cursor.com/careers/<title-slug> — the adapter builds that
    // (appending location for duplicate titles, as Cursor's own page does).
    jobUrlBase: 'https://cursor.com/careers',
    // Cursor (Anysphere) publishes on Ashby (https://cursor.com/careers). Account Executive titles
    // on the Sales department, anywhere in the US. We filter on `country: United States` (from the
    // Ashby adapter's address-derived country group) rather than enumerating cities, so new US
    // locations are picked up automatically and non-US roles (London/Japan/Singapore/ANZ) drop out.
    // `department: Sales` (not the finer `team` values) keeps the whole Sales org in scope.
    filter: {
      titleContains: ['Account Executive'],
      requireGroups: [
        { type: 'department', name: 'Sales' },
        { type: 'country', name: 'United States' },
      ],
    },
  },
  {
    key: 'xai',
    label: 'xAI',
    careersUrl: 'https://x.ai/careers/open-roles?dept=4059410007,4064382007,4060730007,4059410007',
    provider: 'greenhouse',
    endpoint: 'https://boards-api.greenhouse.io/v1/boards/xai/jobs?content=true',
    // xAI's Sales dept (4059410007) is currently ALL "Client Partner" roles — advertising sales, not
    // enterprise SaaS sales. We don't know what their enterprise-sales titles will be, so cast a wide
    // net: every Sales-dept role MINUS "Client Partner". Marketing (4060730007) is excluded simply by
    // not including its department. 4064382007 is the (currently empty) extra dept from the careers URL,
    // kept so a future sales sub-dept role surfaces too. No location filter — widest net by design.
    filter: {
      requireGroups: [
        { type: 'department', id: [4059410007, 4064382007] },
      ],
      titleExcludes: ['Client Partner'],
    },
  },
  {
    key: 'gemini',
    label: 'Gemini', // matches the Sniper company "Gemini" so Send-to-SpecOps resolves the company
    careersUrl: 'https://www.google.com/about/careers/applications/jobs/results/?e=72477625&q=%22AI%20Sales%20Specialist%22&location=New%20York%2C%20NY%2C%20USA&location=San%20Francisco%2C%20CA%2C%20USA&location=Los%20Angeles%2C%20CA%2C%20USA',
    provider: 'google',
    // Google has no JSON board — the `google` adapter parses the SSR careers results page (FRAGILE).
    // The endpoint bakes in the `q` keyword (Google filters that server-side); the title is "AI Sales
    // Specialist" at Google (Google Cloud). Location scoping (NY/SF/LA, per Doug's URL) is done here
    // client-side against the normalized location groups, consistent with the other sources.
    endpoint: 'https://www.google.com/about/careers/applications/jobs/results/?q=%22AI%20Sales%20Specialist%22',
    filter: {
      titleContains: ['AI Sales Specialist'],
      requireGroups: [
        { type: 'location', name: ['New York', 'San Francisco', 'Los Angeles'] },
      ],
    },
    // Google caps applications at 3 per rolling 30-day window (see GET /api/quota).
    appLimit: { max: 3, windowDays: 30 },
  },
  {
    key: 'arize',
    label: 'Arize', // matches the Sniper company "Arize" so Send-to-SpecOps resolves the company
    careersUrl: 'https://arize.com/careers/',
    provider: 'greenhouse',
    endpoint: 'https://boards-api.greenhouse.io/v1/boards/arizeai/jobs?content=true',
    // Arize Sales roles, US office only (Arize uses region-level offices US / EMEA / APJ, so this drops
    // the EMEA/APJ/ANZ roles). Two tiers: "Director" (aiming up — e.g. "Director, Digital Native
    // Sales") AND "Enterprise Account Executive". Sales dept (4026251004) scopes out Sales Engineering.
    filter: {
      titleContains: ['Director', 'Enterprise Account Executive'],
      requireGroups: [
        { type: 'department', id: 4026251004 }, // Sales
        { type: 'office', name: 'US' },
      ],
    },
  },
  {
    key: 'kindo',
    label: 'Kindo', // matches the Sniper company "Kindo" so Send-to-SpecOps resolves it
    careersUrl: 'https://jobs.ashbyhq.com/kindo',
    provider: 'ashby',
    board: 'kindo',
    // Early-stage (Venice, CA). No sales roles posted yet (board is just Engineering), so cast a WIDE
    // sales net by title — "Account Executive" or any "Sales" role (Head of Sales, Sales Lead, …) —
    // with no location filter (US startup; Ashby returns no country here). Tune once real roles appear.
    filter: {
      titleContains: ['Account Executive', 'Sales'],
    },
  },
  {
    key: 'mistral',
    label: 'Mistral', // matches the Sniper company "Mistral" so Send-to-SpecOps resolves it
    careersUrl: 'https://jobs.lever.co/mistral',
    provider: 'lever',
    board: 'mistral',
    // Mistral (Lever) "Account Executive" roles in the US. Lever has no numeric ids and leaves the
    // department empty here (team = "Business"), so we scope by TITLE + the ISO-2 `country` group
    // ("US"). Country (not city) because the SF role is tagged location "Palo Alto" and a future US
    // city would otherwise be missed; this drops the FR/DE/UK enterprise-AE roles. Currently matches
    // "Account Executive, Enterprise - New York" and "...- SF Bay Area".
    filter: {
      titleContains: ['Account Executive'],
      requireGroups: [
        { type: 'country', name: 'US' },
      ],
    },
  },
  {
    key: 'databricks',
    label: 'Databricks', // matches the Sniper company "Databricks" so Send-to-SpecOps resolves it
    careersUrl: 'https://www.databricks.com/company/careers/open-positions?department=Sales&location=USCA',
    provider: 'greenhouse',
    endpoint: 'https://boards-api.greenhouse.io/v1/boards/databricks/jobs?content=true',
    // Databricks has ~67 wildly-varied AE titles (Enterprise / Core / Geo / Strategic / Named / Hunter
    // / Emerging ...) — all contain "Account Executive", so the title net is simple. Scoping to US+CA
    // is the hard part: Greenhouse offices carry no country, so we EXCLUDE the international office
    // names rather than enumerate every US state (which would miss new ones). Collision-safe patterns:
    // '- Mexico' (not 'Mexico', which would hit New Mexico) and ', India' (not 'India' → Indiana).
    // Canada is kept — the careers URL is USCA = US + Canada.
    filter: {
      titleContains: ['Account Executive'],
      excludeGroups: [
        { type: 'office', name: [
          'Japan', 'United Kingdom', 'Germany', 'Singapore', 'Australia', 'Sweden', 'France',
          'Netherlands', 'Brazil', 'Korea', 'Saudi', 'Denmark', 'Qatar', 'United Arab Emirates',
          'Dubai', 'Philippines', 'Benelux', 'Nordics', 'EMEA', 'APAC', 'APJ', 'New Zealand', 'Spain',
          'Italy', 'Ireland', 'Switzerland', 'Belgium', 'Norway', 'Finland', 'Poland', 'Israel',
          'China', 'Hong Kong', ', India', '- Mexico',
        ] },
      ],
    },
  },
  {
    key: 'nvidia',
    label: 'NVIDIA',
    careersUrl: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',
    provider: 'workday', // first Workday source — cxs JSON API, server-side facets + pagination
    tenant: 'nvidia',
    dc: 'wd5',
    site: 'NVIDIAExternalCareerSite',
    // Scope at the API level via Workday facets, then title-match. jobFamilyGroup = the "Sales" job
    // category (282 roles globally); locationHierarchy1 = United States (148 of them) — keeps the
    // Korea/China/Germany/EMEA account-manager roles off the radar, matching every other US source.
    // The facet IDs are NVIDIA-tenant-specific opaque hashes (pulled from the board's facet list);
    // if NVIDIA ever re-keys them the fetch returns 0 and the tracker isolates it.
    facets: {
      jobFamilyGroup: ['0c40f6bd1d8f10ae43ffcac5bbec7e90'], // Sales
      locationHierarchy1: ['2fcb99c455831013ea52fb338f2932d8'], // United States
    },
    // Doug's observed NVIDIA target patterns. "Account Manager" alone is a superset of most of these
    // (Senior/Strategic ISV/General all contain it); the rest are listed for intent + to catch
    // "Account Leader" and standalone "Sales Specialist". US Sales facet → ~10 roles today.
    filter: {
      titleContains: [
        'Account Manager', 'Senior Account Manager', 'Strategic ISV Account Manager',
        'General Account Manager', 'Account Leader', 'Sales Specialist',
      ],
    },
  },
  {
    key: 'scale',
    label: 'Scale', // matches the Sniper company "Scale" so Send-to-SpecOps resolves it
    careersUrl: 'https://scale.com/careers',
    provider: 'greenhouse',
    endpoint: 'https://boards-api.greenhouse.io/v1/boards/scaleai/jobs?content=true',
    // Scale serves postings natively at scale.com/careers/<greenhouse-id> — link there, not the
    // hosted job-boards.greenhouse.io page.
    jobUrlBase: 'https://scale.com/careers',
    // Scale splits sales across four Greenhouse departments (Enterprise / Gen AI / Physical AI /
    // GPS Sales); today's AE roles are all "Enterprise Account Executive" (+industry variants) in
    // Enterprise Sales, but scope all four so a future Gen-AI/Physical-AI AE surfaces too. The AE
    // title net deliberately drops the dept's non-closing roles (Solutions Engineer, GTM Architect,
    // Strategist, SDR, PM) — Doug's trunk is the AE closing role. Scale's offices are city-level
    // with US state suffixes plus international names (London UK / Middle East / Tijuana MX ...),
    // so require an explicit US office list (Anthropic pattern) — extend it if Scale tags sales
    // roles in another US city (Austin/Dallas/St. Louis etc. are ops hubs today).
    filter: {
      titleContains: ['Account Executive'],
      requireGroups: [
        { type: 'department', id: [4140830005, 4136574005, 4144541005, 4140828005] }, // Enterprise / Gen AI / Physical AI / GPS Sales
        { type: 'office', name: ['San Francisco', 'New York', 'Seattle', 'Washington', 'United States'] },
      ],
    },
  },
  {
    key: 'palantir',
    label: 'Palantir', // matches the Sniper company "Palantir" so Send-to-SpecOps resolves it
    careersUrl: 'https://www.palantir.com/careers/open-positions/',
    provider: 'lever',
    board: 'palantir',
    // Palantir (Lever) titles its enterprise-sales roles literally "Sales" (the careers page shows
    // "Sales (Enterprise Account Executive)" but the raw Lever `text` is just "Sales") — so an
    // 'Account Executive' title net alone would miss them. Palantir's Lever postings carry NO
    // `department` (only `team`), so scope by the `team: Sales` group + the ISO-2 `country` group
    // ("US") to drop the London/Singapore/Tokyo/etc. sales roles, then keep a wide title net
    // ('Sales' catches today's roles; 'Account Executive' future-proofs if Palantir ever adopts
    // that title). Doug's trunk is sales — this is the AE closing role, not FDE/eng.
    filter: {
      titleContains: ['Sales', 'Account Executive'],
      requireGroups: [
        { type: 'team', name: 'Sales' },
        { type: 'country', name: 'US' },
      ],
    },
  },
  {
    key: 'perplexity',
    label: 'Perplexity', // matches the Sniper company "Perplexity" so Send-to-SpecOps resolves it
    // perplexity.ai's own careers page 403s non-browser fetches; the hosted Ashby board is the
    // stable public listing (and where jobUrl links land), so the header links there too.
    careersUrl: 'https://jobs.ashbyhq.com/perplexity',
    provider: 'ashby',
    board: 'perplexity',
    // Perplexity (Ashby) titles its closing roles plainly: "Commercial Account Executive" /
    // "Enterprise Account Executive", all in department Sales (SF primary; Austin/NYC as secondary
    // locations). Title net on 'Account Executive' drops the dept's BDR role; country group scopes
    // to the US (Cursor pattern) so future international sales roles fall out automatically.
    filter: {
      titleContains: ['Account Executive'],
      requireGroups: [
        { type: 'department', name: 'Sales' },
        { type: 'country', name: 'United States' },
      ],
    },
  },
  {
    key: 'notion',
    label: 'Notion', // matches the Sniper company "Notion" so Send-to-SpecOps resolves it
    careersUrl: 'https://www.notion.com/careers',
    provider: 'ashby',
    board: 'notion',
    // Notion (Ashby) runs a large global sales org (Dublin EMEA hub, Tokyo/Seoul/Sydney APAC) —
    // the country group scopes to the US closing roles: Enterprise/Commercial/Mid-Market AE in
    // SF + NY. The AE title net also drops the Sales dept's non-closing roles (Solutions Engineer,
    // Forward Deployed Engineer GTM, partner/enablement) — Doug's trunk is the AE closing role.
    filter: {
      titleContains: ['Account Executive'],
      requireGroups: [
        { type: 'department', name: 'Sales' },
        { type: 'country', name: 'United States' },
      ],
    },
  },
  {
    key: 'ramp',
    label: 'Ramp', // matches the Sniper company "Ramp" so Send-to-SpecOps resolves it
    careersUrl: 'https://ramp.com/careers',
    provider: 'ashby',
    board: 'ramp',
    // Ramp (Ashby) publishes a real HOSTED board (jobs.ashbyhq.com/ramp/<id> resolves), so no
    // jobUrlBase — unlike Cursor's embedded shell. Their Sales department mixes closing roles with
    // Customer Success, Solutions/Technical Consulting, Channel Sales and SDR, so scope by TITLE:
    // "Account Executive" (Commercial / Mid-Market / Enterprise-Juno, plus "Manager, Account
    // Executive" aiming up) AND "Account Manager" — at Ramp the AM is a quota-carrying expansion
    // seller on a named book (Commercial / Mid-Market / Enterprise), not a support role. Drop
    // 'Account Manager' from the net if the AM postings read as post-sales rather than closing.
    // Country group scopes to the US: Ramp tags addressCountry inconsistently ('USA' on most,
    // 'United States' on the remote-first ones), so BOTH spellings are listed — 'United' alone
    // would also match the London roles' 'United Kingdom'. This drops Toronto-only and London
    // postings while keeping US roles that carry a Canadian secondary location.
    filter: {
      titleContains: ['Account Executive', 'Account Manager'],
      requireGroups: [
        { type: 'department', name: 'Sales' },
        { type: 'country', name: ['USA', 'United States'] },
      ],
    },
  },
  {
    key: 'nooks',
    label: 'Nooks', // matches the Sniper company "Nooks" so Send-to-SpecOps resolves it
    careersUrl: 'https://www.nooks.ai/careers',
    provider: 'ashby',
    board: 'nooks',
    // CAUTION: the Greenhouse board `nooks` is a DIFFERENT company (a defense/SCIF firm in Arlington
    // VA + Colorado Springs). Nooks.ai is the Ashby board — hosted, so job links resolve and no
    // jobUrlBase is needed.
    //
    // Nooks.ai files its whole go-to-market org under department "GTM" (teams: Sales / Sales
    // Development / Rev Ops), so the department alone would drag in SDRs and Rev Ops. Filter by
    // TITLE instead: "Account Executive" (Enterprise / Mid-Market / Upsell) plus "Sales Manager"
    // (frontline leadership of the AE team — aiming up, the Arize 'Director' pattern). That drops
    // team Sales' own Solutions Engineer and every SDR/BDR and Rev Ops title.
    //
    // Filtering on the team group instead would be a trap here: group names match by SUBSTRING, so
    // { type: 'team', name: 'Sales' } also matches the team "Sales Development".
    //
    // Country group scopes to the US (today only their EMEA support role falls out) so future
    // international sales roles drop automatically.
    filter: {
      titleContains: ['Account Executive', 'Sales Manager'],
      requireGroups: [
        { type: 'department', name: 'GTM' },
        { type: 'country', name: 'United States' },
      ],
    },
  },
  {
    key: 'clay',
    label: 'Clay', // matches the Sniper company "Clay" so Send-to-SpecOps resolves it
    careersUrl: 'https://www.clay.com/careers',
    provider: 'ashby',
    board: 'claylabs', // NOT 'clay' — that board token 404s; Clay Labs is the Ashby tenant
    // Clay splits go-to-market into three departments — "GTM - Sales", "GTM - Ops" and
    // "GTM - Partnerships" — so scoping to "GTM - Sales" already drops the GTM Engineers, Sales
    // Architects and Partner Managers. The title net then drops that department's own non-closing
    // roles: Solutions Engineering Manager and the ClayDR (SDR) managers. "Sales Manager (GTME)"
    // is frontline leadership of the AE team, kept for the same aiming-up reason as [[arize]]'s
    // Director net. Country group scopes to the US, dropping the London/DACH/French-speaking AEs.
    filter: {
      titleContains: ['Account Executive', 'Sales Manager'],
      requireGroups: [
        { type: 'department', name: 'GTM - Sales' },
        { type: 'country', name: 'United States' },
      ],
    },
  },
  {
    key: 'norm',
    label: 'Norm Ai', // matches the Sniper company "Norm Ai" so Send-to-SpecOps resolves it
    careersUrl: 'https://www.norm.ai/careers',
    provider: 'ashby',
    board: 'norm-ai',
    // Norm Ai has NO sales org at all today — their 13 postings are Engineering, "Norm Law"
    // (practising attorneys), Finance, InfoSec and Operations; there is no Sales department to
    // scope to. Armed-but-empty by design (the Kindo pattern): a WIDE title net — "Account
    // Executive" or any "Sales" title (Head of Sales, Sales Lead, …) — with no department or
    // location filter, so their first commercial hire surfaces the day it posts. Matches nothing
    // today, which is the expected state. Tighten once real roles appear. NYC-only company, so no
    // country filter — a location rule would only risk dropping a posting with no address.
    filter: {
      titleContains: ['Account Executive', 'Sales'],
    },
  },
  {
    key: 'datadog',
    label: 'Datadog', // matches the Sniper company "Datadog" so Send-to-SpecOps resolves it
    careersUrl: 'https://careers.datadoghq.com/all-departments/',
    provider: 'greenhouse',
    endpoint: 'https://boards-api.greenhouse.io/v1/boards/datadog/jobs?content=true',
    // Datadog is the biggest board on the radar (441 postings), so both halves of this filter matter.
    //
    // TITLE: an 'Account Executive' net alone would MISS a third of their closing roles — Datadog
    // calls its enterprise sellers "Enterprise Sales Executive" (incl. the FED/SLED public-sector
    // variants), the OpenAI "Account Director" lesson again. 'Accounts Executive' (plural) is its
    // own entry because "Key Accounts Executive" does not contain "Account Executive".
    // 'Sales Specialist' picks up the Enterprise Security overlay sellers — the same quota-carrying
    // specialist shape as the Gemini/NVIDIA sources. Deliberately NOT matched: the department's
    // sales LEADERSHIP (Area Vice President / "Director, Enterprise Sales" / "Manager, Mid-Market
    // Sales") — at Datadog's scale those are second-line org roles, unlike the frontline player-coach
    // "Sales Manager" kept at [[clay]]/nooks. Add 'Director,' + 'Manager,' to the net to include them.
    //
    // LOCATION: three sales departments (Enterprise / Commercial / Mid-Market). Greenhouse offices
    // carry no country, so we EXCLUDE international office names rather than enumerate US states —
    // Datadog posts most US roles as "Remote - <State>", which an inclusion list would have to chase
    // forever. Collision-safe prefixed patterns: '- UK' (bare 'UK' hits Milwaukee), '- Mexico' (not
    // 'Mexico', which would hit a future New Mexico) and '- Ontario' (Ontario, CA is a US city).
    // 'Georgia' is deliberately ABSENT — "Remote - Georgia" is the US state, and Datadog has no
    // office in the country of Georgia. Canada ('- Ontario'/'- Quebec') is excluded: US-only scope,
    // unlike the USCA Databricks source. Verified both ways — no US role carries an international
    // office, and no excluded role is US-based.
    filter: {
      titleContains: [
        'Account Executive', 'Sales Executive', 'Accounts Executive', 'Account Manager',
        'Sales Specialist',
      ],
      requireGroups: [
        { type: 'department', id: [72277, 72275, 146694] }, // Enterprise / Commercial / Mid-Market Sales
      ],
      excludeGroups: [
        { type: 'office', name: [
          'Amsterdam', 'Austria', 'Bangalore', 'Copenhagen', 'Dubai', 'Dublin', 'Jakarta', 'London',
          'Madrid', 'Mexico City', 'Paris', 'Poland', 'Riyadh', 'Sao Paulo', 'Seoul', 'Singapore',
          'Stockholm', 'Sydney', 'Tel Aviv', 'Tokyo', 'Australia', 'Brazil', 'Chile', 'Denmark',
          'Germany', 'Indonesia', 'Italy', 'Saudi Arabia', 'Spain', 'Switzerland',
          '- UK', '- Mexico', '- Ontario', '- Quebec',
        ] },
      ],
    },
  },
  {
    key: 'togetherai',
    label: 'Together AI', // matches the Sniper company "Together AI" so Send-to-SpecOps resolves it
    careersUrl: 'https://www.together.ai/careers',
    provider: 'greenhouse',
    endpoint: 'https://boards-api.greenhouse.io/v1/boards/togetherai/jobs?content=true',
    // Together AI (Greenhouse) has NO AE roles yet — their Sales department currently holds a
    // single partnerships-leadership role. This source is armed-but-mostly-empty by design (xAI
    // pattern): scope the whole Sales dept with no title net, so their first real AE postings
    // surface the day they open the department up. Tighten with titleContains/titleExcludes once
    // we see what they call their closing roles. No location filter — SF-only company today.
    filter: {
      requireGroups: [
        { type: 'department', id: 4049151007 }, // Sales
      ],
    },
  },
];

export function getSource(key) {
  return SOURCES.find((s) => s.key === key) || null;
}

// Days to wait before RE-applying to a role at this company. An explicit `reapplyCooldownDays` on
// the source wins; otherwise a quota-capped company's appLimit window doubles as its cooldown
// (OpenAI 180d, Google 30d — they won't take another application inside the window anyway).
// null = no company rule; the global REAPPLY_SOFT/HARD cadence applies.
export function reapplyCooldownDays(source) {
  return source?.reapplyCooldownDays ?? source?.appLimit?.windowDays ?? null;
}
