# YouTube WebSub Prototype

Status: parked after upstream subscription failure; not a production discovery path
Last updated: 2026-09-04

## Decision

Do not promote YouTube WebSub / PubSubHubbub to the production primary discovery path at this time.

The prototype implementation itself reached a working deployed callback, but the official Google hub did not accept subscriptions in production proof runs.

The production acquisition path remains Atom where available plus bounded uploads-playlist fallback, daily playlist backstop, and targeted/batched `videos.list` checks. Normal acquisition still does not use `search.list`.

## Production proof result

Controlled prototype Sources:

- `hoer-berlin`
- `the-lot-radio`
- `dommune`
- `kexp`
- `boiler-room`

Final proof run:

- GitHub Actions run: `33841446486`
- job: `100924409585`
- Worker deploy: success
- Worker secret injection: success
- workers.dev callback resolution: success
- callback challenge smoke test: success
- subscription requests: failed for all five Sources
- hub result: HTTP 503 for every Source, including retry
- hub response body: `Transient error; please try again later`
- summary: `accepted=0 failed=5 total=5`

This demonstrates that the local Worker/callback path was not the blocking component. The unresolved blocker is the upstream subscription endpoint behavior observed in the production proof.

## Deployed prototype components

Repository files retained for evidence and possible future re-evaluation:

- `websub/worker.mjs`
- `websub/wrangler.toml`
- `scripts/websub-subscribe.mjs`
- `scripts/process-websub-video.mjs`
- `.github/workflows/websub-notification.yml`
- `.github/workflows/websub-prototype-check.yml`

The manual deployment/subscription workflow is removed while the prototype is parked so operators are not encouraged to repeat a known-failing subscription procedure.

The previously deployed Worker may remain externally until it is deliberately removed from Cloudflare. Its existence does not make WebSub an active production acquisition path.

## Prototype design retained for reference

The intended data path was:

`YouTube hub -> Cloudflare Worker callback -> GitHub repository_dispatch -> targeted videos.list -> data/streams.json -> history/stats -> main -> GitHub Pages`

A valid notification would carry `yt:videoId` and `yt:channelId`. The GitHub workflow is designed to process only the notified video ID with `videos.list`, without performing a global Source discovery sweep.

Callback path defaults to `/youtube`.

Worker secrets used by the prototype:

- `GITHUB_DISPATCH_TOKEN`
- `WEBSUB_SECRET`

Public configuration:

- `GITHUB_REPOSITORY=badjoke-lab/live-music-map`
- `CALLBACK_PATH=/youtube`
- `PROTOTYPE_CHANNEL_IDS=<comma-separated five channel IDs>`

Do not commit secret values.

## Source onboarding rule remains active

`scripts/apply-source-batch.mjs` must not call YouTube `search.list`.

Channel resolution is limited to canonical channel IDs plus low-cost `channels.list` handle/username resolution. If a custom URL cannot resolve through those methods, onboarding fails and the canonical channel ID must be pinned explicitly.

New Sources are not separately live-seeded during onboarding. Normal production acquisition handles discovery after a batch is applied.

## Re-evaluation gate

Do not reactivate this prototype merely because time has passed.

A future re-evaluation must begin with a fresh, bounded proof against the official hub. WebSub may be reconsidered only if all of the following are demonstrated again with real production traffic:

1. stable HTTPS callback is deployed;
2. the official hub accepts subscriptions for multiple independent Sources;
3. verification succeeds for those Sources;
4. at least one real YouTube notification reaches the Worker;
5. the notification produces a GitHub `youtube_websub` repository-dispatch run;
6. the run uses one targeted `videos.list` request for the notified video;
7. any resulting stream/history/stat change is committed and Pages deployment succeeds;
8. lease/renewal behavior is measured from actual hub responses.

Until those gates are met, WebSub is an archived prototype, not an operational dependency.
