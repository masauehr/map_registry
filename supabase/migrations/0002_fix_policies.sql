-- 0002: points/categories の閲覧ポリシーが anon で権限エラーになる問題を修正
-- 原因: ポリシー内で point_private を直接参照 / is_admin() の実行権限を anon から外していた
-- 対策: 所有者判定を security definer 関数に切り出し、判定用関数だけ anon にも実行を許可する
--       （どれも未ログインなら false を返すだけで、データは返さない）

create or replace function public.is_point_owner(p_point_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.point_private
    where point_id = p_point_id and created_by = auth.uid()
  );
$$;

revoke all on function public.is_point_owner(uuid) from public;
grant execute on function public.is_point_owner(uuid) to anon, authenticated;
grant execute on function public.is_admin() to anon;
grant execute on function public.is_member() to anon;

drop policy points_select on public.points;
create policy points_select on public.points for select to anon, authenticated
  using (
    status = 'approved'
    or public.is_admin()
    or public.is_point_owner(id)
  );

drop policy points_owner_delete on public.points;
create policy points_owner_delete on public.points for delete to authenticated
  using (public.is_point_owner(id));
