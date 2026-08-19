// Fiscal-calendar math: where each company sits in ITS fiscal year, so the SITREP/cards can show
// the last + next quarter end — sales-team deadline intel (end-of-quarter crunch, budget flush,
// FY-start headcount) regardless of whether the company is public.
//
// Config lives on each source as `fiscal` (see sources.js). Shapes:
//   { fyEndMonth, fyEndDay, confirmed }        FY ends on a fixed month/day (1-based month)
//   { pattern: 'last-sunday', fyEndMonth, confirmed }
//                                              52/53-week retail-style calendar: quarters end on the
//                                              LAST SUNDAY of the quarter-boundary months (NVIDIA)
// No config → DEFAULT_FISCAL: calendar year, confirmed:false ("assumed" — private companies rarely
// disclose; calendar year is the overwhelming default). FY label = the calendar year the FY ends in
// (Salesforce/Databricks convention: FY ending Jan 2027 is "FY2027" — matches NVIDIA's naming too).
//
// Everything is pure date math on UTC-noon-free date-only values — no DB, no config mutation.

export const DEFAULT_FISCAL = { fyEndMonth: 12, fyEndDay: 31, confirmed: false };

const DAY_MS = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
// last calendar day of 1-based month m (Date.UTC month index m, day 0 = last day of month m)
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// The quarter-end date in 1-based month m of year y under the given fiscal rules.
function quarterEndDate(y, m, f) {
  const last = new Date(Date.UTC(y, m, 0));
  if (f.pattern === 'last-sunday') {
    last.setUTCDate(last.getUTCDate() - last.getUTCDay()); // walk back to Sunday (getUTCDay 0)
    return last;
  }
  return new Date(Date.UTC(y, m - 1, Math.min(f.fyEndDay, daysInMonth(y, m))));
}

// Current fiscal position for one company. `now` is injectable for tests; comparisons use the LOCAL
// calendar date (an evening in Denver must not read as tomorrow via UTC).
export function fiscalInfo(fiscal, now = new Date()) {
  const f = { ...DEFAULT_FISCAL, ...(fiscal || {}) };
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  // Quarter boundaries land in fyEndMonth and every 3rd month after; enumerate a wide-enough window
  // of candidates around now and pick the neighbors of today.
  const months = [0, 3, 6, 9].map((k) => ((f.fyEndMonth - 1 + k) % 12) + 1);
  const candidates = [];
  for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 2; y++) {
    for (const m of months) candidates.push(quarterEndDate(y, m, f));
  }
  candidates.sort((a, b) => a - b);

  const next = candidates.find((d) => d >= today); // on the close date itself: "closes today"
  const lastQ = [...candidates].reverse().find((d) => d < today);
  const fyEnd = candidates.find((d) => d >= next && d.getUTCMonth() + 1 === f.fyEndMonth);

  // Which quarter the NEXT close ends: months past the FY boundary / 3 (0 → it IS the FY close, Q4)
  const offset = (((next.getUTCMonth() + 1) - f.fyEndMonth + 12) % 12) / 3;
  const quarter = offset === 0 ? 4 : offset;
  const fyLabel = fyEnd.getUTCFullYear();

  return {
    confirmed: !!f.confirmed,
    quarter,
    fyLabel,
    label: `Q${quarter} FY${fyLabel}`,
    lastQuarterEnd: iso(lastQ),
    nextQuarterEnd: iso(next),
    fyEnd: iso(fyEnd),
    daysToQuarterEnd: Math.round((next - today) / DAY_MS),
  };
}
