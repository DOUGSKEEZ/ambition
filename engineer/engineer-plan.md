# 🔧 Engineer — ideas backlog

A running list of workflow / tooling improvements for the Ambition squad. Capture friction here the
moment it shows up; promote an item to a real build when it's worth the time. No idea is too small.

Format: one bullet per idea. Optionally tag which app it touches (`[sniper]`, `[meddic]`, `[commander]`,
`[suite]`) and a rough sense of size (`quick` / `medium` / `big`). `⚠ new field` flags an idea that needs
schema the app doesn't capture yet.

---

## Analytics & tracking — brainstorm

The goal: measure both **adherence to MEDDIC** (am I qualifying, not just blasting?) and **activity health**
(am I doing the reps, and are they working?). Framed the sales way — separate the **leading indicators** I
control from the **lagging indicators** they produce. When replies are down, you fix the leading numbers.

### 1. Activity & throughput — leading indicators ("am I doing the work")

- `[meddic]` `medium` **Daily/weekly send volume** — touches sent per day and per week, with a target line.
  The volume engine's pulse; the single most controllable number.
- `[meddic]` `quick` **Channel mix** — distribution of touches across email / LinkedIn / call / text /
  voice memo / video memo. Catches over-reliance on the easy channel (LinkedIn) vs the high-signal ones (call, video).
- `[meddic]` `quick` **Consistency / streak** — days-active in the last 30, longest streak, gaps. Outreach
  rewards showing up daily; surface the cadence.
- `[sniper]` `quick` **Intake rate** — new contacts captured per week and staged→active conversion. Is the
  top of the funnel being fed?
- `[meddic]` `medium` **Queue health & backlog trend** — # due, # overdue, # going cold over time. A growing
  overdue pile means the volume target is set above sustainable capacity.

### 2. Response & effectiveness — lagging indicators ("is it working")

- `[meddic]` `medium` **Reply rate**, sliced by channel, contact type, campaign, company, and **step position**
  (does step 1 or step 3 get the bite?). The core effectiveness signal.
- `[meddic]` `medium` **Touches-to-response** — how many touches before a reply, by contact type. Tells me
  whether to lengthen or shorten sequences.
- `[meddic]` `quick` **Time-to-first-reply** — median latency from first touch to first response.
- `[meddic]` `medium` ⚠ new field **Response outcome, not just received** — today `response_received` is a
  boolean. Add positive / neutral / negative (or a small outcome enum) so reply *quality*, not just reply
  *rate*, is measurable.
- `[meddic]` `big` ⚠ new field **Conversion funnel** — contacted → replied → call booked → interview →
  onsite → offer, as ordered stages per contact/company. The lagging metric that actually matters; needs a
  stage field and a way to advance it.
- `[meddic]` `medium` **Campaign leaderboard** — which skeleton sequences earn the most replies/conversions,
  so the best ones get reused and the dead ones retired.
- `[meddic]` `medium` ⚠ new field **Draft-source A/B** — tag each sent message as local-model / Claude /
  hand-written, then compare reply rates. Answers "is the AI draft actually helping?" with data.

### 3. MEDDIC adherence & coverage — qualification quality

The point: am I *qualifying* each target company, or just collecting names? This is the spine of the
**Commander** view — a per-company scorecard plus a portfolio rollup.

- `[commander]` `big` ⚠ new field **Per-company MEDDIC scorecard** — for each target company, is each element
  present: **M**etrics (proof points attached), **E**conomic Buyer (hiring manager identified + contacted),
  **D**ecision **C**riteria (notes on what they need), **D**ecision **P**rocess (interview stages known),
  **I**dentify Pain (company need articulated), **C**hampion (at least one likely advocate). Likely a small
  status per element (unknown / in-progress / confirmed).
- `[commander]` `medium` **Coverage rollup** — % of target companies fully qualified vs partial vs untouched;
  a "weakest link" list (e.g. companies with no identified Economic Buyer, or zero champion candidates).
- `[commander]` `medium` **Depth per company** — contact count by type. A company with three recruiters but
  no hiring-manager contact is shallow; surface that imbalance.
- `[commander]` `quick` **Qualification staleness** — target companies not touched in N days, so nothing
  goes quietly cold at the company level (the Today "going cold" flag, lifted to the company tier).
- `[meddic]` `medium` **Champion candidates** — contacts who replied positively, flagged as likely internal
  advocates; the warm shortlist worth investing in.

### 4. Pipeline & relationship state

- `[meddic]` `quick` **Heat distribution & movement** — hot / warm / cold counts now and the trend (are
  contacts warming or cooling on net?).
- `[meddic]` `medium` **Aging report** — how long contacts sit in each status / heat without progress;
  catches the ones stalling silently.
- `[suite]` `medium` **Single dashboard** — one page that pulls the leading + lagging headline numbers
  together (the "morning standup" view), rather than scattering metrics across apps.

### 5. Effort & cost

- `[suite]` `quick` ⚠ new field **LLM spend** — Claude token cost per draft and per week (local is free);
  keeps the opt-in paid drafting honest against its payoff (reply rate from #2).

---

## Inbox (other ideas)

- _(add ideas here)_

## Considered

- _(ideas that have been thought through but not started)_

## Done

- _(shipped — move items here with a date and the commit, then they live in git history)_
