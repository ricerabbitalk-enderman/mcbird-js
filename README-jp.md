# mcbird-js for egg ver.1.5.2

utility script for mcbird (required Node.js)

## mcbird-js/nest.js

nest データパックを補助するコンバータです。

### 使い方

```bash
node mcbird/nest.js <input_dir> <output_dir>
```

|コマンドライン引数|意味|
|:-|:-|
|input_dir|テストを記述したデータパック|
|output_dir|nest 用に変換されるデータパック保存先|

### 例

データパック内のテストケース(mcfunction)冒頭に

```mcfunction
#:unit <unit_name>
#:suite <suite_name>
#:case <case_name>
```

というコメントを記述しておきます。
\<unit_name>, \<suite_name>, \<case_name> は " なしで記述してください.
" を省略して記述できない文字列は利用できません (文字列先頭が[半角英数] or _ であること)

テストケースは戻り値で

|戻り値|動作|
|:-|:-|
|0|テスト続行|
|1|テスト成功|
|-1|テスト失敗|

となる関数です。

データパック内のテストスイートの構築・解体(mcfunction)も冒頭に

```mcfunction
#:unit <unit_name>
#:suite <suite_name>
#:setup or #:teardown
```

というコメントを記述しておきます。

テストスイートは \<suite_name> で登録された全てのテストケースに対して
共通の前処理と後処理を追加する仕組みで

|戻り値|動作|
|:-|:-|
|fail|テスト失敗|
|1|テスト成功|

となる関数です。

現段階の仕様ではテストスイートを省略してテストケースだけを登録することはできません。

\<suite_name> のテストスイートに \<case_name> のテストケースを登録する場合
`#:setup` / `#:teardown` がそれぞれ記述された関数(mcfunction)を必ず用意してください。

これらの記述がされていれば mcbird/nest.js で変換することで

```mcfunction
function nest:run {unit:\<unit_name>}
```

とすれば <unit_name> のテストが実行されるようになります、

(実行のためには変換したデータパックと nest データパックの両方が読み込まれていなければなりません)

### 便利機能

```mcfunction
#:test ...(条件) assert ...(評価式)
#:test ...(条件) deny ...(評価式)
```

というコメントは

```mcfunction
execute ...(条件) unless ...(評価式) run return run function nest:failex {...}
execute ...(条件) if ...(評価式) run return run function nest:failex {...}
```

に変換されます。

assert は評価式が必ず成立するという明言であり、成立しなければテストが失敗します。

deny は評価式の成立を絶対に拒絶するという明言であり、成立すればテストが失敗します。

関数の末尾に到達しないはず（途中リターンする前提）のテストケースでそこに到達してしまった場合

```mcfunction
#:test failure
```

と記述すればそこでテストが失敗します.

`function nest:fail` マクロを使わずにこの特殊コメントを使うメリットは
変換時にファイル名と行番号を情報に埋め込む点です。

テストケースにおいてファイル名と行番号は最も重要です。

わざわざテスト失敗箇所でメッセージを書き分けるよりはるかに失敗箇所を探しやすくなります。

ただし `#:test` は単純に置き換えているだけであり文法のチェックが入らないので
記述ミスに細心の注意を払ってください.

```mcfunction
execute ...(条件) if ...(評価式) run say e
```

と書いてみて文法エラーがないことを確認してから

```mcfunction
#:test ...(条件) assert/deny ...(評価式)
```

と書き換えて利用することを推奨します.

## mcbird-js/bde2egg.js

mcbird/bde2egg.js by ricerabbitalk-enderman
BDEngine が出力するモデルデータ（ディレクトリ or zipアーカイブ）から
モデルデータとアニメデータを egg:animation で利用可能なデータパック形式に変換します.

### 使い方

```bash
node mcbird/bde2egg.js <model_dir> <output_dir> [<chunk_size = 50>]
```

|コマンドライン引数|意味|
|:-|:-|
|model_dir|複数のモデルデータが格納されているルディレクトリ|
|output_dir|データパックを出力するディレクトリ|
|chunk_size|１つのファイルに格納するデータ単位（フレーム数）|

### 例

<model_dir>/<model_name>.zip

というモデルデータが存在した場合

<output_dir>

というデータパックを生成します。

モデルエンティティの生成は

```mcfunction
function #egg:bdengine/<model_name>
```

という関数タグで実行可能です。

初期化処理にエンティティを探索しやすいよう
`__uninitialized` タグが付与された状態で召喚されます。

`__uninitialized` タグは初期化後必ず削除してください。

アニメデータは

```mcfunction
storage egg:bdengine <model_name>-<animation_name>
```

に格納されています。

### egg での利用

egg で利用する際は

```mcfunction
# モデル生成.
function #egg:bdengine/<model_name>
# egg:model 機能を有効化.
execute as @e[tag=__uninitialized] run function egg:model/-enable
# egg:animation 機能を有効化.
execute as @e[tag=__uninitialized] run function egg:animation/-enable
# アニメデータを設定.
data modify egg:animation/-set << {repeat:-1,path:<model_name>-<animation_name>}
execute as @e[tag=__uninitialized] run function egg:animation/-set
# アニメーションを再生.
execute as @e[tag=__uninitialized] run function egg:animation/-play
# 初期化処理終了.
tag @e[tag=__uninitialized] remove __uninitialized
```

としてください。

簡略化されたマクロ版もあります。

こちらも `__uninitialized` が付与された状態で生成されるので、追加の初期化が完了したら `tag @e[tag=__uninitialized] remove __uninitialized`　で削除してください。

```mcfunction
# モデルエンティティを生成（アニメーションなし）.
function egg:nog/macro/new_model {model:<model_name>}
# モデルエンティティを生成しアニメーションさせる.
function egg:nog/macro/new_animation {repeat:-1,model:<model_name>,anime:<animation_name>}
# 既存のモデルエンティティにアニメーションさせる.
execteu as @e[...] run function egg:nog/macro/play_animation {repeat:-1,model:<model_name>,anime:<animation_name>}
```
