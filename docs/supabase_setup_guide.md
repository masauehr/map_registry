# Supabase 公開設定ガイド（手順つき）

公開ページ（https://masauehr.github.io/map_registry/）で申請・招待を動かすための設定を、画面操作の順に書く。要点だけの一覧は [launch_checklist.md](launch_checklist.md)。
作成: 2026-11-02 ／ 画面の名前は Supabase・Cloudflare の更新で変わることがある。**実画面では未確認**。見つからないときは、近い名前の項目を探す。

## 進める順番
1. サインアップを OFF（最優先・5分）
2. Secrets と URL Configuration（10分）
3. 本番 Turnstile（15分）
4. 独自 SMTP（20分）
5. 通し確認

## 守ること
- **シークレットキー・アプリパスワードは、チャットや文書に書かない。** 入れる場所は Supabase の Secrets／SMTP 設定の欄だけ。
- 公開してよいのは Turnstile の**サイトキー**だけ。
- 設定を変えるたびに、保存ボタンを押したか確認する（画面を閉じると消える）。

---

## 1. サインアップを OFF にする（最優先）
**目的**: 公開用キーを知っている人が、API から勝手にアカウントを作れないようにする。

1. Supabase ダッシュボード → プロジェクト **map_registry** を開く。
2. 左メニュー **Authentication** → **Sign In / Providers**（古い画面では **Settings**）。
3. 「**Allow new users to sign up**」を **OFF** にして **Save**。
4. 確認: `python3 tools/check_public.py` で、サインアップの項目が OK になる。

**影響**: 管理者からの招待（`approve-application`）は、サインアップ OFF でも動く。既存のユーザーは変わらない。

---

## 2. Secrets と URL Configuration
**目的**: 公開ページから申請フォーム・招待メールが動くようにする。

### 2-1. Edge Functions の Secrets
1. 左メニュー **Edge Functions** → **Secrets**（画面上部のタブ。見つからなければ Project Settings 内）。
2. 次の2つを追加して保存する。

| 名前 | 値 | 注意 |
|---|---|---|
| `ALLOWED_ORIGINS` | `http://localhost:8000,https://masauehr.github.io` | カンマ区切り。**パスや末尾の `/` は付けない** |
| `SITE_URL` | `https://masauehr.github.io/map_registry/` | 招待メールのリンク先。こちらは末尾 `/` あり |

3. Secrets を変えたあと、反映に数十秒かかることがある。反映されないときは、Edge Function（`apply`・`approve-application`）を再デプロイする。

### 2-2. Authentication の URL Configuration
1. 左メニュー **Authentication** → **URL Configuration**。
2. **Site URL** = `https://masauehr.github.io/map_registry/`
3. **Redirect URLs** に次の2つを追加する。
   - `https://masauehr.github.io/map_registry/`
   - `http://localhost:8000`
4. **Save**。

**確認**: 公開ページの申請フォームでエラー（CORS）が出なくなる。

---

## 3. 本番の Turnstile（ボット対策）
**今の状態**: テスト用キー（常に成功）なので、ボット対策になっていない。

### 3-1. Cloudflare でキーを作る
1. Cloudflare の無料アカウントを作る（作成済みなら不要）。
2. ダッシュボード → **Turnstile** → **Add widget**（サイトを追加）。
3. 入力:
   - Widget name: `map_registry`
   - Hostname: `masauehr.github.io`（手元確認用に `localhost` も追加してよい）
   - Widget Mode: **Managed**
4. 作成すると2つのキーが出る。
   - **Site Key（サイトキー）**: 公開してよい
   - **Secret Key（シークレットキー）**: 秘密

### 3-2. シークレットキーを Supabase に入れる
- Supabase → Edge Functions → Secrets の `TURNSTILE_SECRET` を、Cloudflare のシークレットキーで**上書き**する。

### 3-3. サイトキーを GitHub に入れる
1. GitHub の `map_registry` リポジトリ → Settings → Secrets and variables → Actions → **Variables**。
2. `TURNSTILE_SITE_KEY` を、Cloudflare のサイトキーに更新する。
3. Actions の **Deploy Pages** を手動実行する（または `web/` を変更して push）。サイトキーは公開してよいので、Claude に伝えて更新を頼んでもよい。

### 3-4. 取り違えに注意
- Supabase の Authentication にも「CAPTCHA protection」の設定があるが、**別物**。この仕組みの Turnstile は Edge Function（`apply`）が検証するので、そちらは設定しない。
- サイトキーとシークレットキーを逆に入れると、申請が必ず失敗する。

**確認**: 公開ページの申請フォームで、Turnstile の部品が表示され、送信が通る。

---

## 4. 独自 SMTP
**理由**: Supabase 標準のメールは、チームのメンバー宛にしか届かず、件数も少ない。第三者に招待を送るには必要。

### 4-1. Gmail（少人数向け・手軽）
1. 送信用に使う Google アカウントで **2段階認証**を有効にする。
2. Google アカウント → セキュリティ → **アプリ パスワード**で、新しいパスワード（16文字）を発行する。名前は `supabase-map-registry` など。通常のパスワードは使わない。
3. Supabase → **Authentication** → **Emails** → **SMTP Settings** → **Enable Custom SMTP** を ON。
4. 入力:

| 項目 | 値 |
|---|---|
| Sender email | 送信に使う Gmail アドレス |
| Sender name | `map_registry` など |
| Host | `smtp.gmail.com` |
| Port | `465` |
| Username | Gmail アドレス |
| Password | 発行したアプリパスワード |

5. **Save**。

**制限**: 1日の送信数に上限がある。送信元は、そのGmailアドレスになる。本格運用になったら Resend などと自分のドメイン（SPF/DKIM の設定が必要）に移る。

### 4-2. 仕上げ
- 招待メール（Invite user）の文面は、Authentication → Emails → **Templates** で日本語に直せる。
- 送信の頻度制限は Authentication → **Rate Limits** で確認する。

---

## 5. 通し確認
1. `python3 tools/check_public.py` → すべて OK（Turnstile の注意も消える）。
2. 公開ページで、**別のメールアドレス**を使って次を通す。
   申請 → 管理者が承認 → 招待メール受信 → パスワード設定 → ログイン → 投稿 → 承認

## つまずいたとき
| 症状 | 原因の候補 |
|---|---|
| 申請フォームで CORS エラー | `ALLOWED_ORIGINS` の綴り・末尾 `/`・Secrets の反映待ち |
| 申請が「確認に失敗」 | `TURNSTILE_SECRET` と `TURNSTILE_SITE_KEY` が別のウィジェットのもの、または取り違え |
| 招待メールが届かない | SMTP の保存忘れ、アプリパスワードの誤り、迷惑メール、送信上限 |
| 招待メールのリンクが違う場所へ飛ぶ | `SITE_URL`・Site URL・Redirect URLs |
| ブラウザで Turnstile が出ない | Cloudflare の Hostname に `masauehr.github.io` が未登録 |

## 終わったあと
- 取り込みなどで作った一時 secret key は削除し、`.env` の行も消す。
- 保留の申請は上限200件。定期的に承認・却下する。
