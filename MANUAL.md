# map_registry — 許可制・承認制の地図登録システム

状態: Phase0（調査・設計のみ、コード未着手） ／ 作成: 2026-10-27

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
