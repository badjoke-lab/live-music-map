# Live Music Map

R2なし・自前動画配信なしの静的MVP。

- `index.html`: 地図UI
- `data/sources.json`: 配信元プロフィール
- `data/streams.json`: 個別配信。sourceと分離

原則:
- source/streamともジャンルは複数可
- performer / venue / stream genre は確認できた場合だけ格納
- source location と event/stream location を分離
- event / stage / stream / performance を分離可能な構造にする
- R2を使用しない
- GitHub Pages / Cloudflare Pagesで静的公開可能
