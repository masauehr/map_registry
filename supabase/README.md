# supabase/ — DB定義

- `migrations/0001_init.sql` — テーブル・RLS・投稿RPC・初期カテゴリ
- `migrations/0002_fix_policies.sql` — anon で points が読めない問題の修正（0001の後に適用）
- `tests/0001_rls_check.sql` — 公開前のRLS検証

## 適用手順（ダッシュボード）
1. Supabase の SQL Editor で `0001_init.sql`、続けて `0002_fix_policies.sql` の全文を貼り付けて Run。
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
