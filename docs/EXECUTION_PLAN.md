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
- theater action label `シアター`

Current known UI mismatch:

- theater is still implemented as a floating page-level window; target behavior is center/map-region constrained theater per `docs/PRODUCT_SPEC.md`.

Current registered source baseline when this plan was written: 11.

## Execution rule

Milestones are sequential unless an urgent production defect blocks users.

A milestone is not complete because code exists on a branch. Completion requires:

1. merged to `main`;
2. production workflow/run checked;
3. generated data or UI behavior inspected where applicable;
4. Pages deploy confirmed when public output changes.

## M0 — UI contract cleanup

Goal: finish the interaction model before scaling source count.

Tasks:

- replace floating theater with center/map-region constrained theater;
- keep left source list, right source detail and top controls visible while theater is open;
- preserve selected source when theater closes;
- verify cluster rendering:
  - center = total sources;
  - red ring/halo when LIVE exists;
  - `LIVE n` = source count with LIVE;
  - orange ring when only Upcoming exists;
  - `UP n` = source count with Upcoming;
  - gray when Source-only;
- verify right detail order:
  - LIVE;
  - source information;
  - Upcoming;
- keep only a small initial Upcoming set expanded;
- desktop and mobile visual check.

Exit gate:

- no browser-wide video takeover;
- no ambiguous cluster count semantics;
- source/channel information visible without scrolling past a long Upcoming stack.

## M1 — Source data contract freeze

Goal: ensure all future sources use one stable shape.

Tasks:

- validate all existing Source v2 records against the product spec;
- remove/rename non-standard location precision values where necessary;
- ensure `type`, `formats`, `genres`, `schedule_pattern`, verification and acquisition fields are present;
- ensure no unverified performer/venue/event facts are embedded in source fields;
- add explicit evidence/provenance structure if needed before mass ingestion;
- add duplicate checks for source id and YouTube channel id.

Exit gate:

- existing records pass the same requirements applied to new records;
- adding the 100th source does not require a schema redesign.

## M2 — 11 -> 100 sources

Goal: first real-world expansion batch.

Target: 100 total registered sources.

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
4. record location only at the verified precision;
5. assign non-AI music-live policy;
6. add Source v2 record;
7. reject duplicates by YouTube channel id.

Batch verification:

- run collector;
- RSS failure count;
- channel resolution failures;
- duplicate ids/channel ids;
- verified/rejected/unknown classification counts;
- inspect actual detected streams.

Exit gate:

- 100 production sources;
- acquisition run succeeds;
- no known duplicate channel ids;
- obvious talk/news false positives corrected.

## M3 — 100-source acquisition audit

Goal: measure the system instead of estimating it.

Record:

- complete workflow duration;
- Atom feed success/failure rate;
- regular YouTube API units used by each acquisition mode;
- number of active live/upcoming records;
- classification distribution;
- source-specific false positives/false negatives found by manual sample;
- Pages/data generation duration;
- clustering usability in high-density cities.

Fix any systemic problem before expansion continues.

Exit gate:

- measured baseline documented;
- no unresolved issue likely to multiply badly at 300 sources.

## M4 — 100 -> 300 sources

Goal: geographic breadth.

Add 200 sources, prioritizing countries/cities/source types poorly represented in the first 100.

Use generated source statistics to detect bias.

Exit gate:

- 300 production sources;
- regional and source-type coverage review complete;
- acquisition remains within operational limits.

## M5 — 300 -> 600 sources

Goal: move beyond famous channels.

Expansion emphasis:

- local venues;
- small live houses;
- regional broadcasters with separable live-music programming;
- community/university live sessions;
- local festivals;
- small artist/independent channels.

Use 30-day observed-live stats to identify sources that are actually active.

Exit gate:

- 600 production sources;
- inactive/dead-source handling defined;
- no major map UX failure from density.

## M6 — 600 -> 1,000 sources

Goal: reach the operational target of the current polling architecture.

At 1,000, measure again rather than assuming capacity.

Required audit:

- 15-minute scheduled run duration;
- RSS feed request duration/failure rate;
- YouTube API regular quota use;
- generated JSON size;
- source list/map rendering performance;
- GitHub Actions runtime behavior.

Exit gate:

- 1,000 production sources;
- measured decision on whether current architecture can temporarily continue beyond 1,000;
- WebSub migration implementation ready to begin.

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

- multi-stage festivals and touring event sources can be represented without false location/artist assumptions;
- artist/venue/event statistics can be derived from verified relationships.

## M8 — 1,000-source acquisition redesign

Goal: remove full-scan polling as the primary growth architecture.

Primary direction:

- YouTube WebSub/PubSubHubbub subscriptions for registered channels;
- Worker callback receives upload/update notifications;
- changed video ids only go through `videos.list`;
- upcoming streams are checked near scheduled start;
- live streams are rechecked while active;
- playlist backstop is staggered across days;
- D1 stores subscription/state/event data if required;
- no R2.

Exit gate:

- push path works end-to-end;
- lease renewal is implemented from actual subscription lease information rather than guessed duration;
- fallback/backstop works;
- normal operation no longer requires polling every registered source every 15 minutes.

## M9 — 1,000 -> 10,000 sources

Goal: global long-tail coverage while retaining $0/month target where practical.

Scale in controlled batches with explicit metrics rather than one 9,000-source import.

Suggested checkpoints:

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
- stale/dead source rate.

Exit gate:

- 10,000 production sources or a documented hard external limit with measured evidence and a replacement architecture.

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

Do not let bulk ingestion make the product unusable.

Continuously verify:

- LIVE remains visually dominant;
- source list ordering remains useful;
- cluster state is understandable at a glance;
- dense cities remain selectable;
- channel information is accessible;
- theater does not hide navigation/context;
- mobile layout remains operable.

## What to do next

The next scheduled milestone is **M0 UI contract cleanup**, specifically replacing the floating theater with a center/map-region constrained theater. After M0 passes, continue immediately to **M1 data contract freeze**, then **M2 100-source expansion**.
