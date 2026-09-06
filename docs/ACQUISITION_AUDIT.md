# Acquisition audit

Generated: 2026-09-06T19:38:59.995Z

This is the M3 production audit for the YouTube acquisition path. It samples the latest 10 completed `youtube-refresh.yml` runs whose **refresh job itself succeeded**, even if a later Pages deployment failed for an unrelated reason.

## Runtime

- p50: **77s**
- p95: **124s**
- max: **124s**

## Estimated YouTube Data API quota

- p50: **87 units/run**
- p95: **190 units/run**
- max: **190 units/run**
- total across sample: **972 units**

The estimate counts logged `channels.list`, `playlistItems.list`, and `videos.list` calls at one unit each. Official Atom feed fetches cost zero YouTube Data API quota units. The rolling sweep estimate also counts one `videos.list` call per targeted processor. `search.list` is not used by this refresh path.

## Reliability

- RSS fetches: **1851**
- RSS failures: **0** (0.00%)
- rolling playlist failures: **0**
- stream/source channel mismatches removed: **0**
- source preservations caused by failed detail batches: **0**
- source count represented in sample: **176–194**

## Decision rule

Do not increase the global polling cadence or add a permanent extra polling tier from source-count intuition alone. Use this audit plus the active/upcoming coverage audit to decide whether the current RSS + rolling playlist sweep is empirically insufficient. WebSub remains a complement/pilot path, not a replacement for the bridge.
