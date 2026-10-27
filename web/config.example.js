// Supabase 接続設定（公開しても良い値のみ。service_role キーは絶対に書かない）
window.MAP_CONFIG = {
  url: "",      // 例: https://xxxxxxxx.supabase.co（Project Settings → API）
  anonKey: ""   // 公開用キー（anon / publishable）。RLS が防御線
};
