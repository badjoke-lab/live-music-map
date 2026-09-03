# Live Music Map — Source Contract v2

Status: frozen for source expansion
Last updated: 2026-09-03

This document is the authoritative record-level contract for `data/sources.json`. It refines the generic Source section in `docs/PRODUCT_SPEC.md` and is enforced by `scripts/validate-sources.mjs`.

## Required top-level fields

Every production source requires:

- `schema_version: 2`
- `id` — stable lower-kebab-case identifier
- `name`
- `operator_name` — string or `null`
- `type`
- `country`
- `country_code`
- `region` — string or `null`
- `city` — string or `null`
- `location`
- `genres[]`
- `formats[]`
- `languages[]`
- `official_site`
- `schedule_url` — URL or `null`
- `youtube_url`
- `schedule_pattern`
- `lifecycle_status`
- `music_live_policy`
- `verification`
- `evidence[]`
- `acquisition`
- `youtube_channel_id`
- `youtube_uploads_playlist_id`

`status` and `note` remain compatibility/descriptive fields and are not a substitute for structured fields.

## Location

`location` contains:

- `lat`
- `lon`
- `precision`
- `role`
- `label`

Allowed `precision` values:

- `venue_exact`
- `event_exact`
- `city_confirmed`
- `source_base`
- `operator_city_only`
- `country_only`
- `unknown`

Allowed `role` values:

- `source_base`
- `operator_base`
- `origin`
- `event_home`
- `unknown`

`precision` says how the recorded coordinates are qualified. `role` says what the location means. These must not be conflated.

Examples:

- The Lot Radio: `precision=source_base`, `role=source_base`
- Boiler Room: `precision=operator_city_only`, `role=operator_base`
- Sofar Sounds: `precision=city_confirmed`, `role=origin`
- Coachella: `precision=city_confirmed`, `role=event_home`

A Source location must never be silently copied into Event/Stream location. Touring/global operators require event-specific location evidence later.

## Content profile

`genres[]` means music coverage of the Source. Non-music content labels such as `Talk` must not be stored as source genres.

`formats[]` means music-live formats the Source can produce, such as:

- `live_performance`
- `dj_set`
- `concert`
- `festival_stream`
- `studio_session`
- `music_radio_live`
- `acoustic_session`
- `opera`

Generic non-music formats such as `talk` are not source music-live formats. Mixed/non-music behavior belongs in `music_live_policy`.

Source genres and formats never auto-populate Stream/Event/Performance facts.

## Music-live policy

Required fields:

- `mode`: `music_only` or `mixed`
- `allow_title_patterns[]`
- `deny_title_patterns[]`
- `require_schedule_match_when_ambiguous`

A `mixed` source fails closed when a stream cannot be deterministically verified as music-live.

## Verification

Required fields:

- `official_channel`
- `music_live_capable`
- `last_verified_at` in `YYYY-MM-DD`

Unknown facts remain unknown; the contract does not authorize inference.

## Evidence / provenance

Every source requires `evidence[]`.

Each evidence item contains:

- `kind`
- `url`
- `supports[]`

Allowed `kind` values:

- `official_site`
- `official_youtube_channel`
- `official_schedule`
- `official_event_page`
- `other_official`

Allowed `supports` values:

- `identity`
- `official_channel`
- `music_live_capability`
- `schedule_pattern`
- `source_location`

At minimum, every production Source must have official evidence covering:

- identity
- official YouTube channel
- music-live capability

Evidence entries do not grant permission to infer unrelated fields. For example, an official channel link proving channel identity does not prove an event venue.

## Acquisition

Required fields:

- `enabled`
- `method`
- `priority`

Current production method is `youtube_atom_feed`.

Allowed priority values:

- `low`
- `normal`
- `high`

## YouTube identifiers

`youtube_channel_id` must be a canonical 24-character `UC...` channel id.

`youtube_uploads_playlist_id` must equal `UU` plus the channel-id suffix. Duplicate Source ids, duplicate YouTube channel ids and duplicate YouTube URLs are rejected.

## Validation

Run:

```bash
node scripts/validate-sources.mjs
```

Validation runs before both YouTube refresh and Pages deployment. Invalid source data must not proceed to acquisition or public deployment.

## Expansion rule

All additions from source 12 onward use this exact contract. Do not weaken the validator to admit a candidate. Fix the record or reject the candidate.
