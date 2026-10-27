// Supabase 接続設定（公開しても良い値のみ。service_role キーは絶対に書かない）
window.MAP_CONFIG = {
  url: "",      // 例: https://xxxxxxxx.supabase.co（Project Settings → API）
  anonKey: "",  // 公開用キー（anon / publishable）。RLS が防御線
  // Cloudflare Turnstile のサイトキー（公開可）。下は開発用テストキー（常に成功）。本番は自分のキーに差し替え
  turnstileSiteKey: "1x00000000000000000000AA"
};
