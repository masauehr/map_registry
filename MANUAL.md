# map_registry — 許可制・承認制の地図登録システム

状態: Phase2 完了（写真・EXIF読み取り・lichens一括取り込み済み） ／ 作成: 2026-10-27

## 概要
lichens の地図公開の仕組みを、許可された複数人が登録できる形に拡張する構想。閲覧は誰でも、登録は招待制、公開は管理者の承認後。

## 輪島市の災害対応DX調査（要点）
- 「防災科研DXチーム×輪島市×ArcGIS」の一次資料は見つからなかった。
- 輪島市は自前で ArcGIS Online／Survey123 を利用（被害認定調査・仮設住宅申込）。
- 防災科研の取組は主に石川県向け（ISUT・BDX・SAP／Palantir）でArcGISとは別系統。
- 流用は不可。設計思想を参考に自前で作り、GeoJSON/CSVでArcGIS互換にする。

## 決定事項（2026-10-27）
- 登録者は申請制（申請→承認→招待）、投稿も承認後に公開。
- 汎用基盤として作り、地衣類→防災へ進む。
- GitHub公開リポジトリ: masauehr/map_registry

## 推奨構成
Supabase（認証・DB・画像・行単位権限）＋ Leaflet 静的フロント。投稿は保留→承認→公開。

## 詳細
プロジェクト内 `~/projects/map_registry/docs/`（research_wajima_dx.md／design.md／security.md）を参照。

## Phase1 の実装（2026-10-27）
- DB: `supabase/migrations/0001_init.sql`（テーブル・RLS・`submit_point` RPC）、`0002_fix_policies.sql`（anonでpointsが読めない不具合の修正）、`0003_points_map_view.sql`（geographyは16進で返るためlat/lng数値のビューを追加）。
- フロント: `web/`（Leaflet＋supabase-js、Vanilla JS）。`web/config.js`（URL・公開キー）はGit管理外、雛形は `config.example.js`。
- 動作: 申請→（手動）招待→ログイン→投稿→管理者が承認→公開。未ログインは承認済みのみ閲覧、正確な位置は非公開。
- 使い方: `cd web && python3 -m http.server 8000`。Safari のリーダー表示では動かない（再読み込みは ⌘+Option+R）。
- 学び: RLSポリシー内で非公開テーブルを直接参照すると anon が権限エラーになる→security definer関数に切り出す。検証SQL（`tests/0001_rls_check.sql`）で発見。
- 未実装: Turnstile、招待の自動化、写真アップロード（Phase2）。

## Phase1 完了（2026-10-27）— 申請→招待まで
- 申請は Edge Function `apply` 経由（Turnstile検証・重複防止）。承認は `approve-application`（管理者のみ、招待メール送信＋members登録）。0004で匿名の直接insertを禁止。
- 招待メールのリンクから来るとパスワード設定画面が出る。
- 動作確認: 申請→承認→招待メール受信→パスワード設定→投稿→承認→公開まで通った。
- 学び（つまずき）:
  - 「Automatically expose new tables」OFF だと service_role にも権限が付かない→0005で付与。
  - Safari のリーダー表示・キャッシュでJSが動かない（再読み込みは ⌘+Option+R）。
  - 新しい公開キー（sb_publishable_…）はJWTではないため、Edge Functionの Verify JWT は OFF にして関数内で認証。
  - Supabase標準メールはチーム宛にしか届かない→第三者招待には独自SMTPが必要。
  - 文書やHTMLを書き換えるスクリプトは「読み込み→書き込み」を分ける（同じ式で開くとファイルが空になる）。
- 未実装: 本番Turnstileキー・独自SMTP・写真アップロード（Phase2）・GitHub Pages公開。

## Phase2 完了（2026-10-27）— 写真・位置の自動読み取り・lichens一括取り込み
- 写真アップロード: ブラウザで縮小・再エンコード（EXIF除去）→ Storage `photos`（公開読み取り・2MB・JPEG/WebP・自分のフォルダのみ）。EXIFの緯度経度・標高・撮影日をブラウザ内で読み取り地図に反映、テキスト表示、写真への文字焼き込み（既定OFF・ぼかし位置を反映）も選択可。
- 地図: 1000件ずつ取得（APIの上限）＋markerClusterで表示、ポップアップは開いた時に作成。
- lichens一括取り込み（tools/import_lichens.py）: 公開分5,863件＋自宅周辺として除外されていた829件（map_localとmap_publicの差集合で判定、約1kmぼかし・写真あり）を登録。除外分は約30m四方に集中していたため1点にまとまる。正確な位置は非公開テーブルのみ。
- つまずき: ファイル名のスペース・括弧でURLエラー→安全な名前に変換＋再試行。RLS・権限・キャッシュ・JWT等は前節。
- 取り込み後: 取り込み用 secret key は削除し、.env の該当行も消す。やり直しは `delete from points where extra->>'source'='lichens'` ＋ Storage の import/lichens/ を削除。
- 未実装: 本番Turnstile・独自SMTP・GitHub Pages公開・防災カテゴリの本格対応。
