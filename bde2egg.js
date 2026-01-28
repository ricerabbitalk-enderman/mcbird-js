// 無名関数スコープ.
(async () => {
  // 厳密モード.
  'use strict';

  // 設定変数.
  const NEARLY_ZERO = 1e-6;
  const MIN_VERSION = [82, 0];
  const MAX_VERSION = [94, 1];
  const FILE_HEADER = '# this data is created via BDEngine.\n# Processed by mcbird/bde2egg.js.\n';

  // モジュール読み込み.
  const path = require('path');
  const fs   = require('fs');
  const {execSync} = require('child_process');
  const os   = require('os');

  // SNBT を Json に変換する解析クラス.
  class JsonFromSNBT {
    // コンストラクタ.
    constructor(snbt) {
      this._index = 0;
      this._snbt  = snbt;
    }
    // スペース文字のスキップ.
    #skipWhitespace() {
      while (this._index < this._snbt.length && /\s/.test(this._snbt[this._index])) this._index++;
    }
    // 今のトークンを取得.
    #peek() {
      this.#skipWhitespace();
      return this._snbt[this._index];
    }
    // 対象トークンを消費.
    // 文字が一致したらその次の要素へ移動し true を返す.
    // 文字が一致しないと消費しない（次の要素に行かない）.
    #consume(char) {
      this.#skipWhitespace();
      if (this._snbt[this._index] === char) {
        this._index++;
        return true;
      }
      return false;
    }
    // クォート不要の文字列として解析.
    #parseNoneQuoteString() {
      const start = this._index;
      // 末尾に至るかクォート不要の文字以外が検知されたら文字列取得終了.
      // NOTE: 本当は 0~9, +, - は文字列の先頭に配置できませんが今回は簡単のため省略しています.
      while (this._index < this._snbt.length && /[a-zA-Z0-9._+\-]/.test(this._snbt[this._index])) {
        this._index++;
      }
      return this._snbt.substring(start, this._index);
    }
    // 文字列解析.
    #parseString() {
      this.#skipWhitespace();
      // クォートがあればクォートの終わりまでが文字列.
      const quote = this._snbt[this._index];
      if (quote === '"' || quote === "'") {
        this._index++; // 開始クォートをスキップ.
        let str = '';  // 取得される文字列
        while (this._index < this._snbt.length) {
          const char = this._snbt[this._index++];
          if (char === '\\') {
            // エスケープはスキップ.
            str += this._snbt[this._index++];
          } else if (char === quote) {
            // クォートの終わりに到達したら文字列取得.
            return str;
          } else {
            // クォートの終わりに来るまで文字を追加.
            str += char;
          }
        }
        throw new Error("ERROR: invalid string at " + this._index);
      }
      // クォート不要の文字列として解析.
      // parseValue() から呼び出される際はクォート不要の文字列は対象外ですが
      // コンパウンドからはダイレクトに呼ばれるので必要.
      return this.#parseNoneQuoteString();
    }
    // 値の解析.
    #parseValue() {
      this.#skipWhitespace();

      const char = this._snbt[this._index];
      // コンパウンド解析へ.
      if (char === '{') return this.#parseCompound();
      // リスト解析へ.
      if (char === '[') return this.#parseListOrArray();
      // 文字列解析へ.
      if (char === '"' || char === "'") return this.#parseString();

      // クォートなし文字列トークン取得.
      // クォートなしの文字列は true, false, 数値, クォートなしの文字列が候補としてあげられる.
      const token = this.#parseNoneQuoteString();

      // 真偽値判定.
      if (token === 'true') return true;
      if (token === 'false') return false;

      // 数値判定.
      // [-][数字列(必須）][.][数字列][e or E][+ or -][数字列][b s l f d の型を表現する接尾辞]
      // 実際の数値抽出は Number() に任せるので、上記の条件を満たすかどうかを判定すれば良い.
      if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?[bBsSlLfFdD]?$/.test(token)) {
        // 接尾辞だけは SNBT 特有の概念なので見つけ次第除外する.
        const last_char = token.slice(-1).toLowerCase();
        let raw_value = token;
        if (['b', 's', 'l', 'f', 'd'].includes(last_char)) {
          raw_value = token.slice(0, -1);
        }
        // Number() で数値変換し、正しく数値を取り出せたら数値として取得.
        const num = Number(raw_value);
        if (!isNaN(num)) return num;
      }
      // 残りはクォートなしの文字列扱い.
      return token;
    }
    // コンパウンド(連想配列タイプ)の解析.
    #parseCompound() {
      this.#consume('{');
      const object = {};
      // {xxx:yyy} でワンセット.
      // parseValue() と共に再帰的に呼び出され合う.
      while (this.#peek() !== '}') {
        const key = this.#parseString();
        this.#consume(':');
        object[key] = this.#parseValue();
        // コンパウンドは {aa:bb,cc:dd,ee:ff,...} という形式になるので
        //  , があれば続きがあると解釈し続行.
        // なければコンパウンドは閉じる(はず)と解釈して終了.
        if (!this.#consume(',')) break;
      }
      this.#consume('}');
      return object;
    }
    // 配列（リスト）の解析.
    #parseListOrArray() {
      this.#consume('[');
      // [I;xxx,xxx,xxx] のような型宣言が先頭につくリストスタイルに対応します.
      // 判定方法は簡単に I を判定せずその次の ; を判定しています.
      if (this._snbt.length > this._index + 1 && this._snbt[this._index + 1] === ';') {
        this._index += 2;
      }
      // [xxx, yyy, zzz] という形式で
      // 値は parseValue() に投げられます.
      const list = [];
      while (this.#peek() !== ']') {
        list.push(this.#parseValue());
        // , でなくなれば ] を期待して終了します.
        if (!this.#consume(',')) break;
      }
      this.#consume(']');
      return list;
    }
    // 解析実行.
    parse() {
      return this.#parseValue();
    }
  }

  // Json から SNBT へ変換するシリアライズクラス.
  class JsonToSNBT {
    static serialize(data, key = null) {
      // 文字列変換.
      if (typeof data === 'string') {
        return `"${data.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      }
      // 数値変換.
      if (typeof data === 'number') {
        // none suffix number.
        // 文字数削減のため、小数点以下6桁に丸める
        const rounded = parseFloat(data.toFixed(6));
        return rounded.toString();
      }
      // 真偽値変換.
      if (typeof data === 'boolean') {
        return data ? 'true' : 'false';
      }
      // 配列変換.
      if (Array.isArray(data)) {
        if (key === 'transformation') {
          // transformation 配列はすべて float なので例外的に f 接尾辞を追加.
          const elements = data.map(e => {
            let val = e;
            if (typeof val === 'number') {
              if (val === 0) val = NEARLY_ZERO; // 0 は storage に残らないので限りなく 0 に近い値に変換.
              let rounded = parseFloat(val.toFixed(6));
              if (rounded === 0 && val !== 0) { // 丸められた 0 も 0 に近い値に変換.
                rounded = val > 0 ? NEARLY_ZERO : -NEARLY_ZERO;
              }
              return rounded.toString() + 'f';
            }
            return JsonToSNBT.serialize(e);
          }).join(',');
          return `[${elements}]`;
        }
        const elements = data.map(e => JsonToSNBT.serialize(e)).join(',');
        // id:[I;xxx,xxx,xxx,xxx] はプレイヤーの頭などで利用されるため例外処理.
        return key === 'id' ? `[I;${elements}]` : `[${elements}]`;
      }
      // オブジェクト変換.
      if (typeof data === 'object' && data !== null) {
        const entries = Object.entries(data).map(([k, v]) => {
          // キーにクォートが必要かどうかを判別.
          let compound_key = /^[a-zA-Z0-9._+-]+$/.test(k) ? k : `"${k}"`;
          // BDEngine では Count となっているが現在は count なので修正.
          if (compound_key === 'Count') {
            compound_key = 'count';
          }
          return `${compound_key}:${JsonToSNBT.serialize(v, k)}`;
        });
        return `{${entries.join(',')}}`;
      }
      // かなり問題あるケースだがシリアライズ自体が失敗しないための処理.
      return '';
    }
  }

  // モデルデータ変換.
  function convert_model(input_dir, output_dir, name) {
    // モデル生成ファイル名.
    const create_filename = path.join(input_dir, 'data', name, 'function', '_', 'create.mcfunction');
    
    // 元データ取得.
    const bde_data = fs.readFileSync(create_filename, 'utf8');
    if (bde_data === null)
      throw Error('create.mcfunction not found.');

    // 該当データタグ取得.
    const match = bde_data.match(/Passengers:(\[.*\]),Tags:/s);
    if (!match)
      throw Error('Passengers data not found.');
    
    // Passengers をデータ化.
    const passengers = new JsonFromSNBT(match[1]).parse();

    // 横並びだった Passengers エンティティ達を Passengers を利用して縦に積み上げる.
    // 頂上のエンティティが index + 1 を参照しても undefined なので問題ない.
    for (let index = 0; index < passengers.length - 1; index++) {
      passengers[index].Tags.push('__part');
      passengers[index].Passengers = [passengers[index + 1]];
    }

    // ルートエンティティのデータタグ.
    // これまでの Passengers はモデルのパーツであり
    // egg で操作するときはこのルートが軸になる.
    const root_data_tag = {
      Tags: ['ignis', '__uninitialized'],
      Passengers: [passengers[0]]
    }
    // mcfunction 書き出し.
    fs.writeFileSync(path.join(output_dir, 'new.mcfunction'), FILE_HEADER + `return run summon block_display ~ ~ ~ ${JsonToSNBT.serialize(root_data_tag)}`);
  }

  // アニメデータ変換.
  function convert_animation(input_dir, output_dir, name, animation_name, chunk_size) {
    // キーフレーム情報を格納しているディレクトリ.
    const keyframe_dir = path.join(input_dir, 'data', name, 'function', 'k', animation_name);

    // ディレクトリの存在確認.
    if (!fs.existsSync(keyframe_dir))
      throw Error(`Directory not found: ${keyframe_dir}`);

    const keyframe = [];

    // 該当ファイル群取得.
    // キーフレームファイルは keyframe_[数値(0 詰めなし)]となっている.
    const files = fs.readdirSync(keyframe_dir).filter(f => /^keyframe_\d+\.mcfunction$/.test(f));

    // ファイル名からフレーム番号順にソート.
    files.sort((a, b) => {
      const a_num = parseInt(a.match(/^keyframe_(\d+)\.mcfunction$/)[1]);
      const b_num = parseInt(b.match(/^keyframe_(\d+)\.mcfunction$/)[1]);
      return a_num - b_num;
    });

    // transformation の配列情報のみを keyframe に取得していく.
    // keyframe_x.mcfunction 内にはパーツごとの transformation が番号順に並んでいる.
    // keyframe は keyframe[no] のパーツ番号ごとに transformation を格納した2次元配列となる.
    files.forEach(file => {
      // フレーム番号.
      const frame_no = parseInt(file.match(/^keyframe_(\d+)\.mcfunction$/)[1]);
      // BDEngine のデータ.
      const bde_data = fs.readFileSync(path.join(keyframe_dir, file), 'utf8');

      const transformations = [];
      
      // transformations にパーツごとの transformation 情報を取得..
      const regex = /transformation:\[([^\]]+)\]/g;
      let match;
      while ((match = regex.exec(bde_data)) !== null) {
        // , で区切りながら各要素（実数値）に対して 0 対策を施す.
        // storage 上で保存された 0 は法滅するので最小の正数値に変換.
        // 結果として実数の配列化されて values を取得.
        const values = match[1].split(',').map(v => {
          return parseFloat(v.trim());
        });
        // BDEngine の出力した mcfunction ではパーツ番号順にコードが並んでいるので
        // unshift で先頭に追加していく.
        // 再帰呼出しで配列の末尾からアクセスしていくので順序が逆でなければならない.
        if (values.length > 0) {
          transformations.unshift(values);
        } else {
          transformations.unshift(transformations[0]);
        }
      }
      // transformation が見つからなかった場合は一つ手前のフレームをコピー.
      if (transformations.length === 0 && keyframe[0]) {
        // 参照渡しを防ぐため新しい配列としてコピー.
        keyframe.unshift(keyframe[0].map(v => [...v]));
      } else {
        // パーツの transformation 情報を全部配列形式に格納した transformations を keyframe に保存.
        keyframe.unshift(transformations);
      }
    });

    // シリアライズは短縮版.
    // データが float しか存在しないため.
    function serialize(data) {
      // 配列の変換.
      if (Array.isArray(data)) {
        const result = [];
        for (let index = 0; index < data.length; index++) {
          const value = data[index];
          // フレーム番号レベルで穴があると困るものの
          // 全く動かないフレームはあるので空のフレームは存在しうる.
          if (value === undefined) {
            result.push('[]');
          } else {
            result.push(serialize(value));
          }
        }
        return `[${result.join(',')}]`;
      }
      // 数値の変換.
      if (typeof data === 'number') {
        let val = data;
        // 0 は storage に残らないので限りなく 0 に近い値に変換.
        if (val === 0) {
          val = NEARLY_ZERO;
        }
        // 小数点以下6桁に丸め、parseFloatで数値に戻すことで末尾の不要な0を除去する.
        let rounded = parseFloat(val.toFixed(6));
        // 丸めによって 0 になってしまった場合の対策.
        if (rounded === 0 && val !== 0) {
          // toFixed(6) で 0 にならない最小値.
          rounded = val > 0 ? NEARLY_ZERO : -NEARLY_ZERO;
        }
        return `${rounded}f`; // f の接尾辞を追加.
      }
      // ここに来るデータがあるとかなり難あり.
      return JSON.stringify(data);
    }

    // mcfunction 書き出し.
    // 指定されたフレーム数ごとに分割して append していく.
    // 膨大な文字数は読み込みを拒絶されるので適切な分量で区切る必要がある.
    // egg:animation の実装上でも適度なサイズが理想的.

    // 分割ページ数.
    let page = 1;
    // 親関数が呼び出す子関数の実行コマンドリスト.
    const sub_functions = [];

    // chunk_size 毎に区切っていく.
    for (let index = 0; index < keyframe.length; index += chunk_size) {
      // データチャンク.
      const chunk = keyframe.slice(index, index + chunk_size);

      // 子関数の実装.
      const content = `data modify storage egg:bdengine ${name}-${animation_name} append value ${serialize(chunk)}`;

      // 子関数生成.
      const sub_filename = `${animation_name}-${page}`;
      fs.writeFileSync(path.join(output_dir, `${sub_filename}.mcfunction`), FILE_HEADER + content);
      // 子関数の実行コマンド追加.
      sub_functions.push(`function egg:bdengine/${name}/${sub_filename}`);
      // 次のページへ.
      page++;
    }
    // 親関数生成.
    const init_command = `data modify storage egg:bdengine ${name}-${animation_name} set value []\n`;
    fs.writeFileSync(path.join(output_dir, `${animation_name}.mcfunction`), FILE_HEADER + init_command + sub_functions.join('\n'));
    // load.json への登録情報を返す.
    return `egg:bdengine/${name}/${animation_name}`;
  }

  // 解凍処理.
  function unzip(source, destination) {
    if (os.platform() === 'win32') {
      // PowerShell を利用 (シングルクォートは '' でエスケープ).
      // PowerShell なしの Windows では zip 解凍は動作しない.
      const src = source.replace(/'/g, "''");
      const dst = destination.replace(/'/g, "''");
      execSync(`powershell -command "Expand-Archive -LiteralPath '${src}' -DestinationPath '${dst}' -Force"`);
    } else {
      // unzip コマンドを利用.
      execSync(`unzip -o "${source}" -d "${destination}"`);
    }
  }

  // ディレクトリ生成.
  function make_directory(path) {
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path, { recursive: true });
    }
  }

  // データパックのルート生成.
  function make_datapack_root(datapack_root, min_format = MIN_VERSION, max_format = MAX_VERSION) {
    // ディレクトリ生成.
    make_directory(datapack_root);
    // pack.mcmeta 生成.
    fs.writeFileSync(path.join(datapack_root, 'pack.mcmeta'), JSON.stringify({
      "pack": {
        "min_format": min_format,
        "max_format": max_format,
        "description": "Data set of BDEngine model and animation."
      }
    }, null, 2));
  }

  // load.json 生成.
  function make_load_json(datapack_root, load_functions) {
    // ディレクトリ生成.
    const load_tag_dir = path.join(datapack_root, 'data', 'minecraft', 'tags', 'function');
    make_directory(load_tag_dir);
    // load.json 生成.
    fs.writeFileSync(path.join(load_tag_dir, 'load.json'), JSON.stringify({
      "replace": false,
      "values": load_functions
    }, null, 2));
  }

  // アニメデータセットの変換.
  function convert_animation_set(input_dir, output_dir, model_name, chunk_size) {
    // キーフレームが格納されているルートディレクトリ.
    const keyframe_root = path.join(input_dir, 'data', model_name, 'function', 'k');

    // ディレクトリ走査.
    let load_functions = [];
    if (fs.existsSync(keyframe_root)) {
      fs.readdirSync(keyframe_root, {withFileTypes: true}).forEach(entry => {
        if (entry.isDirectory()) {
          // アニメデータの変換.
          load_functions.push(convert_animation(input_dir, output_dir, model_name, entry.name, chunk_size));
        }
      });
    }
    return load_functions;
  }

  try {
    // 引数チェック.
    if (process.argv.length < 4 || process.argv.length > 5)
      throw Error('invalid arguments has been given.');

    // 引数取得.
    const model_dir   = path.resolve(process.argv[2]);
    const output_dir  = path.resolve(process.argv[3]);
    const chunk_size  = parseInt(process.argv[4] || 50);
    
    // データパックルート.
    const datapack_root = output_dir;
    // load.json 関数リスト.
    let load_functions = [];

    // データパック生成.
    make_datapack_root(datapack_root);

    // リフレッシュのため bdengine 以下のディレクトリを削除.
    const bdengine_dir = path.join(datapack_root, 'data', 'egg', 'function', 'bdengine');
    if (fs.existsSync(bdengine_dir)) {
      fs.rmSync(bdengine_dir, {recursive: true, force: true});
    }

    // ディレクトリ走査.
    fs.readdirSync(model_dir, {withFileTypes: true}).forEach(entry => {
      let model_name = entry.name;
      let input_dir  = path.join(model_dir, entry.name);
      let temp_dir   = null;
      let should_process = false; // 処理対象かどうか.

      if (entry.isDirectory()) {
        // 解凍済みディレクトリを対象にする.
        should_process = true;
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.zip') {
        // zip ファイルを解凍して対象にする.
        should_process = true;
        // entry.name == 'xxx.zip' なので拡張子を除外したファイル名で取得.
        model_name = path.parse(entry.name).name;
        // 一時ディレクトリを生成して解凍して入力ディレクトリを設定.
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beak-'));
        unzip(input_dir, temp_dir);
        input_dir = temp_dir;
      }

      if (should_process) {
        try {
          // 出力先ディレクトリ.
          const output_dir = path.join(datapack_root, 'data', 'egg', 'function', 'bdengine', model_name);
          // 出力ディレクトリ作成.
          make_directory(output_dir);
          // モデルデータ変換.
          convert_model(input_dir, output_dir, model_name);
          // モデルデータ呼び出し用の関数タグを生成.
          const model_tag_dir = path.join(datapack_root, 'data', 'egg', 'tags', 'function', 'bdengine');
          make_directory(model_tag_dir);
          const tag_path = path.join(model_tag_dir, `${model_name}.json`);
          const tag_content = {
            replace: true,
            values: [
              `egg:bdengine/${model_name}/new`
            ]
          };
          fs.writeFileSync(tag_path, JSON.stringify(tag_content, null, 2));
          // アニメデータ変換.
          load_functions.push(...convert_animation_set(input_dir, output_dir, model_name, chunk_size));
        } finally {
          // 一時ディレクトリは必ず削除する.
          if (temp_dir) {
            fs.rmSync(temp_dir, { recursive: true, force: true });
          }
        }
      }
    });
    // load.json 生成.
    make_load_json(datapack_root, load_functions);
  } catch (error) {
    console.error('ERROR:', error);
    process.exit(1);
  }
})();
