#!/usr/bin/env python3
"""公開ページ（GitHub Pages）と Supabase の公開設定を点検する。データは書き込まない（読み取りと、拒否されることの確認のみ）。

確認すること:
  1. 公開ページと config.js が配信されている（Turnstile のサイトキーがテスト用のままか）
  2. サインアップが無効（招待制）になっている
  3. Edge Function（apply / approve-application）が公開ページのオリジンを許可している（ALLOWED_ORIGINS）
  4. 申請に必要なボット確認が空だと拒否される（Turnstile の検証が効いている）
  5. 匿名で読めるのは承認済みの地点だけ／非公開テーブルと申請は読めない・直接書けない
使い方: python3 tools/check_public.py [--site https://masauehr.github.io/map_registry/]
接続先は web/config.js（公開しても良い URL と公開用キー）から読む。
"""
import argparse, json, re, sys, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
results = []


def rec(ok, name, detail=""):
    results.append(ok)
    print(("OK   " if ok else ("NG   " if ok is False else "注意 ")) + name + (f" — {detail}" if detail else ""))


def http(method, url, headers=None, body=None):
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, dict(r.headers), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", "replace")
    except Exception as e:
        return 0, {}, str(e)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default="https://masauehr.github.io/map_registry/")
    a = ap.parse_args()
    site = a.site if a.site.endswith("/") else a.site + "/"
    origin = re.match(r"https?://[^/]+", site).group(0)

    cfg_text = (ROOT / "web" / "config.js").read_text(encoding="utf-8")
    get = lambda k: re.search(k + r'\s*:\s*"([^"]+)"', cfg_text).group(1)
    url, key = get("url").rstrip("/"), get("anonKey")
    api = {"apikey": key}

    # 1) 公開ページ
    st, _, body = http("GET", site)
    rec(st == 200 and "app.js" in body, "公開ページが開ける", f"HTTP {st}")
    st, _, body = http("GET", site + "config.js")
    pub_cfg = body if st == 200 else ""
    rec(st == 200 and url in pub_cfg and "sb_secret" not in pub_cfg, "公開の config.js に接続先があり、secret キーは含まれない")
    m = re.search(r'turnstileSiteKey\s*:\s*"([^"]+)"', pub_cfg)
    if m and m.group(1).startswith(("1x0", "2x0", "3x0")):
        rec(None, "Turnstile がテスト用キーのまま", "ボット対策として機能しません。本番キーに差し替えてください")
    else:
        rec(bool(m), "Turnstile のサイトキーが本番用")

    # 2) サインアップ無効
    st, _, body = http("GET", f"{url}/auth/v1/settings", api)
    try:
        dis = json.loads(body).get("disable_signup")
    except Exception:
        dis = None
    rec(dis is True, "サインアップが無効（招待制）", f"disable_signup={dis}" if dis is not True else "")

    # 3) CORS（公開ページのオリジンを許可しているか）
    for fn in ("apply", "approve-application"):
        st, hd, _ = http("OPTIONS", f"{url}/functions/v1/{fn}", {**api, "Origin": origin, "Access-Control-Request-Method": "POST"})
        allow = {k.lower(): v for k, v in hd.items()}.get("access-control-allow-origin")
        rec(allow == origin, f"{fn}: 公開ページのオリジンを許可（ALLOWED_ORIGINS）", f"許可={allow}")

    # 4) ボット確認が空の申請は拒否される（書き込みは起きない）
    st, _, body = http("POST", f"{url}/functions/v1/apply", {**api, "Origin": origin, "Content-Type": "application/json"},
                       json.dumps({"display_name": "点検", "email": "check@example.com", "purpose": "点検", "turnstile_token": ""}).encode())
    rec(st == 400, "ボット確認なしの申請は拒否される", f"HTTP {st}")

    # 5) 匿名の読み取り・書き込み
    st, _, body = http("GET", f"{url}/rest/v1/points_map?select=status&limit=1000", api)
    try:
        sts = {r["status"] for r in json.loads(body)}
    except Exception:
        sts = None
    rec(st == 200 and sts is not None and sts <= {"approved"}, "匿名は承認済みの地点だけ読める", f"status={sts}")
    for t in ("point_private", "applications", "members"):
        st, _, _ = http("GET", f"{url}/rest/v1/{t}?select=*&limit=1", api)
        rec(st in (401, 403), f"匿名は {t} を読めない", f"HTTP {st}")
    st, _, _ = http("POST", f"{url}/rest/v1/applications", {**api, "Content-Type": "application/json"},
                    json.dumps({"display_name": "点検", "email": "check@example.com", "purpose": "点検"}).encode())
    rec(st in (401, 403), "匿名は applications に直接書けない（申請は Function 経由のみ）", f"HTTP {st}")

    ng = results.count(False)
    print(f"\n結果: OK {results.count(True)} / NG {ng} / 注意 {results.count(None)}")
    sys.exit(1 if ng else 0)


if __name__ == "__main__":
    main()
