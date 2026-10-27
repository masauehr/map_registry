#!/usr/bin/env python3
"""lichens の公開用地図データ（map_public）を map_registry に一括登録する。

- 取り込み元は自宅周辺を除外済みの map_public のみ（map_local は拒否）。
- 既定はドライラン。実際の登録は --apply。何度実行しても重複しない（source id から決定的な UUID を作る）。
- 標準ライブラリのみ。接続情報は map_registry/.env（Git管理外）から読む:
    SUPABASE_URL=https://xxxx.supabase.co
    SUPABASE_SECRET_KEY=sb_secret_...   （secret key。絶対にコミット・共有しない）
    IMPORT_USER_ID=<管理者のユーザーUUID>  （取り込みデータの登録者として記録される）
使い方:
    python3 tools/import_lichens.py --src ../lichens/map_public            # ドライラン
    python3 tools/import_lichens.py --src ../lichens/map_public --limit 20 --apply   # 少数で試す
    python3 tools/import_lichens.py --src ../lichens/map_public --apply              # 全件
"""
import argparse, json, os, sys, uuid, urllib.request, urllib.error
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="lichens の map_public ディレクトリ")
    ap.add_argument("--apply", action="store_true", help="実際に登録する（省略時はドライラン）")
    ap.add_argument("--limit", type=int, default=0, help="先頭N件だけ（試験用）")
    ap.add_argument("--blur-m", type=int, default=0, help="公開位置をぼかす格子（m）。0=そのまま")
    a = ap.parse_args()

    src = Path(a.src).resolve()
    if src.name != "map_public":
        sys.exit("安全のため、取り込み元は map_public のみ許可しています（自宅周辺を除外済みのデータ）")
    rows = json.loads((src / "photos.json").read_text(encoding="utf-8"))
    located = [r for r in rows if r.get("lat") is not None and r.get("lon") is not None]
    if a.limit:
        located = located[: a.limit]
    missing = [r["id"] for r in located if not (src / r["thumb"]).exists()]
    size = sum((src / r["thumb"]).stat().st_size for r in located if (src / r["thumb"]).exists())
    print(f"全{len(rows)}件 / 位置あり対象{len(located)}件 / 位置不明で除外{len(rows) - len([r for r in rows if r.get('lat') is not None])}件")
    print(f"サムネイル合計 {size / 1e6:.1f}MB / 欠落 {len(missing)}件 / ぼかし {a.blur_m}m")
    if not a.apply:
        print("ドライランです。登録するには --apply を付けてください。")
        return

    env = load_env()
    url, key, uid = env.get("SUPABASE_URL", "").rstrip("/"), env.get("SUPABASE_SECRET_KEY", ""), env.get("IMPORT_USER_ID", "")
    if not (url and key and uid):
        sys.exit(".env に SUPABASE_URL / SUPABASE_SECRET_KEY / IMPORT_USER_ID を設定してください")

    # 1) サムネイルをアップロード（import/lichens/<id>.jpg。再実行は上書き）
    def upload(r):
        path = f"import/lichens/{r['id']}.jpg"
        request("POST", f"{url}/storage/v1/object/photos/{path}", key,
                (src / r["thumb"]).read_bytes(), {"Content-Type": "image/jpeg", "x-upsert": "true"})
    print("写真をアップロード中…")
    with ThreadPoolExecutor(8) as ex:
        for i, _ in enumerate(ex.map(upload, located), 1):
            if i % 500 == 0:
                print(f"  {i}/{len(located)}")

    # 2) points / point_private を500件ずつ登録（重複は無視）
    def pt(r):
        lon, lat = r["lon"], r["lat"]
        if a.blur_m:
            g = a.blur_m / 111000.0
            dlon, dlat = (int(lon / g) + 0.5) * g, (int(lat / g) + 0.5) * g
        else:
            dlon, dlat = lon, lat
        pid = str(uuid.uuid5(NS, "lichens:" + r["id"]))
        point = {"id": pid, "category_id": "lichen", "display_geom": f"SRID=4326;POINT({dlon} {dlat})",
                 "note": "", "photo_path": f"import/lichens/{r['id']}.jpg", "observed_at": r["taken"] + "+09:00",
                 "extra": {"source": "lichens", "kind": r["kind"]}, "status": "approved"}
        priv = {"point_id": pid, "geom": f"SRID=4326;POINT({lon} {lat})", "created_by": uid}
        return point, priv

    pairs = [pt(r) for r in located]
    ins = {"Content-Type": "application/json", "Prefer": "resolution=ignore-duplicates,return=minimal"}
    for i in range(0, len(pairs), 500):
        chunk = pairs[i:i + 500]
        request("POST", f"{url}/rest/v1/points?on_conflict=id", key, json.dumps([c[0] for c in chunk]).encode(), ins)
        request("POST", f"{url}/rest/v1/point_private?on_conflict=point_id", key, json.dumps([c[1] for c in chunk]).encode(), ins)
        print(f"登録 {min(i + 500, len(pairs))}/{len(pairs)}")
    print("完了")


if __name__ == "__main__":
    main()
