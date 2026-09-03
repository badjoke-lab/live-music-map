# Live Music Map — Execution Plan

Status: active execution schedule
Last updated: 2026-09-03

This document is the implementation order. Do not substitute chat summaries for it.

## Current production state

Completed:

- GitHub Pages deployment
- three-column map UI
- LIVE-first source ordering
- verified-only public music-live filtering
- non-AI per-stream classification
- Source schema v2
- stream history generator
- source statistics generator
- marker clustering and spiderfy
- cluster total/source-state count separation
- floating draggable/resizable theater
- theater action label `シアター`
- right detail order: LIVE -> source information -> Upcoming
- compact Upcoming section
- Source v2 contract freeze and validator
- Source evidence/provenance structure
- duplicate Source id / YouTube channel id / YouTube URL rejection
- M2 expansion batch 001 and 002

Current registered source baseline: **20 production Sources**.

## Execution rule

Milestones are sequential unless an urgent production defect blocks users or would multiply during bulk expansion.

A milestone is not complete because code exists on a branch. Completion requires:

1. merged to `main`;
2. production workflow/run checked;
3. generated data or UI behavior inspected where applicable;
4. Pages deploy confirmed when public output changes.

## M0 — UI contract cleanup — completed

The agreed desktop interaction contract is now:

- theater is a floating page-level window;
- normal map/list/detail/top controls remain visible and usable;
- theater is draggable and resizable on desktop;
- theater does not replace the center/map pane;
- browser-wide video-only takeover is not used;
- cluster center = total sources;
- red ring/halo + `LIVE n` when LIVE exists;
- orange ring + `UP n` when Upcoming exists without LIVE;
- Source-only cluster remains neutral;
- right detail order is LIVE -> source information -> Upcoming;
- only a small initial Upcoming set is expanded.

Future UI work is continuous refinement, not a prerequisite rewrite of the theater model.

## M1 — Source data contract freeze — completed

The production Source contract is frozen in `docs/SOURCE_CONTRACT_V2.md` and enforced by `scripts/validate-sources.mjs`.

Completed work:

- existing Sources migrated to one contract;
- normalized location precision and `location.role`;
- structured official `evidence[]`;
- duplicate Source/channel/YouTube URL rejection;
- canonical uploads playlist check;
- validation before refresh and Pages deployment.

## M1.5 — acquisition reliability hotfix — current blocking gate

Why this gate exists:

After reaching 20 Sources, consecutive production runs showed widespread YouTube Atom failures: 19/20 feeds and then 18/20 feeds failed while uploads-playlist API calls still succeeded. Continuing bulk expansion without a fallback would multiply a real 15-minute discovery failure.

Implement before further source batches:

- keep Atom RSS as the zero-quota primary polling input;
- on RSS-only runs, probe feed health;
- fallback only for failed Sources;
- successful fallback cooldown: 6 hours per Source;
- failed API-attempt cooldown: 1 hour;
- when at least 50% of feeds fail together, spread failed Sources across 24 deterministic 15-minute cohorts;
- latest 25 uploads only;
- batch `videos.list`;
- keep daily full playlist backstop;
- keep `search.list` at zero;
- record fallback state in `youtube-state.json`;
- verify the behavior in an actual scheduled RSS-only run.

Exit gate:

- scheduled RSS-only run invokes bounded fallback when feeds fail;
- playlist fallback volume is bounded and visible in logs;
- generated data and Pages remain healthy.

## M2 — 20 -> 100 sources

Goal: first real-world expansion milestone.

Target: 100 total registered Sources. **Remaining after batch 002: 80.**

Required source mix:

- venue / live house / club
- DJ / electronic live source
- studio/session
- festival/promoter
- classical/orchestra/opera
- jazz
- artist/independent
- radio/media only where music-live can be separated from non-music content

Geographic rule:

Do not fill the batch primarily with US/Western-European sources. Include meaningful coverage across Japan/East Asia, Southeast Asia, South Asia, Latin America, Eastern Europe, Africa, Middle East and Oceania.

Per-source admission process:

1. confirm official channel/operator identity;
2. confirm official site or equivalent first-party evidence;
3. confirm current/recurring live-music behavior;
4. record location only at verified precision and role;
5. assign non-AI music-live policy;
6. add Source v2 record with `evidence[]`;
7. pass `node scripts/validate-sources.mjs`.

Batch verification:

- run collector;
- RSS failure count and bounded-fallback count;
- channel resolution failures;
- duplicate ids/channel ids;
- verified/rejected/unknown classification counts;
- inspect actual detected streams.

Exit gate:

- 100 production Sources;
- acquisition run succeeds despite individual or widespread RSS failures;
- no known duplicate channel ids;
- obvious talk/news false positives corrected.

## M3 — 100-source acquisition audit + WebSub prototype

Goal: measure the system instead of estimating it and start removing dependence on Atom polling.

Record:

- complete workflow duration;
- Atom feed success/failure rate;
- fallback playlist volume;
- regular YouTube API units used by each acquisition mode;
- active live/upcoming records;
- classification distribution;
- source-specific false positives/false negatives from manual samples;
- Pages/data generation duration;
- clustering usability in high-density cities.

In parallel, implement the first official YouTube WebSub/PubSubHubbub prototype:

- subscribe registered channels;
- receive upload/update notifications;
- map notifications to changed video ids;
- use `videos.list` for changed ids;
- prove subscription renewal from actual lease information rather than guessed durations.

Exit gate:

- measured 100-Source baseline documented;
- no unresolved issue likely to multiply badly at 300 Sources;
- WebSub prototype works end-to-end for a controlled subset.

## M4 — 100 -> 300 sources + WebSub production migration

Goal: geographic breadth while moving primary discovery toward push.

Add 200 Sources, prioritizing countries/cities/source types poorly represented in the first 100.

During this phase:

- expand WebSub from prototype subset to production Sources;
- keep bounded RSS/playlist logic as a safety backstop;
- use generated source statistics to detect geographic/source-type bias.

Exit gate:

- 300 production Sources;
- regional and source-type coverage review complete;
- push acquisition is the preferred discovery path for supported Sources;
- polling fallback remains within operational/API limits.

## M5 — 300 -> 600 sources

Goal: move beyond famous channels.

Expansion emphasis:

- local venues;
- small live houses;
- regional broadcasters with separable live-music programming;
- community/university live sessions;
- local festivals;
- small artist/independent channels.

Use 30-day observed-live stats to identify Sources that are actually active.

Exit gate:

- 600 production Sources;
- inactive/dead-source handling defined;
- no major map UX failure from density.

## M6 — 600 -> 1,000 sources

Goal: reach the first four-digit Source milestone with push plus bounded polling fallback.

Required audit:

- scheduled run duration;
- WebSub subscription/notification health;
- RSS/fallback request volume;
- YouTube API regular quota use;
- generated JSON size;
- source list/map rendering performance;
- GitHub Actions runtime behavior.

Exit gate:

- 1,000 production Sources;
- measured decision on the storage/frontend architecture for the next scale stage;
- acquisition no longer depends on every Atom feed succeeding every 15 minutes.

## M7 — Event / Stage / Performance / Artist normalization

Goal: stop forcing event-specific facts into Source/Stream records.

Implement:

- Event
- Stage
- Performance
- Artist
- evidence/provenance joins

Relationship target:

`Source -> Event -> Stage -> Stream -> Performance <-> Artist`

Rules:

- touring media/operator HQ must never become event location;
- artist may have multiple genres;
- event/stream/performance genres may differ from source coverage genres;
- missing facts remain unknown.

Exit gate:

- multi-stage festivals and touring event Sources can be represented without false location/artist assumptions;
- artist/venue/event statistics can be derived from verified relationships.

## M8 — 1,000-source acquisition/storage hardening

WebSub work begins earlier in M3/M4; this milestone is no longer the first WebSub implementation.

At 1,000 Sources, harden the push architecture for the 10,000 target:

- Worker callback receives upload/update notifications;
- changed video ids only go through `videos.list`;
- upcoming streams are checked near scheduled start;
- live streams are rechecked while active;
- playlist backstop is staggered;
- D1 stores subscription/state/event data if required;
- no R2.

Exit gate:

- push path is production-proven at 1,000 Sources;
- renewal and fallback/backstop are measured;
- normal operation does not require successful Atom polling for every registered Source.

## M9 — 1,000 -> 10,000 sources

Goal: global long-tail coverage while retaining the $0/month target where practical.

Scale in controlled batches with checkpoints:

- 2,000
- 3,000
- 5,000
- 7,500
- 10,000

At each checkpoint monitor:

- Worker requests/day;
- D1 reads/writes/storage;
- YouTube API quota;
- push subscription health;
- active/upcoming status-check volume;
- frontend data size/performance;
- geographic/source-type imbalance;
- stale/dead Source rate.

Exit gate:

- 10,000 production Sources or a documented hard external limit with measured evidence and a replacement architecture.

## Continuous workstream — data quality

Runs throughout all milestones:

- official URL verification;
- dead channel/site detection;
- duplicate merge/removal;
- location precision correction;
- false-positive classification rules;
- stream-level performer/venue/genre evidence enrichment;
- source statistics integrity;
- history preservation.

## Continuous workstream — UI

Continuously verify:

- LIVE remains visually dominant;
- source list ordering remains useful;
- cluster state is understandable at a glance;
- dense cities remain selectable;
- channel information is accessible;
- floating theater remains draggable/resizable and preserves page context;
- mobile layout remains operable.

## What to do next

Complete **M1.5 acquisition reliability hotfix** and verify it in a real RSS-only scheduled run. Then resume **M2 from 20 -> 100 Sources** without weakening the Source v2 contract.
