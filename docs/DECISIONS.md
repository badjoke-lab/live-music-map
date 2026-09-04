# Live Music Map — Decision Log

Append-only durable decisions. New decisions should be added with date and supersession notes rather than silently deleting prior context.

## 2026-09-03 — Product scope

Live Music Map is a discovery map for verifiable music livestreams, not a generic live-video map and not a radio directory.

## 2026-09-03 — Music-live classification

Runtime AI classification is not required. Each live/upcoming stream is classified by deterministic rules and official evidence. Ambiguous mixed-source content fails closed.

Public LIVE/Upcoming requires `music_live_status=verified`.

## 2026-09-03 — Source and Stream separation

Source-level genres, location and identity must remain separate from event/stream/performance facts. Source genre must not be copied to Stream genre. Operator/source location must not be copied to event location.

## 2026-09-03 — Normalized future entity model

Target hierarchy is:

`Source -> Event -> Stage -> Stream -> Performance <-> Artist`

Event / Stage / Performance / Artist are scheduled after the first scaling milestones unless required earlier to prevent incorrect data.

## 2026-09-03 — Historical truth

Only a verified stream actually observed in `live` state counts as an observed historical live stream. Upcoming-only records are not historical proof that the event went live.

## 2026-09-03 — Source count targets

Growth milestones are 100, 300, 600, 1,000 and 10,000 sources.

The current full-feed polling architecture is treated as an operational milestone architecture through roughly 1,000 sources, subject to measured runtime. The 10,000-source target requires push/event-driven acquisition.

## 2026-09-03 — Cost/infrastructure

Target is $0/month where practical. Cloudflare R2 is not to be used.

Normal YouTube acquisition must not use `search.list`.

## 2026-09-03 — Source expansion quality

Do not add sources merely to increase counts. Each production source requires verified official/operator identity, evidenced music-live capability, and location recorded only at supported precision.

Expansion must actively avoid US/Western-Europe-only bias.

## 2026-09-03 — Desktop detail order

Selected-source detail order is:

1. source header;
2. LIVE;
3. source/channel information;
4. Upcoming.

A long Upcoming stack must not push source information far down the page. Only a small initial Upcoming set remains expanded.

## 2026-09-03 — Theater interaction

The user-facing action is `シアター`.

Target desktop theater behavior is constrained to the center/map region so the left source list, right source details and top controls remain visible. Browser-wide takeover is not acceptable.

The current floating page-level implementation is transitional and must be replaced.

## 2026-09-03 — Theater interaction correction — supersedes prior Theater interaction entry

The previous center/map-region statement was a documentation error and is superseded by this entry.

The agreed theater behavior is the **floating page-level theater already implemented in PR #21**:

- it floats above the normal site layout;
- map, left source list, right detail and top controls remain visible and usable;
- it is draggable and resizable on desktop;
- it must not replace the center/map pane;
- it must not be constrained to the center/map region only;
- it must not become a browser-wide video-only takeover;
- closing clears the iframe source and preserves normal page context;
- mobile uses a responsive floating presentation.

This corrected entry is authoritative for theater behavior.

## 2026-09-03 — Cluster semantics

Cluster center number always means total Source count.

A LIVE-containing cluster uses a red ring/halo/pulse and explicit `LIVE n` badge. An Upcoming-only cluster uses an orange ring and `UP n` badge. Source-only cluster stays neutral gray.

Do not use a solid red/orange total-count cluster that could be read as "all n are LIVE/Upcoming".

## 2026-09-03 — Source v2 contract freeze

Source expansion from source 12 onward uses the frozen record contract in `docs/SOURCE_CONTRACT_V2.md`.

Durable rules:

- every Source carries structured official `evidence[]` for identity, official YouTube channel and music-live capability;
- Source location has both `precision` and `role`, so source base/operator base/origin/event home are not conflated;
- non-music labels such as Talk do not belong in Source music `genres[]` or music-live `formats[]`;
- duplicate Source ids, duplicate YouTube channel ids and duplicate YouTube URLs are rejected;
- the uploads playlist id must correspond to the canonical channel id;
- `scripts/validate-sources.mjs` is the executable contract and runs before acquisition and Pages deployment;
- the validator must not be weakened merely to admit more sources.

## 2026-09-03 — Title signal precedence in music-live classification

YouTube descriptions may contain boilerplate/navigation words such as `news` that do not describe the stream itself. A deny word found only outside the title must not override an explicit music-live phrase in the title.

Deterministic precedence for this conflict:

1. an explicit non-music deny signal in the **title** remains authoritative and the stream is rejected;
2. otherwise, an explicit source-specific or global music-live allow signal in the **title** may verify the stream;
3. ambiguous streams still fail closed; YouTube category alone is never enough.

This rule exists to prevent false negatives such as a title explicitly stating `DJ Set` being rejected because the description contains a generic `news` reference.

## 2026-09-03 — RSS outage fallback — acquisition reliability correction

Production runs after the 20-source expansion showed simultaneous YouTube Atom feed failures across old and new channels: 19/20 and then 18/20 feeds failed while the corresponding uploads-playlist API calls still succeeded. Atom RSS therefore remains a zero-quota discovery input but is not treated as a reliable sole 15-minute path.

For normal RSS-only runs, `scripts/rss-failure-fallback.mjs` provides a bounded playlist fallback:

- only Sources whose RSS probe failed are eligible;
- an isolated failed Source gets a successful playlist fallback at most once per 6 hours;
- a failed playlist attempt is retried no more than once per hour;
- if at least 50% of enabled feeds fail together, failures are spread across 24 deterministic 15-minute cohorts, so a persistent global outage does not trigger every playlist on every run;
- the fallback reads only the latest 25 uploads and batches `videos.list` calls;
- known active videos continue through the normal active-video check;
- the daily full playlist backstop remains in place;
- `search.list` remains unused.

Because Atom reliability has now failed in production, WebSub migration is no longer deferred until after 1,000 Sources. Push acquisition should be implemented and measured during the 100–300 Source phase, while this bounded fallback remains the polling safety net.

## 2026-09-04 — Map location display classes

Public map location presentation is split into four Japanese-facing classes:

1. `実際の会場・配信地点`
2. `配信元拠点`
3. `国レベル`
4. `不明`

The first three remain discoverable on the map. `不明` remains in the Source list and location totals but is not assigned a synthetic map coordinate.

`country_only` Sources keep factual `location.lat/lon=null` in canonical data. The frontend may use a separate country reference point only for display, with a visually distinct country-level marker and an explicit notice that it is not the actual venue, stream location, or source-base coordinate.

LIVE / Upcoming / Source-only state color remains independent from location precision marker shape.

The Source-list header must show total Source count plus the four-class breakdown, and the four counts must sum to the total.

## 2026-09-04 — WebSub prototype parked — supersedes WebSub-primary migration timing

The 2026-09-03 RSS outage fallback decision remains valid for Atom/playlist reliability, but its instruction to move WebSub toward production during the 100–300 Source phase is superseded by this entry.

Production proof run `33841446486`, job `100924409585`, demonstrated:

- Cloudflare Worker deployment succeeded;
- Worker secret injection succeeded;
- the workers.dev callback URL resolved correctly;
- callback challenge verification succeeded;
- the official Google PubSubHubbub subscribe endpoint returned HTTP 503 for each of five independent prototype Sources (`hoer-berlin`, `the-lot-radio`, `dommune`, `kexp`, `boiler-room`), including retry;
- the response body for each failure was `Transient error; please try again later`;
- final subscription summary was `accepted=0 failed=5 total=5`.

Therefore WebSub is parked and must not be treated as a production dependency or primary discovery path. The manual deploy/subscribe workflow is removed to prevent repeated known-failing runs.

Production continues with Atom as opportunistic zero-quota input, bounded uploads-playlist fallback, daily playlist backstop, and bounded `videos.list` checks. Normal acquisition still must not use `search.list`.

The 10,000-Source target still requires a materially cheaper event-driven or equivalent architecture, but the exact mechanism is now undecided. WebSub may only be reconsidered after a fresh bounded proof shows successful subscriptions across multiple Sources and at least one real notification through the full callback -> repository_dispatch -> targeted `videos.list` path.

## 2026-09-04 — Rolling playlist sweep — supersedes the 6-hour RSS-failure fallback

The bounded RSS-failure fallback above is too sparse for the current product. With 24 fixed 15-minute cohorts and a six-hour success cooldown, a Source can go roughly six hours between uploads-playlist checks while Atom is globally failing. That is an unacceptable discovery gap at the current ~130-Source scale and can miss short live streams.

Production scheduled acquisition therefore changes to a quota-budgeted rolling uploads-playlist sweep:

- every normal 15-minute scheduled refresh still attempts Atom as a free opportunistic input;
- independently of Atom health, the sweep selects up to 40 enabled Sources with the oldest `last_checked_at` timestamps;
- each selected Source reads the latest 50 uploads using one `playlistItems.list` call;
- candidate IDs are checked with batched `videos.list` requests of up to 50 IDs;
- only active live/upcoming candidates go through the existing deterministic targeted stream processor;
- already observed non-live candidates are remembered so they are not repeatedly billed;
- known active/upcoming streams continue to be rechecked every normal refresh;
- the daily full uploads-playlist backstop remains;
- `search.list` remains prohibited for normal acquisition.

At 130 Sources and a budget of 40 playlist calls per 15-minute run, the projected worst-case full sweep interval is at most 60 minutes. The rolling playlist path has a fixed baseline ceiling of 3,840 playlist quota units/day (`40 * 96`) before candidate detail calls, instead of attempting all Sources every 15 minutes.

The sweep budget is explicit and must be changed only from measured quota/runtime data. This is the production correction after WebSub failed its five-Source proof; WebSub remains parked and is not a prerequisite for source growth to 300.

## 2026-09-05 — Mobile map-first selection and playback — supersedes the mobile portion of the Theater interaction correction

The desktop theater contract remains unchanged: `シアター` stays a floating page-level player that is draggable/resizable and preserves the normal desktop map/list/detail context.

Mobile intentionally diverges from that desktop presentation:

- map discovery is the primary surface, so the top controls must stay compact and the map takes the remaining viewport;
- the mobile state filters are one horizontally scrollable row with counts for `すべて`, `LIVE`, `Upcoming`, and `ソースのみ`; do not add a second redundant aggregate row;
- timezone remains available but is a compact secondary control rather than a large primary block;
- no Source detail is auto-opened on initial mobile load;
- selecting a map Source opens a bottom sheet in a compact peek state; the same sheet can expand for the complete Source/LIVE/Upcoming detail and can collapse or close without leaving the map;
- when the bottom sheet appears, map positioning may compensate so the selected marker remains visible above the sheet;
- mobile detail must not keep a persistent embedded player that consumes map space;
- a verified LIVE stream exposes an explicit `再生` action and an external-platform action;
- `再生` opens a dedicated mobile playback view above the exploration UI, with a clear `地図へ戻る` action; closing playback clears the iframe source and restores the selected map context;
- Upcoming has no playback action before it becomes LIVE; it may expose detail and its external stream page;
- the dedicated mobile playback view may temporarily cover the app viewport. This supersedes the earlier statement that mobile should merely keep a responsive floating version of the desktop theater.
