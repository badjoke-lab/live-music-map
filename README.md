# Live Music Map

R2なし・自前動画配信なしの地図型MVP。

## Public site

https://badjoke-lab.github.io/live-music-map/

## Data

- `data/sources.json`: 配信元プロフィール。国・地域・都市・source type・source-level genres・配信形式・schedule pattern・music-live判定方針・YouTube識別子を保持する。
- `data/streams.json`: YouTube LIVE / upcoming の個別配信。sourceと分離し、配信ごとに `music_live_status` / `content_type` / 判定根拠を保持する。
- `data/stream-history.json`: 実際に `live` として観測した verified music stream の履歴。Upcomingだけで終了したものは履歴件数に含めない。
- `data/source-stats.json`: sourceごとのLIVE中件数・Upcoming件数・観測LIVE累計・7日/30日件数・active days・last/next liveと、国/source type/source genre/content type別集計。
- `data/acquisition.json`: 自動取得方式・取得間隔・classifier version。
- `data/youtube-state.json`: Atom feed差分検知用の生成state。

## YouTube acquisition

通常の新着発見は登録チャンネルのYouTube公式Atom feedを15分ごとに確認する。Atom feed自体はYouTube Data API quotaを消費しない。

新規・更新動画と既知のLIVE / upcomingだけを `videos.list` でまとめて確認する。`search.list` は使用しない。1日1回、uploads playlistを取りこぼし補完として確認する。

GitHub Actions secret `YOUTUBE_API_KEY` が未設定ならデータを変更せず正常終了する。

## Music-live classification

AIは使用しない。新しいLIVE / upcomingごとにルールベースで判定する。

- source側の `music_live_policy.mode`: `music_only` または `mixed`
- source固有の allow / deny title patterns
- 共通の明示的な音楽ライブ語（concert / live session / DJ set / festival等）
- YouTube Music categoryは補助証拠だけに使い、単独では確定しない
- `mixed` sourceで判定不能なら `music_live_status: unknown`
- talk / interview / podcast / news等は `rejected`
- 公開地図に出すのは `music_live_status: verified` のみ

## Source record rules

- `type`: radio / festival / studio_media / media_events / independent_media 等の運営形態
- `country_code`, `region`, `city`, `location.precision`: 地理集計用
- `genres[]`: sourceが通常扱うジャンル。個別streamへ自動コピーしない
- `formats[]`: dj_set / live_performance / studio_session / festival_stream / concert 等
- `schedule_pattern`: continuous / recurring / event_based / seasonal / mixed
- `lifecycle_status`: active / inactive等のsource状態
- `music_live_policy`: 個別streamを音楽ライブとして扱うための非AIルール
- `verification`: official channel / music-live capability / last verified date
- `acquisition`: 自動取得の有効状態・方式・優先度

これらのfieldにより国・都市・source type・source genre・配信形式・schedule pattern別のsource集計が可能。

## Stream record rules

- `source_id` でsourceへ紐付ける
- `status`: live / upcoming
- `scheduled_start`, `actual_start`, `actual_end`
- `concurrent_viewers`
- `embed_allowed`
- `youtube_category_id`
- `music_live_status`: verified / rejected / unknown
- `content_type`: live_performance / dj_set / concert / festival_stream / studio_session / interview / talk 等
- `music_live_decision`, `music_live_evidence`, `classifier_version`
- performer / venue / stream genre / stream locationは確認できた場合だけ格納

## History and derived statistics

Refresh前のactive stream集合を一時snapshotし、refresh後に消えたレコードのうち、以前に `music_live_status=verified` かつ `status=live` と実観測できたものだけをhistoryへ移す。Upcomingだっただけの配信は歴史上のLIVE件数として数えない。

`source-stats.json` はhistoryと現在のverified streamから生成する。主なfieldは以下。

- `live_now`
- `upcoming_count`
- `observed_live_streams_total`
- `observed_live_streams_7d`
- `observed_live_streams_30d`
- `active_days_30d`
- `last_live_at`
- `next_live_at`
- `observed_content_types[]`

集計は `by_country` / `by_source_type` / `by_source_genre` / `by_verified_stream_content_type_30d` を生成する。`by_source_genre` はsource coverageの集計であり、verified stream genreとは混同しない。

YouTubeが終了時刻を返す前にactive集合から消えた場合、`actual_end` は推測せず `null` のままにして `ended_observed_at` を別fieldで保持する。

## Data rules

- source / stream ともジャンルは複数可
- source-level genre を個別streamへ自動コピーしない
- performer / venue / stream genre は確認できた場合だけ格納
- 不明値は推測で埋めず `null` / `[]` / `unknown` のままにする
- source location と event / stream location を分離する
- Boiler Roomのような巡回イベントはoperator所在地をevent所在地として扱わない
- YouTube動画は公式embedを使用し、自前保存しない
- R2を使用しない

## Hosting

GitHub Pagesで公開。YouTube refreshでgenerated dataが変わった場合は同じworkflow内でPagesまでdeployする。
