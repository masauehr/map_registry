# 再開メモ（2026-10-27 中断時点）

## 現在の状態
- 公開URL: https://masauehr.github.io/map_registry/ （GitHub Pages。`.github/workflows/pages.yml` が `web/` を公開。`config.js` は Actions 変数 `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` / `TURNSTILE_SITE_KEY` から生成）
- Supabase プロジェクト: map_registry（東京）。SQL 0001〜0006 適用済み、Edge Function `apply` / `approve-application` デプロイ済み（Verify JWT はOFF）。
- データ: lichens 6,692件登録済み（公開分5,863件＋自宅周辺として除外されていた829件。後者は約1kmぼかし・写真あり。正確な位置は point_private）。
- 管理者アカウントは作成済み。取り込み用 secret key は削除済み。

## 未完了（公開ページで申請・招待を動かすために必要。Supabase ダッシュボードで設定）
1. Edge Functions → Secrets: `ALLOWED_ORIGINS` = `http://localhost:8000,https://masauehr.github.io`（パス・末尾スラッシュなし）
2. Edge Functions → Secrets: `SITE_URL` = `https://masauehr.github.io/map_registry/`
3. Authentication → URL Configuration: Site URL = `https://masauehr.github.io/map_registry/`、Redirect URLs に同URLと `http://localhost:8000`
   - 閲覧・ログインは 1〜3 が無くても動く。申請フォームと招待に必要。

## 公開前に必要（優先順）
1. **本番の Turnstile**: 現在はテスト用キー（常に成功）で、実質ボット対策なし。Cloudflare（無料）でサイトキー・シークレットを作成 → `TURNSTILE_SECRET`（Edge Function Secrets）を差し替え、`TURNSTILE_SITE_KEY`（Actions 変数）を更新して再デプロイ。ホスト名に `masauehr.github.io` を登録。
2. **独自SMTP**（Resend 等）: Supabase 標準メールはチーム宛にしか届かない。Authentication → Emails → SMTP Settings。
3. 公開後に、取り込んだ除外分829件の写真（特に context の全景）に家・庭が写っていないか確認。写っていれば、該当 id の point を削除するか写真を差し替える。

## 次の候補
- 防災カテゴリの本格対応（「未確認」ラベル・公的情報へのリンク必須・位置ぼかし既定）
- 地衣類カテゴリの編集機能（種名・同定確度の後付け入力）、位置不明120件の扱い
- 管理画面（通報の確認、メンバー管理、自動公開への昇格）
- ArcGIS 互換の GeoJSON/CSV エクスポート

## 再開手順（手元）
```bash
cd ~/projects/map_registry/web && python3 -m http.server 8000   # http://localhost:8000
```
`web/config.js` が無い場合は `config.example.js` をコピーして URL・公開用キーを設定。Safari はリーダー表示・キャッシュに注意（再読み込みは ⌘+Option+R）。

## つまずきメモ
- 「Automatically expose new tables」OFF → service_role にも権限が付かない（0005で付与）。
- 新しい公開キー（sb_publishable_…）は JWT ではない → Edge Function は Verify JWT を OFF にして関数内で認証。
- geography は PostgREST で16進文字列 → 地図用ビュー points_map で lat/lng を数値化。
- API は1回1,000件まで → ページ分割＋クラスタ。
- ファイル書き換えスクリプトは「読む→書く」を分ける（同じ式で開くと空になる）。rm -rf は禁止設定。
