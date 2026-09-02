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
