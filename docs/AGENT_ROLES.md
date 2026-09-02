# Live Music Map — Agent Roles

These roles divide work so one agent does not mix research, ingestion, UI and release verification in one uncontrolled pass.

All agents must follow root `AGENTS.md` and the source-of-truth documents.

## 1. Source Research Agent

Purpose:

Find and verify candidate music-live sources.

Responsibilities:

- verify official/operator/performer YouTube channel;
- verify official site or first-party evidence;
- verify current/recurring live-music capability;
- verify geography at the precision recorded;
- classify source type, formats, source-level genres and schedule pattern;
- define `music_live_policy` for mixed sources;
- record unknown facts as unknown, not guesses;
- avoid duplicate YouTube channel ids;
- maintain geographic/source-type diversity.

Output:

- Source v2 candidate records ready for ingestion;
- evidence URLs/verification date where the schema supports them;
- rejected candidates with reason when useful.

Must not:

- change UI;
- fabricate channel IDs;
- call a generic radio livestream a music-live source without evidence.

## 2. Source Ingestion Agent

Purpose:

Move verified candidates into production data safely.

Responsibilities:

- validate schema shape;
- check duplicate source id and YouTube channel id;
- add records in reviewable batches;
- run acquisition after changes;
- inspect RSS failures, channel-resolution failures and active records;
- inspect classification distribution;
- update source statistics/generated data through the normal workflow.

Output:

- merged source batch;
- measured collector result;
- production source count.

Must not:

- weaken admission rules to hit a numeric milestone.

## 3. Acquisition Agent

Purpose:

Own YouTube discovery/status correctness and scaling architecture.

Responsibilities:

- maintain Atom/RSS + targeted API acquisition;
- keep `search.list` out of normal acquisition;
- preserve fail-closed stream classification;
- preserve history semantics;
- measure runtime/quota behavior at 100/300/600/1,000 milestones;
- implement WebSub path for 10,000-source scaling;
- ensure subscription renewal/backstop behavior is evidence-based;
- keep R2 out of the architecture.

Output:

- acquisition changes with real run evidence;
- measured scaling reports;
- no claim of capacity based only on estimates when a real benchmark is available.

## 4. Data Quality Agent

Purpose:

Protect semantic correctness as the dataset grows.

Responsibilities:

- audit false positive music-live classifications;
- audit false negatives from source-specific rules;
- audit source/event location precision;
- detect duplicates/dead sources;
- enrich performer/venue/genre only from verified evidence;
- verify historical live records are based on actual live observation;
- verify source genre and stream genre remain separate.

Output:

- corrections to records/rules;
- quality findings with concrete affected IDs;
- no speculative enrichment.

## 5. UI Agent

Purpose:

Keep the discovery experience usable as source density grows.

Responsibilities:

- LIVE-first visual hierarchy;
- cluster semantics;
- dense-city selection/spiderfy;
- selected-source detail order;
- floating theater behavior;
- time-zone display;
- desktop/mobile usability;
- never expose internal development instructions in the public UI.

Theater contract:

- preserve the draggable/resizable floating theater on desktop;
- keep map/list/detail/top controls visible and usable while theater is open;
- do not replace the center/map pane with the theater;
- do not constrain the theater to the center/map region only;
- do not use a browser-wide video-only takeover;
- keep responsive floating behavior on mobile.

Output:

- merged UI change;
- Pages deployment confirmed;
- visual semantics checked against `PRODUCT_SPEC.md`.

## 6. Release Verification Agent

Purpose:

Prevent branch-only or workflow-only work from being reported as production-complete.

Responsibilities:

- confirm PR merge SHA;
- inspect required GitHub Actions run/jobs;
- confirm Pages deployment for public changes;
- confirm collector counters for acquisition/data changes;
- inspect generated file values when the task depends on them;
- report exact completed state and exact unresolved state.

Output:

- release verdict: production-complete / not production-complete;
- supporting run/job/commit identifiers.

## 7. Documentation Agent

Purpose:

Keep repository source of truth synchronized with durable product decisions.

Responsibilities:

- update `PRODUCT_SPEC.md` when durable behavior changes;
- update `EXECUTION_PLAN.md` when milestone order/gates change;
- append decisions to `DECISIONS.md`;
- update `AGENTS.md` / this file when operating rules change;
- prevent README from becoming the only place where critical implementation rules exist.

## Handoff order for source expansion batches

For each expansion batch:

1. Source Research Agent
2. Source Ingestion Agent
3. Acquisition Agent / Data Quality Agent verification
4. Release Verification Agent
5. Documentation Agent if rules/milestones changed

## Handoff order for UI defects

1. UI Agent
2. Release Verification Agent
3. Documentation Agent if the defect revealed a durable UI rule

## Handoff order for acquisition defects

1. Acquisition Agent
2. Data Quality Agent
3. Release Verification Agent
4. Documentation Agent if architecture/semantics changed

## Stop conditions

An agent must stop and mark the item unresolved rather than guess when:

- official channel identity cannot be verified;
- source/event location evidence conflicts;
- a mixed stream cannot be classified deterministically;
- a deployment/run has not actually completed;
- a required external quota/limit is unknown and the answer would materially affect architecture.
