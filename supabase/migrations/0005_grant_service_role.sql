-- 0005: Edge Function（service_role）がテーブルを読み書きできるようにする
-- 「Automatically expose new tables」OFF のため、service_role にも自動付与されていない。
-- service_role はサーバー側（Edge Function）専用。フロントには置かない。

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
