-- RLS 検証（SQL Editor で実行）。anon として動かし、書き込み・非公開列が拒否されることを確認する。
-- 期待: 1・2・4 は permission denied、3 は 0、5 は 0行。（0002_fix_policies.sql 適用後に実行）

begin;
set local role anon;

-- 1) 非公開テーブルは読めない（permission denied）
select * from public.point_private limit 1;
rollback;

begin;
set local role anon;
-- 2) 申請の閲覧は不可（permission denied）
select * from public.applications limit 1;
rollback;

begin;
set local role anon;
-- 3) 地点の非公開列（status以外の投稿者情報）はなく、未承認は0件
select count(*) as pending_visible from public.points where status <> 'approved';  -- 期待: 0
select count(*) as categories_visible from public.categories;  -- 期待: 3
rollback;

begin;
set local role anon;
-- 4) 投稿RPCは anon 不可（permission denied）
select public.submit_point('general', 139.0, 35.0);
rollback;

-- 5) 全テーブルでRLSが有効か（期待: rls_off が 0行）
select relname as rls_off from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
