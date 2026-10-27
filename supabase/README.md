# supabase/ — DB定義

- `migrations/0001_init.sql` — テーブル・RLS・投稿RPC・初期カテゴリ
- `migrations/0002_fix_policies.sql` — anon で points が読めない問題の修正（0001の後に適用）
- `migrations/0003_points_map_view.sql` — 地図用ビュー（lat/lng を数値で返す）。0002の後に適用
- `tests/0001_rls_check.sql` — 公開前のRLS検証

## 適用手順（ダッシュボード）
1. Supabase の SQL Editor で `0001_init.sql`、`0002_fix_policies.sql`、`0003_points_map_view.sql` の全文を貼り付けて Run。
2. `0001_rls_check.sql` を **1ブロックずつ** 実行し、期待どおり（エラー or 0件）か確認。
3. 最初の管理者: Authentication → Users で自分を追加（Add user）し、SQL Editor で次を実行。
   `<ユーザーUUID>` は Users 画面に表示される ID。メールアドレスはここに書かない。
   ```sql
   insert into public.members (user_id, role, display_name) values ('<ユーザーUUID>', 'admin', '管理者');
   ```

## 補足
- 公開側の位置は `display_geom`（ぼかし後）のみ。正確な位置と投稿者は `point_private`（本人・管理者のみ）。
- 申請者への招待メール送信は `service_role` が必要なため、Edge Function で実装する（Phase4）。キーはフロントに置かない。
- 申請フォームのボット対策（Turnstile）とレート制限は Edge Function 側で追加予定。

## Edge Functions（申請の受付・承認と招待）
- `functions/apply/index.ts` — 申請の受付。Turnstile を検証してから保存。
- `functions/approve-application/index.ts` — 承認/却下（管理者のみ）。承認で招待メール送信＋`members`登録。
- `migrations/0004_applications_via_function.sql` — 匿名の直接insertを禁止（0003の後に適用）。

### デプロイ手順（ダッシュボードのみ・CLI不要）
1. SQL Editor で `0004_applications_via_function.sql` を実行。
2. **Edge Functions → Deploy a new function → Via Editor** で、関数名 `apply` を作り、`functions/apply/index.ts` を貼り付けて Deploy。同様に `approve-application` も作成。
3. 各関数の設定（Details/Settings）で **「Verify JWT」をOFF**（新しい公開キーはJWTではないため。認証は関数内で行う）。
4. **Edge Functions → Secrets** に登録（値はチャットに貼らない）:
   - `TURNSTILE_SECRET` — 開発中はテスト用の `1x0000000000000000000000000000000AA`（常に成功）。本番は Cloudflare で作った Secret key。
   - `ALLOWED_ORIGINS` — 例: `http://localhost:8000`（本番公開時は公開URLを追加、カンマ区切り）。
   - `SITE_URL`（任意）— 招待リンクの戻り先。
5. Authentication → URL Configuration の **Site URL / Redirect URLs** に、画面のURL（開発中は `http://localhost:8000`）を登録。

### 注意（招待メール）
Supabase 標準のメール送信は、**自分のチーム（組織メンバー）宛にしか届かず**、1時間あたりの件数も少ない。第三者に招待を送るには、Authentication → Emails → SMTP Settings で独自SMTP（Resend・SendGrid 等）を設定する。
