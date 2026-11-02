# map_registry — 許可制・承認制の地図登録システム

状態: Phase2 完了・GitHub Pages公開済み（申請・招待の公開設定と本番Turnstileは未了） ／ 作成: 2026-10-27

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

## GitHub Pages 公開（2026-10-27）と中断時点の状態
- 公開URL: https://masauehr.github.io/map_registry/ 。`.github/workflows/pages.yml` が `web/` を公開し、`config.js` は Actions 変数（SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / TURNSTILE_SITE_KEY）から生成。
- 未完了: 公開ページで申請・招待を動かすための Supabase 設定（Secrets の ALLOWED_ORIGINS・SITE_URL、Authentication の Site URL/Redirect URLs）。
- 公開前に必要: 本番 Turnstile（現在はテスト用キーで実質ボット対策なし）、独自SMTP、取り込んだ除外分の写真の目視確認。
- 詳細・再開手順は `map_registry/docs/resume.md`。

## 背景地図の切り替えと標高表示（2026-11-02）
- 背景を切り替え可能（右上のレイヤー選択）: 淡色地図・標準地図・航空写真・**色別標高図**・**陰影起伏図**（以上、国土地理院）・OpenStreetMap。背景に重ねる「陰影起伏図（半透明）」も選べる。lichens の方式と同じ。
- **標高の表示**: 地図の点のポップアップに標高を表示。地図の何もない所をクリックすると、その地点の緯度・経度・標高を表示。投稿で位置を選ぶと、選んだ地点の標高も出る（投稿の位置選択中は、クリックは位置選択に使う）。
- 標高は国土地理院の標高API（日本国内のみ。海上・範囲外は「データなし」）。点の公開位置（ぼかし後）の座標をそのまま送る。同じ地点は再取得しない。
- 色別標高図はz15、陰影起伏図はz16まで（それ以上は拡大表示）。出典は国土地理院（画面右下に表示）。

## 位置の信頼度（要確認マーク）（2026-11-02）
- きっかけ: 慶良間諸島の南の海上に、2024-03-24の地衣類が登録されていた。原因は、GPSの無いデジカメ写真の位置を「同じ日のiPhone写真のうち最も近い時刻のもの」から借りたこと（時間差約2.7時間、参照先は海上）。写真は本物の地衣類で、位置のみ誤り。
- 調べた結果、推定位置のうち海上は47枚（2024-03-24・09-14・10-13）。要確認111件・推定2,138件。
- 地図で「要確認」を赤い破線の丸で表示し、ポップアップに理由を表示。標高データなし（海上など）の位置は、印がなくても自動で警告。投稿時も「位置が不確か」を付けられる（海上なら自動チェック）。
- 登録済みの点に印を付けるツール `tools/flag_locations.py` を作成（**2026-11-02 に反映済み**）。
- 今後の修正予定と反映手順は `docs/location_quality.md`（位置の確認と修正、推定ロジックの改善、絞り込み、管理者の位置修正機能など）。

- **2026-11-02 追記**: 登録済みの点への印の反映を実施（要確認111件・推定2,138件、海上47件を含む。位置・写真は変更なし）。残る課題は、47枚の本来の位置の確認と、推定ロジックの改善（`docs/location_quality.md`）。

## 位置推定の改善・要確認の絞り込み・公開前点検（2026-11-02）
- **推定ロジックの改善**: lichens の推定方法（補間・最寄り・引き継ぎ・同日・手動）と、参照写真との時間差を使って信頼度を判定。`tools/flag_locations.py --est-loc ../lichens/work/est_loc.json` で、要確認 = 同日・手動／引き継ぎで時間差が2時間超（`--carry-warn-sec`で変更）／海上、推定 = 補間・最寄り・時間差の小さい引き継ぎ。ドライランでは、要確認542件・推定1,707件（従来は111件・2,138件）。ポップアップに「推定（引き継ぎ・参照写真と約○分差）」を表示。**閾値の決定と反映は未実施**。
- lichens 側: `estimate_locations.py` に `--sameday-max`（同日規則の時間差の上限。既定0=無制限）、`build_map.py` は method・gap を photos.json に出力。いずれも**再生成するまで反映されない**（未実行）。
- **要確認の絞り込み**: 画面上部の「位置」で「すべて／要確認のみ／要確認を除く」。件数表示と凡例（赤い破線＝要確認）を追加。
- **個人情報の取り扱い**の説明を申請フォームに追加。
- **公開前の点検**: `tools/check_public.py`（書き込みなし）と `docs/launch_checklist.md`。点検の結果、**サインアップが有効のまま**・ALLOWED_ORIGINS 未設定・Turnstile がテスト用、が判明（あなたの設定が必要）。
