#!/usr/bin/env python3
"""lichens の地図データを map_registry に一括登録する。

- 公開用（--src。自宅周辺を除外済みの map_public のみ許可）はそのまま登録（--blur-m でぼかし可）。
- 手元用（--local-src。map_local のみ許可）を指定すると、map_public に無い写真＝自宅周辺として除外された写真だけを、
  --excluded-blur-m の大きさでぼかして追加登録する。自宅の座標はスクリプトにも引数にも要らない（差集合で判定）。
  正確な位置は非公開テーブル（本人と管理者のみ）に入り、公開されるのはぼかし後の位置だけ。
- 除外分の写真の扱い: --excluded-photos none|main_maybe|all（既定 none = 写真なし）
- 既定はドライラン。実登録は --apply。何度実行しても重複しない（source id から決定的なUUID）。
- 標準ライブラリのみ。接続情報は map_registry/.env（Git管理外）:
    SUPABASE_URL / SUPABASE_SECRET_KEY（絶対にコミット・共有しない） / IMPORT_USER_ID（管理者のUUID）
使い方:
    python3 tools/import_lichens.py --src ../lichens/map_public                       # ドライラン
    python3 tools/import_lichens.py --src ../lichens/map_public --local-src ../lichens/map_local \\
        --excluded-blur-m 1000 --excluded-photos main_maybe                           # ドライラン（除外分も）
    ... --apply        # 実登録（--limit N で各グループの先頭N件だけ試験）
"""
import argparse, hashlib, json, os, re, sys, time, uuid, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

NS = uuid.UUID("6f1c2b0e-5a53-4f0a-9c1e-2f4a8d3b7e11")  # 取り込み用の固定名前空間
ROOT = Path(__file__).resolve().parent.parent


def load_env():
    env = dict(os.environ)
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    return env


def headers(key, extra=None):
    h = {"apikey": key}
    if key.startswith("eyJ"):  # 旧形式（JWT）のキーは Authorization も必要
        h["Authorization"] = "Bearer " + key
    h.update(extra or {})
    return h


def request(method, url, key, body=None, extra=None):
    req = urllib.request.Request(url, data=body, method=method, headers=headers(key, extra))
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {url.split('/v1/')[-1][:40]} -> {e.code} {e.read().decode()[:200]}")


def photo_name(r):
    """Storage のファイル名。安全な文字だけの id はそのまま（既存のアップロードと互換）、
    スペース・括弧などを含む id は、記号を _ にして短いハッシュを付ける（衝突防止）。"""
    i = r["id"]
    if re.fullmatch(r"[A-Za-z0-9_.-]+", i):
        return i
    return re.sub(r"[^A-Za-z0-9_.-]", "_", i) + "_" + hashlib.sha1(i.encode("utf-8")).hexdigest()[:8]


def located(rows):
    return [r for r in rows if r.get("lat") is not None and r.get("lon") is not None]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="lichens の map_public ディレクトリ")
    ap.add_argument("--blur-m", type=int, default=0, help="公開分のぼかし格子（m）。0=そのまま")
    ap.add_argument("--local-src", help="lichens の map_local（指定すると自宅周辺として除外された分を追加登録）")
    ap.add_argument("--excluded-blur-m", type=int, default=1000, help="除外分のぼかし格子（m）。既定1000")
    ap.add_argument("--excluded-photos", choices=["none", "main_maybe", "all"], default="none")
    ap.add_argument("--apply", action="store_true", help="実際に登録する（省略時はドライラン）")
    ap.add_argument("--limit", type=int, default=0, help="各グループの先頭N件だけ（試験用）")
    a = ap.parse_args()

    src = Path(a.src).resolve()
    if src.name != "map_public":
        sys.exit("安全のため、--src は map_public のみ許可しています（自宅周辺を除外済みのデータ）")
    pub_all = json.loads((src / "photos.json").read_text(encoding="utf-8"))
    pub = located(pub_all)
    pub_ids = {r["id"] for r in pub_all}

    exc = []
    lsrc = None
    if a.local_src:
        lsrc = Path(a.local_src).resolve()
        if lsrc.name != "map_local":
            sys.exit("--local-src は map_local のみ許可しています")
        if not (1 <= a.excluded_blur_m <= 10000):
            sys.exit("--excluded-blur-m は 1〜10000 の範囲で指定してください（除外分は必ずぼかす）")
        exc = [r for r in located(json.loads((lsrc / "photos.json").read_text(encoding="utf-8"))) if r["id"] not in pub_ids]

    if a.limit:
        pub, exc = pub[: a.limit], exc[: a.limit]

    def want_photo(r):
        return a.excluded_photos == "all" or (a.excluded_photos == "main_maybe" and r["kind"] in ("main", "maybe"))

    # items: (row, 取り込み元ディレクトリ, ぼかし格子m, 写真あり, 除外分か)
    items = [(r, src, a.blur_m, True, False) for r in pub] + [(r, lsrc, a.excluded_blur_m, want_photo(r), True) for r in exc]
    photo_items = [it for it in items if it[3]]
    missing = [it[0]["id"] for it in photo_items if not (it[1] / it[0]["thumb"]).exists()]
    size = sum((it[1] / it[0]["thumb"]).stat().st_size for it in photo_items if (it[1] / it[0]["thumb"]).exists())
    print(f"公開分 {len(pub)}件（ぼかし {a.blur_m}m・写真あり）")
    if a.local_src:
        n_ph = sum(1 for it in items if it[4] and it[3])
        print(f"自宅周辺として除外されていた分 {len(exc)}件（ぼかし {a.excluded_blur_m}m・写真あり {n_ph}件・写真なし {len(exc) - n_ph}件）")
    print(f"アップロードするサムネイル {len(photo_items)}枚 / 合計 {size / 1e6:.1f}MB / 欠落 {len(missing)}件")
    if not a.apply:
        print("ドライランです。登録するには --apply を付けてください。")
        return
    if missing:
        sys.exit("サムネイルの欠落があるため中止します")

    env = load_env()
    url, key, uid = env.get("SUPABASE_URL", "").rstrip("/"), env.get("SUPABASE_SECRET_KEY", ""), env.get("IMPORT_USER_ID", "")
    if not (url and key and uid):
        sys.exit(".env に SUPABASE_URL / SUPABASE_SECRET_KEY / IMPORT_USER_ID を設定してください")

    # 1) サムネイルをアップロード（import/lichens/<id>.jpg。再実行は上書き）
    def upload(it):
        r, d = it[0], it[1]
        body = (d / r["thumb"]).read_bytes()
        for attempt in range(4):  # 一時的な通信エラー・5xx は再試行する
            try:
                request("POST", f"{url}/storage/v1/object/photos/import/lichens/{photo_name(r)}.jpg", key,
                        body, {"Content-Type": "image/jpeg", "x-upsert": "true"})
                return
            except (urllib.error.URLError, TimeoutError, RuntimeError) as e:
                if attempt == 3 or (isinstance(e, RuntimeError) and " -> 4" in str(e)):
                    raise
                time.sleep(2 * (attempt + 1))
    print("写真をアップロード中…")
    with ThreadPoolExecutor(8) as ex:
        for i, _ in enumerate(ex.map(upload, photo_items), 1):
            if i % 500 == 0:
                print(f"  {i}/{len(photo_items)}")

    # 2) points / point_private を500件ずつ登録（重複は無視）
    def pt(it):
        r, _, blur, photo, is_exc = it
        lon, lat = r["lon"], r["lat"]
        if blur:
            g = blur / 111000.0
            dlon, dlat = (int(lon / g) + 0.5) * g, (int(lat / g) + 0.5) * g
        else:
            dlon, dlat = lon, lat
        pid = str(uuid.uuid5(NS, "lichens:" + r["id"]))
        point = {"id": pid, "category_id": "lichen", "display_geom": f"SRID=4326;POINT({dlon} {dlat})",
                 "note": "", "photo_path": f"import/lichens/{photo_name(r)}.jpg" if photo else None,
                 "observed_at": r["taken"] + "+09:00",
                 "extra": {"source": "lichens", "kind": r["kind"]}, "status": "approved"}
        priv = {"point_id": pid, "geom": f"SRID=4326;POINT({lon} {lat})", "created_by": uid}
        return point, priv

    pairs = [pt(it) for it in items]
    ins = {"Content-Type": "application/json", "Prefer": "resolution=ignore-duplicates,return=minimal"}
    for i in range(0, len(pairs), 500):
        chunk = pairs[i:i + 500]
        request("POST", f"{url}/rest/v1/points?on_conflict=id", key, json.dumps([c[0] for c in chunk]).encode(), ins)
        request("POST", f"{url}/rest/v1/point_private?on_conflict=point_id", key, json.dumps([c[1] for c in chunk]).encode(), ins)
        print(f"登録 {min(i + 500, len(pairs))}/{len(pairs)}")
    print("完了")


if __name__ == "__main__":
    main()
