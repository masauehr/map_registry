-- 0003: 地図表示用ビュー。geography は PostgREST で16進文字列になるため、lat/lng の数値で返す。
-- security_invoker により、points の RLS（承認済み＋本人＋管理者）がそのまま適用される。
-- 公開されるのは display_geom（ぼかし後）由来の座標のみ。point_private は参照しない。

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
  created_at
from public.points;

revoke all on public.points_map from anon, authenticated;
grant select on public.points_map to anon, authenticated;
