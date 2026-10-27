// 申請の承認/却下（管理者のみ）。承認時は招待メールを送り、members に登録する。
// 呼び出し側は Authorization: Bearer <ログイン済みユーザーのアクセストークン> を付ける。
// 必要なシークレット: （任意）SITE_URL（招待リンクの戻り先）/ ALLOWED_ORIGINS
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:8000").split(",").map((s) => s.trim());
const siteUrl = Deno.env.get("SITE_URL") ?? allowed[0];

const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && allowed.includes(origin) ? origin : allowed[0],
  "Access-Control-Allow-Headers": "content-type, apikey, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, origin);
  if (origin && !allowed.includes(origin)) return json({ error: "forbidden origin" }, 403, origin);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 呼び出し元が有効な管理者か確認
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u, error: uerr } = await admin.auth.getUser(jwt);
  if (uerr || !u.user) return json({ error: "unauthorized" }, 401, origin);
  const { data: me } = await admin.from("members").select("role,active").eq("user_id", u.user.id).maybeSingle();
  if (!me || me.role !== "admin" || !me.active) return json({ error: "forbidden" }, 403, origin);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "invalid json" }, 400, origin); }
  const id = String(b.application_id ?? "");
  const action = String(b.action ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id) || !["approve", "reject"].includes(action)) return json({ error: "bad request" }, 400, origin);

  const { data: app } = await admin.from("applications").select("*").eq("id", id).eq("status", "pending").maybeSingle();
  if (!app) return json({ error: "対象の申請がありません（処理済みの可能性）" }, 404, origin);

  const stamp = { reviewed_by: u.user.id, reviewed_at: new Date().toISOString() };

  if (action === "reject") {
    await admin.from("applications").update({ status: "rejected", ...stamp }).eq("id", id);
    return json({ ok: true }, 200, origin);
  }

  // 招待メール送信 → members に登録 → 申請を承認済みに
  const { data: inv, error: ierr } = await admin.auth.admin.inviteUserByEmail(app.email, {
    redirectTo: siteUrl,
    data: { display_name: app.display_name },
  });
  if (ierr || !inv.user) {
    console.error(ierr);
    return json({ error: "招待に失敗: " + (ierr?.message ?? "不明") }, 500, origin);
  }
  const { error: merr } = await admin.from("members").insert({ user_id: inv.user.id, role: "member", display_name: app.display_name });
  if (merr) {
    console.error(merr);
    return json({ error: "メンバー登録に失敗: " + merr.message }, 500, origin);
  }
  await admin.from("applications").update({ status: "approved", ...stamp }).eq("id", id);
  return json({ ok: true }, 200, origin);
});
