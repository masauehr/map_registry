#!/usr/bin/env python3
"""登録済みの lichens の点に、位置の信頼度（要確認／推定）を付ける。

- 元データ（lichens の photos.json）の est（推定位置）と note（同じ日の写真の近く・人が判断した暫定位置）から判定。
- --check-sea を付けると、推定位置のうち「標高データなし（海上・範囲外）」の地点を、国土地理院の標高APIで調べて「要確認（海上）」にする。
- 既定はドライラン（何も書き込まない）。実行は --apply。座標は表示しない（件数・撮影日のみ）。
- 書き込みは points.extra のみ（位置・写真は変えない）。extra は丸ごと置き換えるため、source / kind / 位置 / 位置メモ を入れ直す。
- 接続情報は map_registry/.env（import_lichens.py と同じ。実行時だけ一時的な secret key を使い、終わったら削除する）。
使い方:
    python3 tools/flag_locations.py --src ../lichens/map_local --check-sea            # ドライラン（調査のみ）
    python3 tools/flag_locations.py --src ../lichens/map_local --check-sea --apply    # 反映
"""
import argparse, json, os, sys, time, uuid, urllib.request, urllib.error
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

NS = uuid.UUID("6f1c2b0e-5a53-4f0a-9c1e-2f4a8d3b7e11")  # import_lichens.py と同じ名前空間（同じ id から同じUUID）
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


def elevation(k):
    """(lat, lon) -> (k, 標高 or None=データなし or 'ERR')。同じ地点は呼び出し側でまとめる。"""
    u = f"https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon={k[1]}&lat={k[0]}&outtype=JSON"
    for _ in range(3):
        try:
            j = json.loads(urllib.request.urlopen(u, timeout=20).read())
            return k, (j["elevation"] if isinstance(j.get("elevation"), (int, float)) else None)
        except Exception:
            time.sleep(1)
    return k, "ERR"


def patch(url, key, pid, extra):
    h = {"apikey": key, "Content-Type": "application/json", "Prefer": "return=minimal"}
    if key.startswith("eyJ"):
        h["Authorization"] = "Bearer " + key
    req = urllib.request.Request(f"{url}/rest/v1/points?id=eq.{pid}", data=json.dumps({"extra": extra}).encode(), method="PATCH", headers=h)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60):
                return
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == 3 or (isinstance(e, urllib.error.HTTPError) and e.code < 500):
                raise
            time.sleep(2 * (attempt + 1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="lichens の map_local（全件）または map_public")
    ap.add_argument("--check-sea", action="store_true", help="推定位置の海上チェック（地理院の標高API）")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    src = Path(a.src).resolve()
    if src.name not in ("map_local", "map_public"):
        sys.exit("--src は map_local か map_public を指定してください")
    rows = [r for r in json.loads((src / "photos.json").read_text(encoding="utf-8")) if r.get("lat") is not None]

    # 1) 元データの印から判定
    flags = {}  # id -> (位置, 位置メモ or None)
    for r in rows:
        if r.get("note"):
            flags[r["id"]] = ("要確認", r["note"])
        elif r.get("est"):
            flags[r["id"]] = ("推定", None)

    # 2) 推定位置の海上チェック
    sea_days = Counter()
    if a.check_sea:
        est = [r for r in rows if r["id"] in flags]
        keys = sorted({(round(r["lat"], 5), round(r["lon"], 5)) for r in est})
        print(f"海上チェック: 推定位置の写真 {len(est)}枚 / 地点 {len(keys)}か所")
        with ThreadPoolExecutor(4) as ex:
            res = dict(ex.map(elevation, keys))
        if any(v == "ERR" for v in res.values()):
            sys.exit("標高APIの取得に失敗した地点があります。時間をおいて再実行してください")
        for r in est:
            if res[(round(r["lat"], 5), round(r["lon"], 5))] is None:
                memo = "海上（標高データなし）"
                old = flags[r["id"]][1]
                flags[r["id"]] = ("要確認", f"{old}／{memo}" if old else memo)
                sea_days[r["taken"][:10]] += 1

    kinds = Counter(v[0] for v in flags.values())
    print(f"要確認 {kinds['要確認']}件 / 推定 {kinds['推定']}件（対象は位置あり {len(rows)}件のうち）")
    if a.check_sea:
        print(f"  うち海上: {sum(sea_days.values())}件 / 撮影日ごと: {sorted(sea_days.items())}")
    if not a.apply:
        print("ドライランです。反映するには --apply を付けてください。")
        return

    env = load_env()
    url, key = env.get("SUPABASE_URL", "").rstrip("/"), env.get("SUPABASE_SECRET_KEY", "")
    if not (url and key):
        sys.exit(".env に SUPABASE_URL / SUPABASE_SECRET_KEY を設定してください（一時的なキー。終わったら削除）")

    kind_of = {r["id"]: r["kind"] for r in rows}

    def work(item):
        rid, (flag, memo) = item
        extra = {"source": "lichens", "kind": kind_of[rid], "位置": flag}
        if memo:
            extra["位置メモ"] = memo
        patch(url, key, str(uuid.uuid5(NS, "lichens:" + rid)), extra)

    print("反映中…")
    with ThreadPoolExecutor(8) as ex:
        for i, _ in enumerate(ex.map(work, flags.items()), 1):
            if i % 500 == 0:
                print(f"  {i}/{len(flags)}")
    print("完了")


if __name__ == "__main__":
    main()
