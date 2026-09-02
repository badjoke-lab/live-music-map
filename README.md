# Live Music Map

R2なし・自前動画配信なしの地図型MVP。

## Public site

https://badjoke-lab.github.io/live-music-map/

## Data

- `data/sources.json`: 配信元プロフィール
- `data/streams.json`: YouTube LIVE / upcoming を含む個別配信。sourceと分離
- `data/acquisition.json`: 自動取得の有効状態と取得間隔

## YouTube acquisition

`scripts/refresh-youtube-live.mjs` が YouTube Data API v3 を使い、登録済みsourceごとに `eventType=live` / `eventType=upcoming` を検索し、`videos.list` の `liveStreamingDetails` で予定・実開始時刻などを取得する。

GitHub Actions secret `YOUTUBE_API_KEY` が未設定ならデータを変更せず正常終了する。設定後は次の頻度で取得する。

- LIVE: 3時間ごと
- Upcoming: 12時間ごと

初期6 sourceでは全世界検索を行わず、登録source単位でAPI quotaを抑える。source数を増やす際は同じ頻度を無制限に横展開しない。

## Data rules

- source / stream ともジャンルは複数可
- source-level genre を個別streamへ自動コピーしない
- performer / venue / stream genre は確認できた場合だけ格納
- 不明値は推測で埋めず `null` / `[]` のままにする
- source location と event / stream location を分離する
- event / stage / stream / performance を分離可能な構造にする
- Boiler Roomのような巡回イベントはoperator所在地をevent所在地として扱わない
- YouTube動画は公式embedを使用し、自前保存しない
- R2を使用しない

## Hosting

GitHub Pagesで公開。`main`へのpushで `.github/workflows/pages.yml` がdeployする。
