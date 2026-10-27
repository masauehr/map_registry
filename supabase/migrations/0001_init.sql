-- map_registry 初期スキーマ（Phase1）
-- 方針: 公開側は承認済み・ぼかし後の位置のみ。正確な位置と投稿者は非公開テーブルに分離する。
-- 前提: 「Automatically expose new tables」OFF / 「Enable automatic RLS」ON。公開範囲は下の grant で明示する。

create extension if not exists postgis with schema extensions;

-- ========== テーブル ==========

-- 登録者（申請が承認され、招待されたユーザー）
create table public.members (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  role         text not null default 'member' check (role in ('admin', 'member')),
  display_name text not null check (char_length(display_name) between 1 and 50),
  active       boolean not null default true,
  auto_publish boolean not null default false, -- 実績のある人は承認なしで公開（昇格）
  created_at   timestamptz not null default now()
);

-- 登録申請（連絡先は非公開。管理者のみ閲覧）
create table public.applications (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 1 and 50),
  email        text not null check (char_length(email) between 5 and 200 and email like '%_@_%'),
  purpose      text not null check (char_length(purpose) between 1 and 500),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by  uuid references auth.users (id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- カテゴリ（汎用化の要。用途ごとの追加項目は fields に JSON で定義）
create table public.categories (
  id      text primary key check (id ~ '^[a-z][a-z0-9_]{1,30}$'),
  name    text not null,
  fields  jsonb not null default '[]'::jsonb, -- 例: [{"key":"species","label":"種名","type":"text"}]
  enabled boolean not null default true
);

-- 地点（公開側。位置はぼかし後のみ）
create table public.points (
  id           uuid primary key default gen_random_uuid(),
  category_id  text not null references public.categories (id),
  display_geom extensions.geography(Point, 4326) not null,
  note         text not null default '' check (char_length(note) <= 1000),
  photo_path   text,
  observed_at  timestamptz not null default now(),
  extra        jsonb not null default '{}'::jsonb,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at   timestamptz not null default now()
);
create index points_display_geom_idx on public.points using gist (display_geom);
create index points_status_idx on public.points (status);

-- 地点の非公開情報（正確な位置・投稿者）
create table public.point_private (
  point_id   uuid primary key references public.points (id) on delete cascade,
  geom       extensions.geography(Point, 4326) not null,
  created_by uuid not null references auth.users (id)
);
create index point_private_created_by_idx on public.point_private (created_by);

-- 通報
create table public.reports (
  id         uuid primary key default gen_random_uuid(),
  point_id   uuid not null references public.points (id) on delete cascade,
  reason     text not null check (char_length(reason) between 1 and 500),
  reporter   uuid references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.members       enable row level security;
alter table public.applications  enable row level security;
alter table public.categories    enable row level security;
alter table public.points        enable row level security;
alter table public.point_private enable row level security;
alter table public.reports       enable row level security;

-- ========== 補助関数 ==========

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members
    where user_id = auth.uid() and role = 'admin' and active
  );
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members where user_id = auth.uid() and active
  );
$$;

-- ========== RLS ポリシー ==========

-- members: 自分の行は本人、全件は管理者。変更は管理者のみ（招待時は service_role）
create policy members_select on public.members for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy members_admin_write on public.members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- applications: 誰でも申請可（pending固定）。閲覧・審査は管理者のみ
create policy applications_insert on public.applications for insert to anon, authenticated
  with check (status = 'pending' and reviewed_by is null and reviewed_at is null);
create policy applications_admin on public.applications for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- categories: 有効なものは誰でも閲覧、編集は管理者
create policy categories_select on public.categories for select to anon, authenticated
  using (enabled or public.is_admin());
create policy categories_admin_write on public.categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- points: 承認済みは誰でも、自分の投稿と管理者は全件。直接の insert は不可（submit_point 経由）
create policy points_select on public.points for select to anon, authenticated
  using (
    status = 'approved'
    or public.is_admin()
    or exists (select 1 from public.point_private p where p.point_id = points.id and p.created_by = auth.uid())
  );
create policy points_admin_update on public.points for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy points_admin_delete on public.points for delete to authenticated
  using (public.is_admin());
create policy points_owner_delete on public.points for delete to authenticated
  using (exists (select 1 from public.point_private p where p.point_id = points.id and p.created_by = auth.uid()));

-- point_private: 本人と管理者のみ
create policy point_private_select on public.point_private for select to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- reports: 登録者は通報のみ可、閲覧は管理者
create policy reports_insert on public.reports for insert to authenticated
  with check (public.is_member() and reporter = auth.uid());
create policy reports_admin on public.reports for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ========== 権限（grant）: 明示した分だけ公開 ==========

revoke all on all tables in schema public from anon, authenticated;

grant select on public.categories to anon, authenticated;
grant select (id, category_id, display_geom, note, photo_path, observed_at, extra, status, created_at)
  on public.points to anon, authenticated;
grant update (status) on public.points to authenticated;          -- 承認/却下（RLSで管理者のみ）
grant delete on public.points to authenticated;
grant select on public.point_private to authenticated;
grant select on public.members to authenticated;
grant insert, update, delete on public.members to authenticated;  -- RLSで管理者のみ
grant insert on public.applications to anon, authenticated;
grant select, update, delete on public.applications to authenticated; -- RLSで管理者のみ
grant insert on public.reports to authenticated;
grant select, update, delete on public.reports to authenticated;  -- RLSで管理者のみ
grant insert, update, delete on public.categories to authenticated; -- RLSで管理者のみ

-- ========== 投稿用RPC（位置のぼかしをサーバー側で強制） ==========

create or replace function public.submit_point(
  p_category text,
  p_lng double precision,
  p_lat double precision,
  p_note text default '',
  p_photo_path text default null,
  p_observed_at timestamptz default now(),
  p_extra jsonb default '{}'::jsonb,
  p_blur_m integer default 0
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_member public.members;
  v_id uuid := gen_random_uuid();
  v_grid double precision;
  v_disp geography;
begin
  select * into v_member from public.members where user_id = auth.uid() and active;
  if not found then
    raise exception 'not a registered member' using errcode = '42501';
  end if;
  if p_lng not between -180 and 180 or p_lat not between -90 and 90 then
    raise exception 'invalid coordinates';
  end if;
  if not exists (select 1 from public.categories where id = p_category and enabled) then
    raise exception 'invalid category';
  end if;
  -- 1日あたりの投稿上限（簡易レート制限）
  if (select count(*) from public.point_private pp join public.points p on p.id = pp.point_id
      where pp.created_by = auth.uid() and p.created_at > now() - interval '1 day') >= 50 then
    raise exception 'daily limit exceeded' using errcode = '54000';
  end if;
  if p_blur_m < 0 or p_blur_m > 10000 then
    raise exception 'invalid blur';
  end if;

  if p_blur_m > 0 then
    v_grid := p_blur_m / 111000.0;  -- 度への概算
    v_disp := st_translate(
      st_snaptogrid(st_setsrid(st_makepoint(p_lng, p_lat), 4326), v_grid),
      v_grid / 2, v_grid / 2)::geography;  -- 格子の中心に置く
  else
    v_disp := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  end if;

  insert into public.points (id, category_id, display_geom, note, photo_path, observed_at, extra, status)
  values (v_id, p_category, v_disp, coalesce(p_note, ''), p_photo_path, p_observed_at,
          coalesce(p_extra, '{}'::jsonb),
          case when v_member.auto_publish then 'approved' else 'pending' end);
  insert into public.point_private (point_id, geom, created_by)
  values (v_id, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, auth.uid());
  return v_id;
end;
$$;

revoke all on function public.submit_point(text, double precision, double precision, text, text, timestamptz, jsonb, integer) from public, anon;
grant execute on function public.submit_point(text, double precision, double precision, text, text, timestamptz, jsonb, integer) to authenticated;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_member() to authenticated;

-- ========== 初期カテゴリ（汎用 → 地衣類・防災へ拡張） ==========
insert into public.categories (id, name, fields) values
  ('general', '汎用', '[]'),
  ('lichen',  '地衣類', '[{"key":"species","label":"種名","type":"text"},{"key":"confidence","label":"同定確度","type":"select","options":["確定","暫定","不明"]}]'),
  ('disaster','防災', '[{"key":"kind","label":"種別","type":"text"},{"key":"verified","label":"確認状況","type":"select","options":["未確認","確認済み"]}]');
