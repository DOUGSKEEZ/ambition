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
];

export function getSource(key) {
  return SOURCES.find((s) => s.key === key) || null;
}
