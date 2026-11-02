// map_registry フロント（Vanilla JS）。表示はすべて textContent で行い、HTMLを挿入しない（XSS対策）
const cfg = window.MAP_CONFIG;
const panel = document.getElementById("panel");
const whoEl = document.getElementById("who");
const filterEl = document.getElementById("filter");
const locFilterEl = document.getElementById("locFilter");
const locCountEl = document.getElementById("locCount");

if (!cfg.url || !cfg.anonKey) {
  document.body.textContent = "web/config.js に Supabase の url と anonKey を設定してください。";
  throw new Error("config 未設定");
}
const sb = supabase.createClient(cfg.url, cfg.anonKey);
let inviteFlow = /type=(invite|recovery)/.test(location.hash);  // 招待メールのリンクから来たか

// 地図: 背景を切り替えられる（国土地理院タイル中心。標高がわかる色別標高図・陰影起伏図を含む）
const gsiAttr = '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>';
const gsi = (name, ext, opt) => L.tileLayer(`https://cyberjapandata.gsi.go.jp/xyz/${name}/{z}/{x}/{y}.${ext}`, { attribution: gsiAttr, ...opt });
const baseLayers = {
  "淡色地図（地理院）": gsi("pale", "png", { maxZoom: 18 }),
  "標準地図（地理院）": gsi("std", "png", { maxZoom: 18 }),
  "航空写真（地理院）": gsi("seamlessphoto", "jpg", { maxZoom: 19 }),
  "色別標高図（地理院）": gsi("relief", "png", { maxNativeZoom: 15, maxZoom: 19 }),
  "陰影起伏図（地理院）": gsi("hillshademap", "png", { maxNativeZoom: 16, maxZoom: 19 }),
  "OpenStreetMap": L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors", maxZoom: 19 }),
};
// 背景に重ねて地形の凹凸を見せる（半透明）
const overlayLayers = {
  "陰影起伏図を重ねる（半透明）": gsi("hillshademap", "png", { maxNativeZoom: 16, maxZoom: 19, opacity: 0.45 }),
};
const map = L.map("map", { layers: [baseLayers["淡色地図（地理院）"]] }).setView([36.5, 138], 5);
L.control.layers(baseLayers, overlayLayers).addTo(map);
const layer = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 50 }).addTo(map);  // 多数の点をまとめて表示

// 標高（国土地理院の標高API。日本国内のみ。同じ地点は再取得しない）
const elevCache = new Map();
function getElevation(lat, lng) {
  const key = lat.toFixed(5) + "," + lng.toFixed(5);
  if (!elevCache.has(key)) {
    elevCache.set(key, fetch(`https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=${lng}&lat=${lat}&outtype=JSON`)
      .then(r => r.json()).then(j => (typeof j.elevation === "number" ? j.elevation : null)).catch(() => null));
  }
  return elevCache.get(key);
}
const fmtElev = v => (v === null ? "標高 データなし（海上・範囲外など）" : `標高 ${v.toFixed(1)} m`);
// 位置の信頼度は extra に持つ。LOC_KEY の値は「要確認」（位置が不確か）か「推定」（撮影時刻などから推定）
const LOC_KEY = "位置", LOC_NOTE = "位置メモ", LOC_METHOD = "位置方法", LOC_GAP = "位置時間差(分)";
const LOC_KEYS = [LOC_KEY, LOC_NOTE, LOC_METHOD, LOC_GAP];  // 位置の信頼度に関する項目（属性の一覧には出さず、専用の表示にする）
// 凡例
const legend = L.control({ position: "bottomleft" });
legend.onAdd = () => {
  const d = L.DomUtil.create("div", "legend");
  d.innerHTML = '<div><span class="dot" style="border:2px solid #1f77b4;background:#1f77b4aa"></span>承認済み</div>'
    + '<div><span class="dot" style="border:2px solid #e67e22;background:#e67e22aa"></span>未承認（自分・管理者のみ）</div>'
    + '<div><span class="dot" style="border:2px dashed #c0392b;background:#fff8"></span>位置要確認</div>';
  return d;
};
legend.addTo(map);
let picking = false;  // 投稿パネルで位置を選んでいる間は、地図クリックを位置選択に使う

// 地図をクリックすると、その地点の緯度・経度・標高を表示する（投稿の位置選択中を除く。点・クラスタのクリックは対象外）
map.on("click", async e => {
  if (picking) return;
  const { lat, lng } = e.latlng;
  const body = t => `緯度 ${lat.toFixed(5)}<br>経度 ${lng.toFixed(5)}<br>${t}`;
  const pop = L.popup().setLatLng(e.latlng).setContent(body("標高 取得中…")).openOn(map);
  pop.setContent(body(fmtElev(await getElevation(lat, lng))));
});

let me = null;          // { user, member }
let categories = [];
let picked = null;      // 投稿位置 {lat,lng}
let pickMarker = null;

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  kids.forEach(k => e.append(k));
  return e;
};
const showPanel = (...nodes) => { picking = false; panel.replaceChildren(...nodes); panel.hidden = false; map.invalidateSize(); };
const hidePanel = () => { picking = false; panel.hidden = true; map.invalidateSize(); };
const msg = (text, ok) => el("div", { className: "msg" + (ok ? " ok" : ""), textContent: text });

const photoUrl = path => `${cfg.url}/storage/v1/object/public/photos/${path.split("/").map(encodeURIComponent).join("/")}`;

// 写真を長辺1600px以内のJPEGに再エンコードする。canvasを通すのでEXIF（GPS含む）は残らない。
async function shrinkPhoto(file, stampLines = []) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = el("canvas", { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  const ctx = c.getContext("2d");
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  if (stampLines.length) {  // 下部に半透明の帯を敷き、位置・標高・日時を文字で入れる
    const fs = Math.max(14, Math.round(c.width / 38)), pad = Math.round(fs * 0.5);
    ctx.font = `${fs}px sans-serif`;
    const h = stampLines.length * fs * 1.25 + pad * 2;
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, c.height - h, c.width, h);
    ctx.fillStyle = "#fff"; ctx.textBaseline = "top";
    stampLines.forEach((t, i) => ctx.fillText(t, pad, c.height - h + pad + i * fs * 1.25));
  }
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

// APIは1回に最大1000件しか返さないため、ページに分けて全件を読む
async function fetchAllPoints() {
  const size = 1000, all = [];
  for (let from = 0; ; from += size) {
    let q = sb.from("points_map").select("id,category_id,note,observed_at,extra,status,lat,lng,photo_path").order("id");
    if (filterEl.value) q = q.eq("category_id", filterEl.value);
    const { data, error } = await q.range(from, from + size - 1);
    if (error) { console.error(error); break; }
    all.push(...data);
    if (data.length < size) break;
  }
  return all;
}

let lastData = [];
async function loadPoints() { lastData = await fetchAllPoints(); renderPoints(); }

// 位置の絞り込み: すべて／要確認のみ／要確認を除く
function renderPoints() {
  layer.clearLayers();
  const mode = locFilterEl.value;
  const isUncertain = p => (p.extra || {})[LOC_KEY] === "要確認";
  const data = lastData.filter(p => mode === "" || (mode === "uncertain" ? isUncertain(p) : !isUncertain(p)));
  const nUnc = lastData.filter(isUncertain).length;
  locCountEl.textContent = nUnc ? `位置要確認 ${nUnc}件` : "";
  const markers = data.map(p => {
    const x = p.extra || {};
    const uncertain = x[LOC_KEY] === "要確認";
    const color = uncertain ? "#c0392b" : (p.status === "approved" ? "#1f77b4" : "#e67e22");
    const m = L.circleMarker([p.lat, p.lng], uncertain
      ? { radius: 8, color, weight: 2, dashArray: "3 3", fillColor: "#fff", fillOpacity: 0.5, bubblingMouseEvents: false }
      : { radius: 7, color, fillOpacity: 0.7, bubblingMouseEvents: false });
    // ポップアップの中身は開いたときに作る（件数が多くても軽くする。画像もこの時点で初めて読み込まれる）
    // popup.update() は内容を作る関数をもう一度呼ぶ。毎回作り直すと「標高取得→update→作り直し…」が無限に続くため、1回だけ作って使い回す
    let cachedBody = null;
    m.bindPopup(() => {
      if (cachedBody) return cachedBody;
      const cat = categories.find(c => c.id === p.category_id);
      const photo = p.photo_path ? el("img", { src: photoUrl(p.photo_path), alt: "", style: "max-width:220px;max-height:220px;display:block;margin:4px 0" }) : "";
      const elevEl = el("div", { textContent: "標高 取得中…" });
      const warnEl = el("div", { style: "color:#c0392b;font-weight:bold" });
      const setWarn = v => {  // v: 標高。null は標高データなし（海上・範囲外）
        const msgs = [];
        if (x[LOC_KEY] === "要確認") msgs.push("位置要確認" + (x[LOC_NOTE] ? `（${x[LOC_NOTE]}）` : ""));
        if (v === null) msgs.push("標高データなし（海上など）の位置です。正しい場所か確認してください");
        warnEl.textContent = msgs.length ? "⚠ " + msgs.join(" / ") : "";
      };
      setWarn(undefined);
      const how = x[LOC_METHOD] ? `（${x[LOC_METHOD]}${x[LOC_GAP] !== undefined ? `・参照写真と約${x[LOC_GAP]}分差` : ""}）` : "";
      const estEl = x[LOC_KEY] ? el("div", { textContent: "位置は撮影時刻などから推定した値です" + how, style: "color:#666;font-size:12px" }) : "";
      getElevation(p.lat, p.lng).then(v => { elevEl.textContent = fmtElev(v); setWarn(v); m.getPopup() && m.getPopup().update(); });
      return (cachedBody = el("div", {},
        el("b", { textContent: (cat ? cat.name : p.category_id) + (p.status === "approved" ? "" : "（未承認）") }),
        el("div", { textContent: new Date(p.observed_at).toLocaleString("ja-JP") }),
        photo,
        el("div", { textContent: p.note }),
        el("div", { textContent: Object.entries(x).filter(([k]) => !LOC_KEYS.includes(k)).map(([k, v]) => `${k}: ${v}`).join(" / ") }),
        elevEl, warnEl, estEl));
    });
    return m;
  });
  layer.addLayers(markers);
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
    el("p", { style: "font-size:12px;color:#555", textContent: "【個人情報の取り扱い】入力した表示名・メール・利用目的は、承認の可否の判断と招待メールの送信にのみ使い、公開しません。削除を希望する場合は管理者に連絡してください。投稿した写真・位置・メモは、承認後に誰でも閲覧できます（位置はぼかしを選べます）。" }),
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
  const photoIn = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/heic" });
  const photoInfo = el("div", { style: "font-size:12px;color:#555" });
  let observedAt = null;  // 写真の撮影日時（EXIFにあれば）
  let altitude = null;    // 写真の標高(m)（EXIFにあれば）
  const exifText = el("textarea", { readOnly: true, rows: 3, placeholder: "写真の位置情報（緯度・経度・標高・撮影日）がここに表示されます" });
  const copyBtn = el("button", { textContent: "コピー", type: "button", onclick: () => navigator.clipboard && exifText.value && navigator.clipboard.writeText(exifText.value) });
  const stampChk = el("input", { type: "checkbox" });
  const altChk = el("input", { type: "checkbox", checked: true });
  const uncertainChk = el("input", { type: "checkbox" });  // 位置が不確かなとき「要確認」を付ける
  const fmtDate = d => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  // 選んだぼかしを反映した「公開される位置」（サーバーの処理と同じ格子の中心）
  const publicPos = () => {
    const m = Number(blur.value);
    if (!m) return picked;
    const g = m / 111000;
    return { lat: Math.round(picked.lat / g) * g + g / 2, lng: Math.round(picked.lng / g) * g + g / 2 };
  };
  const stampLines = () => {
    const out = [];
    if (picked) { const q = publicPos(); out.push(`緯度 ${q.lat.toFixed(Number(blur.value) ? 4 : 5)}  経度 ${q.lng.toFixed(Number(blur.value) ? 4 : 5)}`); }
    if (altitude !== null) out.push(`標高 ${altitude.toFixed(1)} m`);
    if (observedAt) out.push(`撮影 ${fmtDate(observedAt)}`);
    return out;
  };
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
    if (altChk.checked && altitude !== null) extra["標高(m)"] = Number(altitude.toFixed(1));
    if (uncertainChk.checked) extra[LOC_KEY] = "要確認";
    let photoPath = null;
    if (photoIn.files[0]) {
      try {
        const blob = await shrinkPhoto(photoIn.files[0], stampChk.checked ? stampLines() : []);
        photoPath = `${me.user.id}/${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from("photos").upload(photoPath, blob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
      } catch (e) { out.replaceChildren(msg("写真を処理できませんでした（JPEG/PNG推奨）: " + e.message)); return; }
    }
    const { error } = await sb.rpc("submit_point", {
      p_category: cat.value, p_lng: picked.lng, p_lat: picked.lat, p_note: note.value,
      p_photo_path: photoPath, p_extra: extra, p_blur_m: Number(blur.value),
      ...(observedAt ? { p_observed_at: observedAt.toISOString() } : {}) });
    if (error) { out.replaceChildren(msg("投稿できませんでした: " + error.message)); return; }
    out.replaceChildren(msg("投稿しました（承認後に公開されます）", true));
    note.value = ""; photoIn.value = ""; observedAt = null; altitude = null; exifText.value = ""; photoInfo.textContent = ""; uncertainChk.checked = false; await loadPoints();
  };
  const nodes = [el("h3", { textContent: "地点を登録" }), el("label", { textContent: "カテゴリ" }), cat,
    el("label", { textContent: "メモ" }), note, extraBox,
    el("label", { textContent: "写真（任意・位置情報は自動で削除）" }), photoIn, photoInfo,
    el("label", { textContent: "写真から読み取った情報（コピー可）" }), exifText, el("p", {}, copyBtn),
    el("label", {}, altChk, " 標高を属性に記録する"),
    el("label", {}, stampChk, " 位置・標高・日時を写真に文字で入れる（公開位置のぼかしを反映）"),
    el("label", {}, uncertainChk, " 位置が不確か（「要確認」のマークを付ける）"),
    el("label", { textContent: "公開位置のぼかし" }), blur,
    pos, el("p", {}, go), out];
  if (me.member.role === "admin") nodes.push(el("hr"), el("button", { textContent: "承認待ちを確認", onclick: adminPanel }));
  showPanel(...nodes);
  picking = true;
  map.off("click", onPick); map.on("click", onPick);
  function setPick(ll) {
    picked = ll;
    if (pickMarker) pickMarker.remove();
    pickMarker = L.marker(picked).addTo(map);
    pos.textContent = `選択位置: ${picked.lat.toFixed(5)}, ${picked.lng.toFixed(5)}（正確な位置は管理者と本人のみ）`;
    getElevation(ll.lat, ll.lng).then(v => {
      if (picked !== ll) return;
      pos.textContent += `　${fmtElev(v)}`;
      if (v === null) { pos.textContent += "　⚠ 海上の可能性があります。位置を確認してください"; uncertainChk.checked = true; }
    });
  }
  function onPick(e) { setPick(e.latlng); }

  // 写真を選んだら、EXIFの位置と撮影日時をブラウザ内で読み取り、地図に反映する（写真自体は送信しない）
  photoIn.onchange = async () => {
    observedAt = null; altitude = null; exifText.value = ""; photoInfo.textContent = "";
    const f = photoIn.files[0];
    if (!f) return;
    if (typeof exifr === "undefined") { photoInfo.textContent = "【原因A】読み取り用ライブラリが読み込めていません。再読み込み（Safari は ⌘+Option+R）してください"; return; }
    photoInfo.textContent = `選択: ${f.type || "形式不明"} / ${(f.size / 1024).toFixed(0)}KB。位置情報を確認中…`;
    // 位置・日時/標高は別々に読む（片方が失敗しても、もう片方は使う）
    let gps = null, meta = null, errGps = null, errMeta = null;
    try { gps = await exifr.gps(f); } catch (e) { errGps = e; console.error("exifr.gps 失敗", e); }
    try { meta = await exifr.parse(f, { tiff: true, exif: true, gps: true }); } catch (e) { errMeta = e; console.error("exifr.parse 失敗", e); }
    if (!(gps && Number.isFinite(gps.latitude)) && meta && Number.isFinite(meta.latitude) && Number.isFinite(meta.longitude)) {
      gps = { latitude: meta.latitude, longitude: meta.longitude };  // parse の結果から補う
    }
    if (meta && meta.DateTimeOriginal instanceof Date && !isNaN(meta.DateTimeOriginal)) observedAt = meta.DateTimeOriginal;
    if (meta && Number.isFinite(meta.GPSAltitude)) {
      const below = meta.GPSAltitudeRef === 1 || /below/i.test(String(meta.GPSAltitudeRef ?? ""));
      altitude = below ? -meta.GPSAltitude : meta.GPSAltitude;
    }
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      setPick(L.latLng(gps.latitude, gps.longitude));
      map.setView(picked, Math.max(map.getZoom(), 15));
      photoInfo.textContent = "写真の位置情報を読み取り、地図に反映しました（違う場合は地図をクリックして修正できます）" + (observedAt ? "。撮影日時も反映します" : "");
      exifText.value = [`緯度 ${gps.latitude.toFixed(6)}`, `経度 ${gps.longitude.toFixed(6)}`,
        altitude !== null ? `標高 ${altitude.toFixed(1)} m` : "標高 （なし）", observedAt ? `撮影日 ${fmtDate(observedAt)}` : "撮影日 （なし）"].join("\n");
    } else if (errGps && errMeta) {
      photoInfo.textContent = `【原因C】読み取りに失敗（形式: ${f.type || "不明"}）。gps: ${errGps.message} / parse: ${errMeta.message}。地図をクリックして位置を選んでください`;
    } else {
      photoInfo.textContent = "【原因B】この写真ファイルには位置情報が入っていません（写真アプリから選ぶと位置が外れることがあります）。地図をクリックして位置を選んでください"
        + (observedAt ? "（撮影日時は反映します）" : "") + (errGps || errMeta ? `（一部の読み取りに失敗: ${(errGps || errMeta).message}）` : "");
    }
  };
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
locFilterEl.onchange = renderPoints;
sb.auth.onAuthStateChange(() => { refreshMe().then(loadPoints); });

(async () => { await loadCategories(); await refreshMe(); await loadPoints(); })();
