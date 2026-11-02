# 公開前チェックリスト（公開ページで申請・招待を使えるようにする）

画面操作の手順つき版は [supabase_setup_guide.md](supabase_setup_guide.md)。

点検ツール: `python3 tools/check_public.py`（書き込みは起こさない）。**すべて OK になれば公開準備完了。** 2026-11-02 時点の結果は 7 OK / 4 NG / 1 注意。

## 1. サインアップを無効にする（最優先・セキュリティ）
現状は**有効**で、公開用キーを知っていれば誰でも API からアカウントを作れる（投稿は members でないとできないが、確認メールの悪用や不要なユーザーが増える）。
- Supabase → Authentication → **Sign In / Providers**（または Settings）→ 「**Allow new users to sign up**」を **OFF**。
- 管理者からの招待（`approve-application`）は、サインアップ無効でも動く。

## 2. Supabase の設定（公開ページで申請・招待を動かす）
- Edge Functions → Secrets
  - `ALLOWED_ORIGINS` = `http://localhost:8000,https://masauehr.github.io`（パス・末尾スラッシュなし）
  - `SITE_URL` = `https://masauehr.github.io/map_registry/`
- Authentication → URL Configuration
  - Site URL = `https://masauehr.github.io/map_registry/`
  - Redirect URLs に同URLと `http://localhost:8000`

## 3. 本番の Turnstile（ボット対策）
現在はテスト用キー（常に成功）で、実質ボット対策なし。
1. Cloudflare の無料アカウントを作る → Turnstile → サイトを追加。ホスト名は `masauehr.github.io`（手元確認用に `localhost` も可）。ウィジェットは Managed。
2. **サイトキー（公開してよい）**: GitHub の Actions 変数 `TURNSTILE_SITE_KEY` を更新（リポジトリ → Settings → Secrets and variables → Actions → Variables）。更新後、Actions の「Deploy Pages」を手動実行して反映（または `web/` を変更して push）。
3. **シークレットキー（秘密）**: Supabase の Edge Functions → Secrets の `TURNSTILE_SECRET` を差し替える。チャットや文書には書かない。

## 4. 独自 SMTP（第三者への招待メール）
Supabase 標準のメールは、チームのメンバー宛にしか届かず、件数も少ない。招待を他の人へ送るには独自 SMTP が必要。
- Authentication → Emails → **SMTP Settings** で Custom SMTP を有効にする。
- 選択肢:
  - **Gmail**（少人数向け・手軽）: ホスト `smtp.gmail.com`、ポート 465、ユーザー=Gmailアドレス、パスワード=**アプリパスワード**（2段階認証を有効にして発行。通常のパスワードは使わない）。1日の送信上限あり。送信元はそのGmailアドレスになる。
  - **Resend など**（本格運用）: 自分のドメインの認証（DNS の SPF/DKIM）が必要。ドメインが無い間は、自分宛にしか送れない。
- 招待メール（Invite user）の文面は、Authentication → Emails → Templates で日本語に直せる。
- メール送信の頻度制限は Authentication → Rate Limits で確認・調整する。

## 5. 点検と通し確認
1. `python3 tools/check_public.py` → すべて OK（Turnstile の注意も消える）。
2. 公開ページで、**別のメールアドレス**を使って、申請 → 承認 → 招待メール受信 → パスワード設定 → 投稿 → 承認、まで通す。

## 6. 公開後の運用
- 保留の申請は上限200件。管理者が定期的に承認・却下する。
- 個人情報（申請者のメール・利用目的）は `applications` のみ。不要になった申請は削除する。
- 秘密鍵（secret key）は使うときだけ作り、終わったら削除する。`.env` に古いキーを残さない。
