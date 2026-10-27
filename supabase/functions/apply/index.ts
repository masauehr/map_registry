// 登録申請の受付。Turnstile を検証してから applications に保存する（service_role で書き込み）。
// 必要なシークレット: TURNSTILE_SECRET / （任意）ALLOWED_ORIGINS（カンマ区切り）
// SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY は Supabase が自動で注入する。
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:8000").split(",").map((s) => s.trim());

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

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "invalid json" }, 400, origin); }

  const name = String(b.display_name ?? "").trim();
  const email = String(b.email ?? "").trim();
  const purpose = String(b.purpose ?? "").trim();
  const token = String(b.turnstile_token ?? "");
  if (name.length < 1 || name.length > 50) return json({ error: "表示名は1〜50文字" }, 400, origin);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return json({ error: "メールアドレスが不正です" }, 400, origin);
  if (purpose.length < 1 || purpose.length > 500) return json({ error: "利用目的は1〜500文字" }, 400, origin);
  if (!token) return json({ error: "ボット確認が必要です" }, 400, origin);

  // Turnstile 検証
  const form = new FormData();
  form.append("secret", Deno.env.get("TURNSTILE_SECRET") ?? "");
  form.append("response", token);
  const ip = req.headers.get("cf-connecting-ip");
  if (ip) form.append("remoteip", ip);
  const v = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const verdict = await v.json().catch(() => ({ success: false }));
  if (!verdict.success) return json({ error: "ボット確認に失敗しました。もう一度お試しください" }, 400, origin);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 保留中の総数に上限（洪水対策）
  const { count } = await admin.from("applications").select("id", { count: "exact", head: true }).eq("status", "pending");
  if ((count ?? 0) >= 200) return json({ error: "現在、申請を受け付けられません" }, 429, origin);

  const { error } = await admin.from("applications").insert({ display_name: name, email, purpose });
  // 重複（保留中の同一メール）でも成功扱いにし、登録有無を外部に漏らさない
  if (error && error.code !== "23505") {
    console.error(error);
    return json({ error: "送信できませんでした" }, 500, origin);
  }
  return json({ ok: true }, 200, origin);
});
