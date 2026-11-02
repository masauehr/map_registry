#!/usr/bin/env python3
"""登録済みの lichens の点に、位置の信頼度（要確認／推定）を付ける。

- 元データ（lichens の photos.json）の est（推定位置）と note（同じ日の写真の近く・人が判断した暫定位置）から判定。
- --est-loc に lichens の work/est_loc.json を渡すと、推定の方法（補間・最寄り・引き継ぎ・同日・手動）と時間差で細かく判定:
    要確認 = 同日／手動、または 引き継ぎ で時間差が --carry-warn-sec を超えるもの（既定2時間）、海上
    推定   = 補間・最寄り・時間差の小さい引き継ぎ。extra に 位置方法・位置時間差(分) を記録（ポップアップに表示）
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


def check_key(url, key):
    """書き込み前にキーを確認する（キーの値は表示しない）。無効なら理由の候補を出して終了する。"""
    problems = []
    if not key.startswith(("sb_secret_", "eyJ")):
        problems.append("Secret key（sb_secret_ で始まる）ではない可能性があります（公開用キーは使えません）")
    if any(c in key for c in "•*…") or any(c.isspace() for c in key) or len(key) < 30:
        problems.append("伏せ字（••••）のままコピーした／空白が混じった／途中で切れた可能性があります（目のマークで表示してからコピー）")
    h = {"apikey": key}
    if key.startswith("eyJ"):
        h["Authorization"] = "Bearer " + key
    try:
        urllib.request.urlopen(urllib.request.Request(f"{url}/rest/v1/points?select=id&limit=1", headers=h), timeout=30).read()
    except urllib.error.HTTPError as e:
        print(f"キーの確認に失敗しました（HTTP {e.code}）。")
        for p in problems:
            print("  ・" + p)
        print("  ・.env の行は SUPABASE_SECRET_KEY=キー（空白・引用符なし）／別プロジェクトのキーではないか確認してください")
        sys.exit(1)
    except Exception as e:
        sys.exit(f"接続に失敗しました: {e}")


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
    ap.add_argument("--est-loc", help="lichens の work/est_loc.json（推定の方法・時間差。あれば判定が細かくなる）")
    ap.add_argument("--carry-warn-sec", type=int, default=7200, help="引き継ぎで、この秒数を超える時間差は要確認（既定7200=2時間）")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    src = Path(a.src).resolve()
    if src.name not in ("map_local", "map_public"):
        sys.exit("--src は map_local か map_public を指定してください")
    rows = [r for r in json.loads((src / "photos.json").read_text(encoding="utf-8")) if r.get("lat") is not None]

    # 1) 元データの印から判定
    METHOD = {"interp": "補間", "nearest": "最寄り", "carry": "引き継ぎ", "sameday": "同日", "manual": "手動"}
    est_loc = json.loads(Path(a.est_loc).read_text(encoding="utf-8")) if a.est_loc else {}
    flags = {}  # id -> 追加する extra の項目（位置・位置メモ・位置方法・位置時間差(分)）
    reason = Counter()
    for r in rows:
        e = est_loc.get(r["id"], {})
        method, gap = e.get("method"), e.get("gap")
        if not (r.get("note") or r.get("est") or e):
            continue
        info = {}
        if method in METHOD:
            info["位置方法"] = METHOD[method]
        if gap is not None:
            info["位置時間差(分)"] = round(gap / 60)
        if method in ("sameday", "manual") or r.get("note"):
            info["位置"], info["位置メモ"] = "要確認", r.get("note") or e.get("note") or "人が判断した暫定位置"
            reason["同日・手動（note付き）"] += 1
        elif method == "carry" and gap is not None and gap > a.carry_warn_sec:
            info["位置"] = "要確認"
            info["位置メモ"] = f"直前のGPS写真から約{round(gap / 60)}分後の位置を引き継ぎ"
            reason["引き継ぎで時間差大"] += 1
        else:
            info["位置"] = "推定"
        flags[r["id"]] = info

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
                old = flags[r["id"]].get("位置メモ")
                flags[r["id"]]["位置"] = "要確認"
                flags[r["id"]]["位置メモ"] = f"{old}／{memo}" if old else memo
                sea_days[r["taken"][:10]] += 1
                reason["海上"] += 1

    kinds = Counter(v["位置"] for v in flags.values())
    print(f"要確認 {kinds['要確認']}件 / 推定 {kinds['推定']}件（対象は位置あり {len(rows)}件のうち）")
    if est_loc:
        print("  要確認の理由（重複あり）:", dict(reason))
    if a.check_sea:
        print(f"  うち海上: {sum(sea_days.values())}件 / 撮影日ごと: {sorted(sea_days.items())}")
    if not a.apply:
        print("ドライランです。反映するには --apply を付けてください。")
        return

    env = load_env()
    url, key = env.get("SUPABASE_URL", "").rstrip("/"), env.get("SUPABASE_SECRET_KEY", "")
    if not (url and key):
        sys.exit(".env に SUPABASE_URL / SUPABASE_SECRET_KEY を設定してください（一時的なキー。終わったら削除）")

    check_key(url, key)  # 無効なキーなら、大量の更新の前にここで止める
    kind_of = {r["id"]: r["kind"] for r in rows}

    def work(item):
        rid, info = item
        patch(url, key, str(uuid.uuid5(NS, "lichens:" + rid)), {"source": "lichens", "kind": kind_of[rid], **info})

    print("反映中…")
    with ThreadPoolExecutor(8) as ex:
        for i, _ in enumerate(ex.map(work, flags.items()), 1):
            if i % 500 == 0:
                print(f"  {i}/{len(flags)}")
    print("完了")


if __name__ == "__main__":
    main()
