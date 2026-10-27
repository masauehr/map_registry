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
let inviteFlow = /type=(invite|recovery)/.test(location.hash);  // 招待メールのリンクから来たか

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

const photoUrl = path => `${cfg.url}/storage/v1/object/public/photos/${path.split("/").map(encodeURIComponent).join("/")}`;

// 写真を長辺1600px以内のJPEGに再エンコードする。canvasを通すのでEXIF（GPS含む）は残らない。
async function shrinkPhoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = el("canvas", { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(ok => c.toBlob(ok, "image/jpeg", 0.82));
  if (!blob || blob.size > 2 * 1024 * 1024) throw new Error("写真が大きすぎます");
  return blob;
}

async function loadCategories() {
  const { data } = await sb.from("categories").select("id,name,fields").order("id");
  categories = data || [];
  filterEl.replaceChildren(el("option", { value: "", textContent: "すべて" }),
    ...categories.map(c => el("option", { value: c.id, textContent: c.name })));
}

async function loadPoints() {
  layer.clearLayers();
  let q = sb.from("points_map").select("id,category_id,note,observed_at,extra,status,lat,lng,photo_path");
  if (filterEl.value) q = q.eq("category_id", filterEl.value);
  const { data, error } = await q.limit(2000);
  if (error) { console.error(error); return; }
  (data || []).forEach(p => {
    const { lat, lng } = p;
    const color = p.status === "approved" ? "#1f77b4" : "#e67e22";
    const m = L.circleMarker([lat, lng], { radius: 7, color, fillOpacity: 0.7 }).addTo(layer);
    const cat = categories.find(c => c.id === p.category_id);
    const photo = p.photo_path ? el("img", { src: photoUrl(p.photo_path), loading: "lazy", alt: "", style: "max-width:220px;max-height:220px;display:block;margin:4px 0" }) : "";
    const body = el("div", {},
      el("b", { textContent: (cat ? cat.name : p.category_id) + (p.status === "approved" ? "" : "（未承認）") }),
      el("div", { textContent: new Date(p.observed_at).toLocaleString("ja-JP") }),
      photo,
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
  if (me && inviteFlow) { setPasswordPanel(); return; }
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

let tsScript = null;  // Turnstile のスクリプトを1回だけ読み込む
const loadTurnstile = () => tsScript ||= new Promise((ok, ng) => {
  const sc = el("script", { src: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", async: true });
  sc.onload = ok; sc.onerror = ng; document.head.append(sc);
});

function applyPanel() {
  const name = el("input", { maxLength: 50 });
  const email = el("input", { type: "email", maxLength: 200 });
  const purpose = el("textarea", { rows: 4, maxLength: 500 });
  const widget = el("div");
  const out = el("div");
  const go = el("button", { textContent: "申請する" });
  let token = "";
  go.onclick = async () => {
    if (!token) { out.replaceChildren(msg("「ロボットではありません」の確認を完了してください")); return; }
    go.disabled = true;
    try {
      const res = await fetch(`${cfg.url}/functions/v1/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: cfg.anonKey },
        body: JSON.stringify({ display_name: name.value.trim(), email: email.value.trim(),
          purpose: purpose.value.trim(), turnstile_token: token })
      });
      const j = await res.json().catch(() => ({}));
      out.replaceChildren(res.ok ? msg("申請を受け付けました。承認後に招待メールが届きます", true) : msg(j.error || "送信できませんでした"));
      if (!res.ok && window.turnstile) window.turnstile.reset();
    } catch (e) { out.replaceChildren(msg("通信に失敗しました")); }
    go.disabled = false;
  };
  showPanel(el("h3", { textContent: "登録申請" }),
    el("p", { textContent: "投稿するには管理者の承認が必要です。連絡先は公開されません。" }),
    el("label", { textContent: "表示名" }), name, el("label", { textContent: "連絡先メール" }), email,
    el("label", { textContent: "利用目的" }), purpose, widget, el("p", {}, go), out);
  loadTurnstile().then(() => window.turnstile.render(widget, {
    sitekey: cfg.turnstileSiteKey, callback: t => { token = t; }, "expired-callback": () => { token = ""; } }))
    .catch(() => out.replaceChildren(msg("ボット確認を読み込めませんでした")));
}

// 招待メールのリンクから来たユーザーにパスワードを設定させる
function setPasswordPanel() {
  const pw = el("input", { type: "password", autocomplete: "new-password", minLength: 12 });
  const out = el("div");
  const go = el("button", { textContent: "パスワードを設定" });
  go.onclick = async () => {
    if (pw.value.length < 12) { out.replaceChildren(msg("12文字以上にしてください")); return; }
    const { error } = await sb.auth.updateUser({ password: pw.value });
    if (error) { out.replaceChildren(msg("設定できませんでした: " + error.message)); return; }
    inviteFlow = false; history.replaceState(null, "", location.pathname);
    await refreshMe();
  };
  showPanel(el("h3", { textContent: "ようこそ" }), el("p", { textContent: "ログイン用のパスワードを設定してください（12文字以上）。" }),
    el("label", { textContent: "新しいパスワード" }), pw, el("p", {}, go), out);
}

function showPostPanel() {
  const cat = el("select", {}, ...categories.map(c => el("option", { value: c.id, textContent: c.name })));
  const note = el("textarea", { rows: 3, maxLength: 1000 });
  const blur = el("select", {}, ...[[0, "ぼかさない"], [500, "約500m"], [1000, "約1km"], [5000, "約5km"]]
    .map(([v, t]) => el("option", { value: v, textContent: t })));
  const extraBox = el("div");
  const photoIn = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp" });
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
    let photoPath = null;
    if (photoIn.files[0]) {
      try {
        const blob = await shrinkPhoto(photoIn.files[0]);
        photoPath = `${me.user.id}/${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from("photos").upload(photoPath, blob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
      } catch (e) { out.replaceChildren(msg("写真を処理できませんでした（JPEG/PNG推奨）: " + e.message)); return; }
    }
    const { error } = await sb.rpc("submit_point", {
      p_category: cat.value, p_lng: picked.lng, p_lat: picked.lat, p_note: note.value,
      p_photo_path: photoPath, p_extra: extra, p_blur_m: Number(blur.value) });
    if (error) { out.replaceChildren(msg("投稿できませんでした: " + error.message)); return; }
    out.replaceChildren(msg("投稿しました（承認後に公開されます）", true));
    note.value = ""; photoIn.value = ""; await loadPoints();
  };
  const nodes = [el("h3", { textContent: "地点を登録" }), el("label", { textContent: "カテゴリ" }), cat,
    el("label", { textContent: "メモ" }), note, extraBox,
    el("label", { textContent: "写真（任意・位置情報は自動で削除）" }), photoIn, el("label", { textContent: "公開位置のぼかし" }), blur,
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
    if (table === "applications") {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(`${cfg.url}/functions/v1/approve-application`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: cfg.anonKey, Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ application_id: id, action: status === "approved" ? "approve" : "reject" })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { panel.prepend(msg("失敗: " + (j.error || res.status))); return; }
      adminPanel(); return;
    }
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
    el("p", { textContent: "承認すると招待メールが送られ、メンバーに登録されます。" }),
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
