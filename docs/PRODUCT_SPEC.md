# Live Music Map — Product / Technical Specification

Status: active source of truth
Last updated: 2026-09-04

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

Current production architecture:

- every 15 minutes: attempt YouTube official Atom feeds for registered channels;
- failed Atom probes use the bounded uploads-playlist fallback defined in the acquisition reliability rules;
- new/changed candidate video IDs are checked with batched `videos.list`;
- known live/upcoming entries are rechecked as needed;
- daily uploads-playlist backstop remains enabled;
- no normal `search.list` acquisition.

The polling/playlist architecture remains the production path while source growth continues.

The September 2026 WebSub prototype is **parked and must not be promoted to primary discovery**. In production proof runs, the callback Worker deployed successfully and its challenge endpoint verified successfully, but the official Google PubSubHubbub subscribe endpoint returned HTTP 503 with `Transient error; please try again later` for all five independent prototype channels, including retries. No subscription was accepted.

The 10,000-source target still requires an event-driven or otherwise materially cheaper discovery architecture, but **YouTube WebSub is not an approved production dependency unless a later fresh proof demonstrates successful subscriptions and real notifications**.

Until then:

- uploads-playlist acquisition is the reliable discovery safety net;
- Atom remains opportunistic zero-quota input, not a sole dependency;
- status-aware `videos.list` rechecks remain bounded;
- no R2;
- no `search.list` normal acquisition.

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
