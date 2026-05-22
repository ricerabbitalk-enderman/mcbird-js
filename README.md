# mcbird-js for egg / nest ver.2.0

egg と nest のための **Node.js 変換スクリプト集**です。
データパックでは難しい処理を事前に行います。

## 1. sync.js — ディレクトリ同期ツール

```bash
node mcbird-js/sync.js <input_dir> <output_dir> [plugin1.js] [plugin2.js] ...
```

* ディレクトリをコピーしながら、指定したプラグインで変換処理を実行できます。
* **注意**: コピー元とコピー先を間違えると危険です。必ずバックアップを取ってから実行してください。

## 2. nest.js — 単体テスト用変換プラグイン

```bash
node mcbird-js/sync.js <test_dir> <output_dir> mcbird-js/nest.js
```

テストケースは mcfunction ファイルの先頭に以下のような XML タグを記述します。

```mcfunction
say <nest:case name="テスト名" suite="スイート名" unit="ユニット名" />
```

詳細なテストの書き方は **[nest](docs/nest.md)** を参照。

## 3. bde2egg.js — BDEngine モデル変換ツール

```bash
node mcbird-js/bde2egg.js <model_dir> <output_dir> [chunk_size]
```

BDEngine で出力したモデルデータを、`egg:model` / `egg:animation` で使用可能な形式に変換します。

### パーツ名指定 (任意)

BDEngine の Additional NBT に `data:{alias:<パーツ名>}` と記述すると、`egg:model/define_looks` で見た目を自由に変更できます。