-- 0004: 申請の受付を Edge Function 経由に限定（Turnstile 検証・重複防止のため）
-- 匿名からの直接 insert を禁止する。function は service_role で書き込む。

drop policy if exists applications_insert on public.applications;
revoke insert on public.applications from anon, authenticated;

-- 同じメールの保留中申請は1件まで（連投・重複の抑止）
create unique index if not exists applications_pending_email_uq
  on public.applications (lower(email)) where status = 'pending';
