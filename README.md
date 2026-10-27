# map_registry — 許可制・承認制の地図登録システム

詳しくは [MANUAL.md](MANUAL.md) も参照。

状態: **Phase0（調査・設計）** ／ 作成: 2026-10-27 ／ 詳しくは [docs/research_wajima_dx.md](docs/research_wajima_dx.md)・[docs/design.md](docs/design.md)・[docs/security.md](docs/security.md) を参照。

## 目的
[lichens](../lichens/) の「地図にデータを登録して公開する」仕組みを、**許可された複数人が登録できる形**に広げる。閲覧は誰でも、登録は招待制、公開は管理者の承認後。災害時の情報共有（輪島市の例）にも応用できる設計を目指す。

## 決定事項（2026-10-27）
- 登録者は**申請制**: 申請→管理者が承認→招待→投稿可。投稿自体も承認後に公開。
- **汎用**の地図登録基盤として作る。カテゴリは設定で可変にし、その後に**地衣類**・**防災**の用途へ進む。
- リポジトリは**公開**。秘密情報（キー・個人の座標・個人情報）はコミットしない。

## 調査の要点（輪島市の災害対応DX）
- 「防災科研DXチームの輪島市向けArcGIS」という資料は**見つからず**。
- 輪島市は自前で ArcGIS Online／Survey123 を使用（被害認定調査・仮設住宅申込）。
- 防災科研の取組は主に石川県向け（ISUT・BDX・SAP／Palantir）で、ArcGISとは別系統。
- そのまま流用は不可。**設計思想を参考に自前で作り、GeoJSON/CSVでArcGISと互換**にする。

## 推奨構成
Supabase（認証・DB・画像・行単位権限）＋ Leaflet 静的フロント（GitHub Pages）。投稿は「保留」→管理者承認→公開。

## ドキュメント
| ファイル | 内容 |
|---|---|
| [docs/research_wajima_dx.md](docs/research_wajima_dx.md) | 輪島市DX調査・流用可否の評価 |
| [docs/design.md](docs/design.md) | 構成案比較・データモデル・Phase計画 |
| [docs/security.md](docs/security.md) | 脅威と対策・公開前チェックリスト |

## 次のステップ
1. 登録申請フォーム・承認フローの詳細設計
2. 防災クロスビュー等の利用規約確認
3. Phase1: Supabase構築と最小の地図＋投稿フォーム
