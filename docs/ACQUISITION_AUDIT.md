# Acquisition audit

Generated: 2026-09-05T20:31:13.708Z

This is the M3 production audit for the YouTube acquisition path. It samples the latest 10 completed `youtube-refresh.yml` runs whose **refresh job itself succeeded**, even if a later Pages deployment failed for an unrelated reason.

## Runtime

- p50: **83s**
- p95: **126s**
- max: **126s**

## Estimated YouTube Data API quota

- p50: **110 units/run**
- p95: **186 units/run**
- max: **186 units/run**
- total across sample: **1382 units**

The estimate counts logged `channels.list`, `playlistItems.list`, and `videos.list` calls at one unit each. Official Atom feed fetches cost zero YouTube Data API quota units. The rolling sweep estimate also counts one `videos.list` call per targeted processor. `search.list` is not used by this refresh path.

## Reliability

- RSS fetches: **1390**
- RSS failures: **312** (22.45%)
- rolling playlist failures: **0**
- stream/source channel mismatches removed: **0**
- source preservations caused by failed detail batches: **0**
- source count represented in sample: **160–176**

## Decision rule

Do not increase the global polling cadence or add a permanent extra polling tier from source-count intuition alone. Use this audit plus the active/upcoming coverage audit to decide whether the current RSS + rolling playlist sweep is empirically insufficient. WebSub remains a complement/pilot path, not a replacement for the bridge.
