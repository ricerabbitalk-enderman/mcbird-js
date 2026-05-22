## テストケースの記述

データパック内のテストケース(mcfunction)冒頭に
say コマンドで以下のような XML タグを記述します。

```mcfunction
# テスト関数.
say <nest:case name=... suite=... unit=... />
```

このタグで記述された unit, suite, name に「テスト関数」がテストケースとして登録されます。

「テスト関数」は戻り値で以下のスコアを返すことができます。

```mcfunction
# エラー (=-1).
return run scoreboard players get #nest|error --
# テスト失敗 (=1).
return run scoreboard players get #nest|fail --
# テスト続行 (=2).
return run scoreboard players get #nest|continue --
# テスト成功 (=3).
return run scoreboard players get #nest|pass --
```

「テスト続行」の場合は次のティックでも同じテストケースが呼び出され続けます。
テストを終了する場合は必ず「テスト成功」か「テスト失敗」を戻り値で返してください。

値を返さないか 0 を返した場合は致命的エラーとなりテストが完全に中断されます。

データパック内のテストスイートの「テスト構築」「テスト解体」 (mcfunction) も冒頭に
say コマンドで以下のような XML タグを記述します。

```mcfunction
# テスト構築.
say <nest:setup suite=... unit=... />

# テスト解体.
say <nest:teardown suite=... unit=... />
```

「テスト構築」「テスト解体」関数は戻り値で以下のスコアを返すことができます。

|戻り値|動作|
|:-|:-|
|fail|失敗|
|1|成功|

このようにテストを定義しておくことで `mcbird-nest.js` はテスト環境を構築します。

変換されたデータパックと `mcbird-nest` データパックを読み込み、
以下のマクロ関数を実行することで単体テストが実行されます。

```mcfunction
function nest:run {unit:<unit_name>}
```

### 便利機能

say コマンド内の文字列に `<nest:file />` `<nest:line />` が存在した場合
それぞれファイル名と行番号に置き換えられます。

say コマンドの戻り値は「テスト失敗」と同じ 1 なので
以下のようにしてエラーを発生させることができます。

```mcfunction
# エラーメッセージ (say) と共にテスト失敗.
execute if ... run return run say Failed test case. (<nest:line />): <nest:file />
```