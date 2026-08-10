# moku-tan

TOEIC 頻出の英単語と熟語を 4 択クイズで反復学習する、静的 Web アプリ。

公開先: https://kanarikayui.github.io/moku-tan/

## 特徴

- **曖昧な選択肢が出ない** — 各語に意味グループ (`senses`) と語族 (`root`) を持たせ、
  同義語・派生語・訳語が重なる語を誤答から機械的に排除する
- **英日どちらの方向でも出題** — 英語→日本語 / 日本語→英語 / ランダム
- **忘れた語ほど多く出る** — 不正解語は A 問後、正解語は B 問後 (A < B) から再出題。
  さらに正答率・超過日数・連続正解数で重みを付けた抽選で、未出題語も一定割合で混ぜる
- **統計を記録** — 通算・方向別・難易度別・タグ別の正答率、直近 30 日の学習量、苦手な語
- **オフラインで動く** — 外部通信ゼロ。学習履歴はブラウザの localStorage にのみ保存する

## 開発

ES モジュールは `file://` では読めないため、HTTP サーバー経由で開く。

```sh
python3 -m http.server 8000 --directory docs
# → http://localhost:8000/
```

テストとデータ検証（コミット前に両方通す）:

```sh
node --test "tests/**/*.test.mjs"
node tools/validate-data.mjs
```

ビルドツール・npm パッケージ・外部 CDN は使わない。詳細な設計方針は [CLAUDE.md](./CLAUDE.md) を参照。

## ライセンス

[MIT](./LICENSE)
