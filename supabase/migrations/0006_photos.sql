-- 0006: 写真アップロード（Storage バケット・ポリシー・投稿RPCの検証・地図ビューに photo_path）
-- 方針: 写真はクライアント側で縮小・再エンコード（EXIFのGPSを除去）してからアップロードする。
--       バケットは公開読み取り。パスは「<ユーザーUUID>/<ランダムUUID>.jpg」で推測不能。
--       アップロード先は自分のフォルダのみ（RLS）。サイズ2MB・JPEG/WebPのみ。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 2097152, array['image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/webp'];

create policy photos_insert_own on storage.objects for insert to authenticated
  with check (
    bucket_id = 'photos'
    and public.is_member()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy photos_delete_own on storage.objects for delete to authenticated
  using (
    bucket_id = 'photos'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- 投稿RPC: photo_path は自分のフォルダ配下の jpg/webp のみ許可（他人の写真や外部パスの紐付けを防ぐ）
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
  if p_photo_path is not null
     and p_photo_path !~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.(jpg|webp)$') then
    raise exception 'invalid photo path';
  end if;
  if (select count(*) from public.point_private pp join public.points p on p.id = pp.point_id
      where pp.created_by = auth.uid() and p.created_at > now() - interval '1 day') >= 50 then
    raise exception 'daily limit exceeded' using errcode = '54000';
  end if;
  if p_blur_m < 0 or p_blur_m > 10000 then
    raise exception 'invalid blur';
  end if;

  if p_blur_m > 0 then
    v_grid := p_blur_m / 111000.0;
    v_disp := st_translate(
      st_snaptogrid(st_setsrid(st_makepoint(p_lng, p_lat), 4326), v_grid),
      v_grid / 2, v_grid / 2)::geography;
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

-- 地図ビューに photo_path を追加（列は末尾に追加）
create or replace view public.points_map
with (security_invoker = true) as
select
  id,
  category_id,
  extensions.st_y(display_geom::extensions.geometry) as lat,
  extensions.st_x(display_geom::extensions.geometry) as lng,
  note,
  observed_at,
  extra,
  status,
  created_at,
  photo_path
from public.points;
