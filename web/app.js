// map_registry フロント（Vanilla JS）。表示はすべて textContent で行い、HTMLを挿入しない（XSS対策）
const cfg = window.MAP_CONFIG;
const panel = document.getElementById("panel");
const whoEl = document.getElementById("who");
const filterEl = document.getElementById("filter");

if (!cfg.url || !cfg.anonKey) {
  document.body.textContent = "web/config.js に Supabase の url と anonKey を設定してください。";
  throw new Error("config 未設定");
}
const sb = supabase.createClient(cfg.url, cfg.anonKey);

// 地図（国土地理院 淡色地図）
const map = L.map("map").setView([36.5, 138], 5);
L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
  attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>', maxZoom: 18
}).addTo(map);
const layer = L.layerGroup().addTo(map);

let me = null;          // { user, member }
let categories = [];
let picked = null;      // 投稿位置 {lat,lng}
let pickMarker = null;

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  kids.forEach(k => e.append(k));
  return e;
};
const showPanel = (...nodes) => { panel.replaceChildren(...nodes); panel.hidden = false; map.invalidateSize(); };
const hidePanel = () => { panel.hidden = true; map.invalidateSize(); };
const msg = (text, ok) => el("div", { className: "msg" + (ok ? " ok" : ""), textContent: text });

async function loadCategories() {
  const { data } = await sb.from("categories").select("id,name,fields").order("id");
  categories = data || [];
  filterEl.replaceChildren(el("option", { value: "", textContent: "すべて" }),
    ...categories.map(c => el("option", { value: c.id, textContent: c.name })));
}

async function loadPoints() {
  layer.clearLayers();
  let q = sb.from("points_map").select("id,category_id,note,observed_at,extra,status,lat,lng");
  if (filterEl.value) q = q.eq("category_id", filterEl.value);
  const { data, error } = await q.limit(2000);
  if (error) { console.error(error); return; }
  (data || []).forEach(p => {
    const { lat, lng } = p;
    const color = p.status === "approved" ? "#1f77b4" : "#e67e22";
    const m = L.circleMarker([lat, lng], { radius: 7, color, fillOpacity: 0.7 }).addTo(layer);
    const cat = categories.find(c => c.id === p.category_id);
    const body = el("div", {},
      el("b", { textContent: (cat ? cat.name : p.category_id) + (p.status === "approved" ? "" : "（未承認）") }),
      el("div", { textContent: new Date(p.observed_at).toLocaleString("ja-JP") }),
      el("div", { textContent: p.note }),
      el("div", { textContent: Object.entries(p.extra || {}).map(([k, v]) => `${k}: ${v}`).join(" / ") }));
    m.bindPopup(body);
  });
}

async function refreshMe() {
  const { data: { session } } = await sb.auth.getSession();
  me = null;
  if (session) {
    const { data } = await sb.from("members").select("role,display_name,active").eq("user_id", session.user.id).maybeSingle();
    me = { user: session.user, member: data };
  }
  whoEl.textContent = me ? (me.member ? `${me.member.display_name}（${me.member.role}）` : "登録者ではありません") : "";
  document.getElementById("btnLogin").textContent = me ? "ログアウト" : "ログイン";
  if (me && me.member && me.member.active) showPostPanel(); else if (!me) hidePanel();
}

function loginPanel() {
  const email = el("input", { type: "email", autocomplete: "username" });
  const pw = el("input", { type: "password", autocomplete: "current-password" });
  const out = el("div");
  const go = el("button", { textContent: "ログイン" });
  go.onclick = async () => {
    const { error } = await sb.auth.signInWithPassword({ email: email.value, password: pw.value });
    if (error) out.replaceChildren(msg("ログインに失敗しました"));
    else await refreshMe();
  };
  showPanel(el("h3", { textContent: "ログイン" }), el("label", { textContent: "メール" }), email,
    el("label", { textContent: "パスワード" }), pw, el("p", {}, go), out);
}

function applyPanel() {
  const name = el("input", { maxLength: 50 });
  const email = el("input", { type: "email", maxLength: 200 });
  const purpose = el("textarea", { rows: 4, maxLength: 500 });
  const out = el("div");
  const go = el("button", { textContent: "申請する" });
  go.onclick = async () => {
    const { error } = await sb.from("applications").insert({
      display_name: name.value.trim(), email: email.value.trim(), purpose: purpose.value.trim() });
    out.replaceChildren(error ? msg("送信できませんでした。入力内容を確認してください") : msg("申請を受け付けました。承認後に連絡します", true));
  };
  showPanel(el("h3", { textContent: "登録申請" }),
    el("p", { textContent: "投稿するには管理者の承認が必要です。連絡先は公開されません。" }),
    el("label", { textContent: "表示名" }), name, el("label", { textContent: "連絡先メール" }), email,
    el("label", { textContent: "利用目的" }), purpose, el("p", {}, go), out);
}

function showPostPanel() {
  const cat = el("select", {}, ...categories.map(c => el("option", { value: c.id, textContent: c.name })));
  const note = el("textarea", { rows: 3, maxLength: 1000 });
  const blur = el("select", {}, ...[[0, "ぼかさない"], [500, "約500m"], [1000, "約1km"], [5000, "約5km"]]
    .map(([v, t]) => el("option", { value: v, textContent: t })));
  const extraBox = el("div");
  const pos = el("div", { textContent: "地図をクリックして位置を選んでください" });
  const out = el("div");
  const renderExtra = () => {
    const c = categories.find(x => x.id === cat.value);
    extraBox.replaceChildren(...((c && c.fields) || []).flatMap(f => [
      el("label", { textContent: f.label }),
      f.type === "select"
        ? el("select", { name: f.key }, ...f.options.map(o => el("option", { value: o, textContent: o })))
        : el("input", { name: f.key, maxLength: 200 })]));
  };
  cat.onchange = renderExtra; renderExtra();
  const go = el("button", { textContent: "投稿する" });
  go.onclick = async () => {
    if (!picked) { out.replaceChildren(msg("位置を選んでください")); return; }
    const extra = {};
    extraBox.querySelectorAll("[name]").forEach(i => { if (i.value) extra[i.name] = i.value; });
    const { error } = await sb.rpc("submit_point", {
      p_category: cat.value, p_lng: picked.lng, p_lat: picked.lat, p_note: note.value,
      p_extra: extra, p_blur_m: Number(blur.value) });
    if (error) { out.replaceChildren(msg("投稿できませんでした: " + error.message)); return; }
    out.replaceChildren(msg("投稿しました（承認後に公開されます）", true));
    note.value = ""; await loadPoints();
  };
  const nodes = [el("h3", { textContent: "地点を登録" }), el("label", { textContent: "カテゴリ" }), cat,
    el("label", { textContent: "メモ" }), note, extraBox, el("label", { textContent: "公開位置のぼかし" }), blur,
    pos, el("p", {}, go), out];
  if (me.member.role === "admin") nodes.push(el("hr"), el("button", { textContent: "承認待ちを確認", onclick: adminPanel }));
  showPanel(...nodes);
  map.off("click", onPick); map.on("click", onPick);
  function onPick(e) {
    picked = e.latlng;
    if (pickMarker) pickMarker.remove();
    pickMarker = L.marker(picked).addTo(map);
    pos.textContent = `選択位置: ${picked.lat.toFixed(5)}, ${picked.lng.toFixed(5)}（正確な位置は管理者と本人のみ）`;
  }
}

async function adminPanel() {
  const { data: pts } = await sb.from("points").select("id,category_id,note,observed_at").eq("status", "pending").order("created_at");
  const { data: apps } = await sb.from("applications").select("id,display_name,purpose,created_at").eq("status", "pending").order("created_at");
  const act = (table, id, status) => async () => {
    panel.prepend(msg("処理中…（" + status + "）", true));
    try { await doAct(table, id, status); } catch (e) { console.error(e); panel.prepend(msg("例外: " + e.message)); }
  };
  const doAct = async (table, id, status) => {
    const { data, error } = await sb.from(table)
      .update(table === "points" ? { status } : { status, reviewed_at: new Date().toISOString(), reviewed_by: me.user.id })
      .eq("id", id).select("id");
    if (error || !data || data.length === 0) {
      // 失敗の理由を画面に出す（RLSで0件更新のときもここに来る）
      console.error("承認/却下に失敗", error, data);
      panel.prepend(msg("更新できませんでした: " + (error ? error.message : "対象が更新されませんでした（権限を確認）")));
      return;
    }
    await loadPoints(); adminPanel();
  };
  const list = (rows, table, label) => (rows || []).map(r => el("div", { className: "item" },
    el("div", { textContent: label(r) }),
    el("button", { textContent: "承認", onclick: act(table, r.id, "approved") }),
    el("button", { textContent: "却下", onclick: act(table, r.id, "rejected") })));
  showPanel(el("h3", { textContent: "承認待ちの地点" }),
    ...list(pts, "points", r => `${r.category_id}: ${r.note}`),
    el("h3", { textContent: "登録申請" }),
    el("p", { textContent: "承認後、Authentication で招待し members に追加します（手動）。" }),
    ...list(apps, "applications", r => `${r.display_name}: ${r.purpose}`),
    el("button", { textContent: "戻る", onclick: showPostPanel }));
}

document.getElementById("btnLogin").onclick = async () => {
  if (me) { await sb.auth.signOut(); await refreshMe(); await loadPoints(); } else loginPanel();
};
document.getElementById("btnApply").onclick = applyPanel;
filterEl.onchange = loadPoints;
sb.auth.onAuthStateChange(() => { refreshMe().then(loadPoints); });

(async () => { await loadCategories(); await refreshMe(); await loadPoints(); })();
