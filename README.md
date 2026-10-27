# map_registry — 許可制・承認制の地図登録システム

詳しくは [MANUAL.md](MANUAL.md) も参照。

状態: **Phase2 完了（申請→承認→招待→投稿→公開、写真・EXIF読み取り、lichens 6,692件の一括取り込みまで動作確認済み）** ／ 作成: 2026-10-27 ／ 詳しくは [docs/research_wajima_dx.md](docs/research_wajima_dx.md)・[docs/design.md](docs/design.md)・[docs/security.md](docs/security.md) を参照。

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

## 使い方（手元）
1. Supabase にプロジェクトを作り、`supabase/migrations/` の SQL（0001→0002→0003）を順に実行（[supabase/README.md](supabase/README.md)）。
2. `web/config.example.js` を `web/config.js` にコピーし、Project URL と公開用キーを設定（Git管理外）。
3. `cd web && python3 -m http.server 8000` → http://localhost:8000
   - Safari のリーダー表示では動かない。再読み込みは ⌘+Option+R。

## 実装済み（Phase1）
地図表示（国土地理院）／登録申請（Turnstile＋Edge Function）／招待メール自動送信／パスワード設定／ログイン／投稿（カテゴリ別の追加項目・位置ぼかし）／管理者の承認・却下。未ログインは承認済みのみ閲覧。RLS検証済み。

SQLは0001〜0005、Edge Functionは `supabase/functions/`（デプロイ手順は [supabase/README.md](supabase/README.md)）。

## Phase2（写真・一括取り込み）
詳細は [docs/phase2_photos_import.md](docs/phase2_photos_import.md)。写真アップロード（EXIF除去・縮小）と、lichens 公開データの一括取り込みツール（`tools/import_lichens.py`）。

## 次のステップ
1. 公開前: Turnstile を本番キーに差し替え、独自SMTP（第三者への招待に必須）、GitHub Pages公開時のキーの渡し方・ALLOWED_ORIGINS・Site URL
2. Phase2: 写真アップロード（EXIF除去・縮小）、`?probe=1` 相当
3. 地衣類カテゴリの本格対応 → 防災カテゴリ
4. 防災クロスビュー等の利用規約確認
