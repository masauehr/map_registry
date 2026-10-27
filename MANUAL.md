# map_registry — 許可制・承認制の地図登録システム

状態: Phase1 実装済み（Supabase＋最小フロント、動作確認済み） ／ 作成: 2026-10-27

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
