# Phase2: 写真アップロードと lichens の一括取り込み

## 写真アップロード（0006_photos.sql ＋ web/app.js）
- 投稿フォームで写真を選ぶと、ブラウザ側で長辺1600px以内のJPEGに再エンコードしてからアップロードする。canvas を通すので **EXIF（GPS含む）は残らない**。
- バケット `photos` は公開読み取り。パスは `<ユーザーUUID>/<ランダムUUID>.jpg` で推測不能。サイズ2MB・JPEG/WebPのみ。
- アップロードできるのは登録者のみ・自分のフォルダのみ（Storage RLS）。`submit_point` も「自分のフォルダ配下のjpg/webp」以外のパスを拒否（他人の写真・外部URLの紐付け防止）。
- **位置・撮影日時の自動読み取り**: 写真を選ぶと、EXIFのGPS（緯度・経度）と撮影日時をブラウザ内で読み取り（exifr）、地図に位置を反映して撮影日時も入れる。位置が無い写真は地図クリックで指定。読み取った位置は修正可。写真自体は読み取り時に送信せず、アップロードされるのはEXIFを消した縮小版のみ。公開位置のぼかしは従来どおり選べる。
- **読み取った情報のテキスト表示**: 緯度・経度・標高・撮影日を入力欄に表示（コピー可）。標高は「標高(m)」として属性に記録できる（選択式、既定ON）。
- **写真への文字の焼き込み（選択式・既定OFF）**: 位置・標高・撮影日を画像下部に文字で入れる。位置は**選んだぼかしを反映した公開位置**のみ（正確な位置を画像に残さない）。
- 地図のポップアップに写真を表示（`points_map` に `photo_path` を追加）。
- 制限: iPhoneのHEICはChromeで読めない場合がある（JPEG/PNG推奨）。Free枠の Storage は 1GB。

## lichens の一括取り込み（tools/import_lichens.py）
- 取り込み元は **自宅周辺を除外済みの `lichens/map_public` のみ**（`map_local` は拒否）。
- 5,983件中、位置ありの5,863件が対象（位置不明の120件は除外）。サムネイル約150MB。
- 各点は カテゴリ=地衣類、status=承認済み、`extra` に `source=lichens` と種別（main/maybe/context）。撮影日時は日本時間として登録。
- 何度実行しても重複しない（source id から決定的なUUIDを生成）。サムネイルは `import/lichens/<id>.jpg` に上書き保存。
- 既定はドライラン。`--apply` で実登録、`--limit N` で少数試験、`--blur-m` で公開位置をぼかせる。
- 接続情報は `.env`（Git管理外。`.env.example` 参照）。**secret key は絶対にコミット・共有しない。** 自分のターミナルで実行する。

### 手順
1. `0006_photos.sql` を SQL Editor で実行。
2. API Keys で **Secret key** を作成し、`map_registry/.env` に `SUPABASE_URL` / `SUPABASE_SECRET_KEY` / `IMPORT_USER_ID`（管理者のUID）を書く。
3. ドライラン: `python3 tools/import_lichens.py --src ../lichens/map_public`
4. 少数で試す: `... --limit 20 --apply` → 地図に20件出ることを確認。
5. 全件: `... --apply`（数分）。やり直したい場合は SQL で `delete from points where extra->>'source' = 'lichens';` ＋ Storage の `import/lichens/` を削除。

### 公開に関する確認
lichens の公開地図（GitHub Pages）と同じデータ・同じ除外範囲。map_registry では誰でも閲覧できるため、取り込み前に枚数と除外の検証結果をユーザーに示して確認を取る。
