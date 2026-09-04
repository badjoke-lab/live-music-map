# YouTube WebSub Prototype

Status: implementation-ready prototype, not yet the production primary discovery path
Last updated: 2026-09-04

## Purpose

Reduce dependence on 15-minute polling and playlist backstops by receiving YouTube channel upload/update notifications through the official PubSubHubbub/WebSub path.

The official YouTube topic URL for a channel is:

`https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID`

The Google hub is:

`https://pubsubhubbub.appspot.com/subscribe`

## Controlled prototype scope

Initial Sources:

- `hoer-berlin`
- `the-lot-radio`
- `dommune`
- `kexp`
- `boiler-room`

The Worker allowlist is intentionally limited to these five canonical channel IDs. Unknown channels fail closed.

## Data path

`YouTube hub -> Cloudflare Worker callback -> GitHub repository_dispatch -> targeted videos.list -> data/streams.json -> history/stats -> main -> GitHub Pages`

A notification carries `yt:videoId` and `yt:channelId`. The GitHub workflow processes only the notified video ID with `videos.list`; it does not perform a 130-Source discovery sweep.

## Worker

Files:

- `websub/worker.mjs`
- `websub/wrangler.toml`

Callback path defaults to `/youtube`.

Required Worker secret:

- `GITHUB_DISPATCH_TOKEN` — fine-grained token able to call repository dispatch for this repository.

Required signature secret:

- `WEBSUB_SECRET` — sent as `hub.secret` when subscribing and used to verify `X-Hub-Signature` on incoming notifications.

Public configuration:

- `GITHUB_REPOSITORY=badjoke-lab/live-music-map`
- `CALLBACK_PATH=/youtube`
- `PROTOTYPE_CHANNEL_IDS=<comma-separated five channel IDs>`

Do not commit secret values.

## GitHub-driven deployment

`.github/workflows/deploy-websub-worker.yml` is the supported deployment path. It deploys the Worker, installs Worker secrets, resolves the account workers.dev subdomain, smoke-tests the callback challenge endpoint, and requests subscriptions for all five prototype Sources.

Configure these repository Actions secrets once:

- `CLOUDFLARE_API_TOKEN` — Cloudflare API token scoped to this account with Workers Scripts Write permission.
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account ID.
- `WEBSUB_GITHUB_DISPATCH_TOKEN` — fine-grained GitHub token for `badjoke-lab/live-music-map` able to create repository dispatch events.
- `WEBSUB_SECRET` — a separate high-entropy random secret for WebSub HMAC verification; do not reuse either API token.

Then run `Deploy WebSub Worker prototype` with `workflow_dispatch`.

The workflow intentionally does not run on every push because a code merge must not silently create or rotate external Cloudflare state. A successful run records the concrete workers.dev callback URL in the Actions job summary.

## Subscription

The deploy workflow requests subscriptions automatically. For a manual re-subscribe, use:

`WEBSUB_CALLBACK_URL=https://.../youtube WEBSUB_SECRET=... node scripts/websub-subscribe.mjs`

The callback must answer the hub verification GET request by returning `hub.challenge`. A subscription is not considered proven until that verification and at least one real notification have been observed.

## GitHub processing

`.github/workflows/websub-notification.yml` listens for repository-dispatch event type `youtube_websub`.

It validates the channel/video IDs, snapshots history, calls `scripts/process-websub-video.mjs`, rebuilds history/stats, and commits only when data changed. The existing Pages workflow deploys the resulting main push.

## Source onboarding change

`scripts/apply-source-batch.mjs` must not call YouTube `search.list`.

Channel resolution is limited to canonical channel IDs plus low-cost `channels.list` handle/username resolution. If a custom URL cannot resolve through those methods, onboarding fails and the canonical channel ID must be pinned explicitly.

New Sources are not separately live-seeded during onboarding. The normal Atom/playlist/videos.list refresh handles discovery immediately after a batch is applied.

## Prototype exit proof

Do not call the WebSub prototype complete until all are true:

1. Worker is deployed at a stable HTTPS callback URL.
2. Hub verification succeeds for all five Sources.
3. At least one real YouTube notification reaches the Worker.
4. The notification produces a GitHub `youtube_websub` repository-dispatch run.
5. That run uses one targeted `videos.list` request for the notified video.
6. Any resulting stream/history/stat change is committed and Pages deployment succeeds.
7. Lease/renewal behavior is measured from the actual verification response rather than guessed.
