# Live Music Map — Product / Technical Specification

Status: active source of truth
Last updated: 2026-09-03

## 1. Product definition

Live Music Map is a world map for discovering **officially verifiable live music streams**, primarily on YouTube.

The product is not a generic YouTube live map and not a radio directory. A stream is public only when it is verified as music-live content under the rules below.

Primary discovery states:

- LIVE
- Upcoming
- Source-only

The map should help a user answer quickly:

- What music is live now?
- What starts soon?
- Where is the source/event located?
- Who is performing, at what venue, and in what genre when those facts are verifiable?
- What is the official source/channel/schedule?

## 2. Non-goals

Do not:

- publish talk/news/interview/podcast streams as music-live;
- infer performer, venue, event location or stream genre without evidence;
- treat a source/operator location as an event location;
- copy source-level genre to an individual stream automatically;
- self-host video or thumbnails;
- use Cloudflare R2;
- use AI classification as a runtime dependency;
- use `search.list` as the normal YouTube acquisition path.

## 3. Core entities

Target normalized hierarchy:

`Source -> Event -> Stage -> Stream -> Performance <-> Artist`

Additional dimensions:

- Genre
- Location
- Evidence / provenance

Current production implementation has Source + Stream + stream history + source statistics. Event / Stage / Performance / Artist remain scheduled work.

## 4. Source record

Each source must be independently aggregatable and must not depend on free-text notes for essential fields.

Required logical groups:

### Identity

- `schema_version`
- `id`
- `name`
- `operator_name`
- `type`

Source type examples:

- venue
- live_house
- club
- radio
- studio_media
- media_events
- festival
- promoter
- label
- orchestra
- artist
- independent_media

### Geography

- `country`
- `country_code`
- `region`
- `city`
- `location.lat`
- `location.lon`
- `location.precision`
- `location.label`

Location precision must distinguish exact venue/event facts from source/operator-only facts.

Preferred values:

- `venue_exact`
- `event_exact`
- `city_confirmed`
- `source_base`
- `operator_city_only`
- `country_only`
- `unknown`

### Content profile

- `genres[]` — source coverage only
- `formats[]`
- `languages[]`
- `schedule_pattern`
- `lifecycle_status`

Format examples:

- live_performance
- dj_set
- concert
- festival_stream
- studio_session
- music_radio_live
- orchestra

Schedule-pattern examples:

- continuous
- recurring
- event_based
- seasonal
- irregular
- mixed

### Official/platform links

- `official_site`
- `schedule_url`
- `youtube_url`
- `youtube_channel_id`
- `youtube_uploads_playlist_id`

### Music-live classification policy

`music_live_policy` must support:

- `mode`: `music_only` or `mixed`
- `allow_title_patterns[]`
- `deny_title_patterns[]`
- `require_schedule_match_when_ambiguous`

### Verification

- `official_channel`
- `music_live_capable`
- `last_verified_at`

Unknown/unverified values must remain `null`, `[]`, or `unknown` rather than being guessed.

## 5. Stream record

A Stream is a specific YouTube live/upcoming video, separate from the Source.

Important fields:

- `id`
- `source_id`
- `youtube_video_id`
- `youtube_url`
- `title`
- `status`: `live` or `upcoming`
- `published_at`
- `scheduled_start`
- `actual_start`
- `actual_end`
- `concurrent_viewers`
- `thumbnail`
- `embed_allowed`
- `youtube_category_id`
- `music_live_status`
- `content_type`
- `music_live_decision`
- `music_live_evidence[]`
- `classifier_version`
- `genres[]`
- `performers[]`
- `venue`
- `location`

## 6. Music-live classification

No AI is required.

Every newly discovered live/upcoming video is classified individually.

Possible `music_live_status` values:

- `verified` — may be public
- `rejected` — known non-music-live
- `unknown` — insufficient evidence; do not publish as live/upcoming

Public map rule:

**Only `music_live_status=verified` may appear as LIVE or Upcoming.**

Decision inputs, in priority order:

1. official schedule/event evidence;
2. source-specific allow/deny patterns;
3. explicit music-live metadata phrases;
4. YouTube category only as supporting evidence, never sufficient by itself.

Common positive patterns include explicit concert/session/DJ-set/festival/live-performance wording.

Common negative patterns include:

- interview
- podcast
- talk
- news
- discussion
- lecture

Mixed sources such as radio/media must fail closed when ambiguous.

## 7. YouTube acquisition

Current architecture:

- every 15 minutes: YouTube official Atom feeds for registered channels;
- new/changed feed entries: `videos.list`;
- known live/upcoming entries: rechecked as needed;
- daily uploads-playlist backstop;
- no normal `search.list` acquisition.

Current milestone architecture is intended for up to roughly 1,000 registered sources before a redesign.

10,000-source target architecture:

- YouTube WebSub / PubSubHubbub push as primary discovery;
- status-aware rechecks only for changed/upcoming/live video IDs;
- staggered playlist backstop;
- Cloudflare Worker/D1 free-tier compatible design;
- no R2.

## 8. History and statistics

Production data files:

- `data/stream-history.json`
- `data/source-stats.json`

Historical rule:

Only a `verified` stream actually observed in `live` state counts as an observed live stream.

An upcoming-only stream that disappears must not be counted as an actual historical live stream.

If exact end time is unknown:

- keep `actual_end=null`;
- store an observation timestamp such as `ended_observed_at` separately.

Derived source statistics include:

- live now
- upcoming count
- observed live total
- observed live 7d
- observed live 30d
- active days 30d
- last live time
- next live time
- observed content types

Aggregates should support country, source type, source coverage genre and verified stream content type.

## 9. Map semantics

### Single source marker

- red = source currently has verified LIVE
- orange = no LIVE, but has verified Upcoming
- gray = Source-only

### Cluster semantics

The center number always means **total Source count**, never number of live streams.

A cluster containing LIVE:

- neutral center with total source count;
- strong red outer ring/halo;
- subtle pulse;
- red `LIVE n` badge showing the count of sources with LIVE.

A cluster with no LIVE but with Upcoming:

- neutral center with total source count;
- orange outer ring;
- orange `UP n` badge.

A Source-only cluster:

- neutral gray only;
- no state badge.

If LIVE and Upcoming both exist, show both badges. Maximum zoom must spiderfy overlapping markers so individual sources can be selected.

## 10. Desktop information architecture

Three-column desktop layout:

- left: ordered source list;
- center: map;
- right: selected source details;
- theater: independent floating window above the normal layout.

Source ordering:

1. sources with LIVE;
2. sources with Upcoming, nearest start first;
3. Source-only.

Right detail ordering:

1. source identity/header;
2. LIVE;
3. source/channel information;
4. Upcoming.

Upcoming must not push channel information far down the page. Show only a small initial set, with additional items collapsed.

## 11. Theater behavior

User-facing action label: **`シアター`**.

Desktop behavior:

- the theater is a **floating page-level video window** over the normal site layout;
- the map, left source list, right detail column and top controls remain visible and usable;
- the theater is draggable;
- the theater is resizable;
- its position should be constrained enough that the window cannot be lost completely outside the viewport;
- opening theater must not replace the center/map pane;
- opening theater must not convert the whole browser into a video-only view;
- closing theater keeps the selected source/map context and clears the iframe `src`;
- Escape closes the theater.

Mobile behavior:

- use a responsive floating presentation sized to the viewport;
- desktop-style free resize is not required.

Do not replace this with a center/map-region-only theater unless the product specification is explicitly changed.

## 12. Source expansion policy

Source count targets:

- 100
- 300
- 600
- 1,000
- 10,000

Do not grow by fame alone. Prefer sources that demonstrably produce current/recurring official live music.

Coverage must deliberately include:

- venues / clubs / live houses;
- radio/online-radio sources where music-live can be separated from talk;
- studios/session channels;
- festivals/promoters;
- orchestras/classical/opera;
- jazz;
- labels/media;
- artists and small independent streamers.

Avoid US/Western-Europe-only bias. Expand across Japan, East Asia, Southeast Asia, South Asia, Latin America, Eastern Europe, Africa, Middle East and Oceania.

Acceptance minimum for a production source:

1. official/operator/performer channel can be verified;
2. real live/upcoming music behavior is evidenced;
3. source base or relevant geographic scope can be verified at the precision recorded.

## 13. Evidence and provenance

Performer, venue, stream genre and event location must be evidence-backed.

When implemented, provenance fields should record concepts such as:

- evidence type;
- evidence URL;
- verified timestamp;
- confidence/status.

Never derive Event location from a touring operator's office/source base.

## 14. Time zones

User-selectable time zone is required.

Store canonical timestamps in machine-readable UTC/ISO form and convert only for display. Do not hardcode JST as the product time zone.

## 15. Hosting/cost constraints

Target operating cost: $0/month where practical.

Preferred components:

- GitHub Pages / Cloudflare Pages;
- GitHub Actions;
- Cloudflare Workers/D1 when scaling requires it;
- official YouTube embeds;
- external thumbnail URLs.

Forbidden dependency for this project:

- Cloudflare R2.
