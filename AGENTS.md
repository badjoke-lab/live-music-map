# AGENTS.md — Live Music Map

This file defines how coding/research agents must work in this repository.

## 1. Read before changing anything

Before implementation, read:

1. `docs/PRODUCT_SPEC.md`
2. `docs/EXECUTION_PLAN.md`
3. `docs/DECISIONS.md`
4. `docs/SOURCE_CONTRACT_V2.md` when touching Source records, source research, ingestion or validation
5. current production files involved in the task

Do not reconstruct product rules from chat memory when the repository documents answer the question.

If code and specification disagree, do not silently choose one. Identify whether the code is a known transitional state or the spec needs an explicit decision update.

## 2. Source of truth hierarchy

For implementation decisions:

1. latest explicit user decision;
2. `docs/DECISIONS.md`;
3. `docs/PRODUCT_SPEC.md`;
4. `docs/SOURCE_CONTRACT_V2.md` for Source-record details;
5. `docs/EXECUTION_PLAN.md`;
6. current implementation.

A new explicit decision that changes a durable rule must update the relevant documentation in the same workstream.

## 3. Execution behavior

Do not respond with repeated plans when repository access allows the work to be done.

For implementation tasks:

1. inspect actual `main`;
2. make the smallest coherent change;
3. use a branch/PR when practical;
4. merge when ready;
5. inspect the real workflow/run;
6. confirm generated data/deployment when relevant;
7. report concrete results only.

Never claim production success from a branch-only change.

Never claim a workflow succeeded without checking the run/job conclusion.

## 4. Product invariants

### Public stream eligibility

Only streams with `music_live_status=verified` may appear publicly as LIVE or Upcoming.

`unknown` must fail closed.

### No AI runtime dependency

Music-live classification is deterministic/rule-based. Do not add AI inference calls for each stream unless the product specification is explicitly changed.

### No fabrication

Never invent:

- performer
- venue
- event location
- stream genre
- schedule
- exact end time
- source/operator identity

Use `null`, `[]`, or `unknown` when facts are not verified.

### Source genre is not stream genre

Never auto-copy `Source.genres[]` into Stream/Event/Performance genre fields.

### Source location is not event location

Do not place touring/global event streams at operator headquarters. Preserve location precision and provenance.

### Radio/media handling

A radio/media Source may be registered if it genuinely produces live music, but its live/upcoming videos are not automatically music-live.

Mixed sources require source-specific rules and/or official schedule evidence. Talk/news/interview/podcast content must not leak into the public music-live map.

## 5. YouTube acquisition constraints

Normal acquisition must not use `search.list`.

Current path:

- official Atom feed;
- targeted `videos.list`;
- uploads-playlist backstop.

Long-term path:

- YouTube WebSub push;
- targeted state checks;
- staggered backstop.

Do not add Cloudflare R2.

Do not propose quota multiplication by artificially splitting one product across API projects.

## 6. UI invariants

### Ordering

Source list:

1. LIVE
2. Upcoming nearest start
3. Source-only

Selected-source detail:

1. source identity
2. LIVE
3. source/channel information
4. Upcoming

Do not put a long Upcoming stack before source information.

### Theater

User-facing label is `シアター`.

Desktop contract:

- theater is a floating page-level video window over the normal site layout;
- the map, left source list, right detail and top controls remain visible and usable;
- the floating window is draggable;
- the floating window is resizable;
- keep the window recoverable on-screen rather than allowing it to be lost completely outside the viewport;
- closing clears the iframe `src`;
- Escape closes the theater.

Mobile contract:

- keep a responsive floating presentation;
- desktop-style free resize is not required.

Do not replace the center/map pane with the theater.

Do not constrain the theater to the center/map region only.

Do not make a browser-wide video-only takeover.

### Cluster semantics

The center number is always **total Source count**.

Never color a total-count cluster solid red/orange in a way that implies all sources are in that state.

LIVE-containing cluster:

- neutral center;
- red ring/halo/pulse;
- explicit `LIVE n` badge.

Upcoming-only cluster:

- neutral center;
- orange ring;
- explicit `UP n` badge.

Source-only cluster:

- neutral gray;
- no state badge.

At maximum zoom, overlapping points must remain individually selectable via spiderfy or equivalent.

## 7. Data growth rules

Source-count milestones:

- 100
- 300
- 600
- 1,000
- 10,000

Do not bulk-add guessed channel IDs or unverifiable location facts just to reach a number.

Every Source addition must pass `node scripts/validate-sources.mjs` and the exact Source v2 contract in `docs/SOURCE_CONTRACT_V2.md`.

Each production Source must have verified official/operator identity, live-music capability evidence, and geographic precision appropriate to the evidence.

Avoid geographic bias. Do not satisfy expansion primarily with US/Western-Europe sources.

## 8. History/statistics invariants

Only a verified stream actually observed as `live` counts as an observed historical live stream.

Upcoming-only disappearance is not proof that the live event occurred.

If exact end time is unavailable, keep `actual_end=null` and record observation time separately.

Derived statistics must distinguish:

- source coverage genres;
- verified stream/performance genres.

## 9. Documentation discipline

When a durable behavior changes, update docs in the same PR or immediately following PR.

Append durable product/technical decisions to `docs/DECISIONS.md` rather than silently rewriting history.

Do not put internal development instructions into the public-facing UI.

README is not the full source of truth. Keep README concise; detailed implementation rules belong under `docs/` and in this file.

## 10. Completion standard

A task is complete only when the relevant evidence is checked.

Examples:

- UI task: merged + Pages deployment confirmed.
- acquisition task: merged + collector run inspected + actual counters/errors checked.
- data expansion: records added + duplicate IDs checked + acquisition run checked.
- schema task: existing records migrated or compatibility explicitly documented.

Do not report "done" based only on intended behavior.
