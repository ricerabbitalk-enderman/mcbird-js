// 無名関数スコープ.
(async () => {
  // 厳密モード.
  'use strict';

  // モジュール読み込み.
  const fs   = require('fs');
  const path = require('path');

  // 引数チェック.
  if (process.argv.length < 4) {
    console.error('Usage: node js/nest.js <input_dir> <output_dir>');
    process.exit(1);
  }

  // 引数取得.
  const input_dir  = path.resolve(process.argv[2]);
  const output_dir = path.resolve(process.argv[3]);

  // テスト構造格納用オブジェクト.
  const test = {};

  // 関数名の取得.
  // <namespace>:<path> 形式で取得します.
  function get_function_namespace(filepath, root_dir) {
    const relative_path = path.relative(root_dir, filepath);
    const parts = relative_path.split(path.sep);
    
    // data/namespace/function/... の形式であることを確認する.
    // parts[0] は data である必要がある.
    // <root_dir>/<datapack_name>/data/<namespace>/function/<...(function_path)>
    if (parts.length < 4 || parts[0] !== 'data' || parts[2] !== 'function') {
      return null;
    }

    const namespace = parts[1];
    // function 以下のパスを結合し、拡張子を除去.
    // Minecraft の名前空間は / 区切りなので join('/') を使用.
    const function_path = parts.slice(3).join('/').replace(/\.mcfunction$/, '');
    return `${namespace}:${function_path}`;
  }

  // ファイル解析.
  function parse_file(filepath) {
    const content = fs.readFileSync(filepath, 'utf8');
    const lines = content.split('\n');
    
    let unit_name   = null;
    let suite_name  = null;
    let case_name   = null;
    let is_setup    = false;
    let is_teardown = false;
    let is_pinpoint = false;

    for (const line of lines) {
      // キーワード毎に処理を分岐.
      const trimmed = line.trim();
      if (trimmed.startsWith('#:unit ')) {           // #:unit <unit_name>
        unit_name = trimmed.substring(7).trim();
      } else if (trimmed.startsWith('#:suite ')) {   // #:suite <suite_name>
        suite_name = trimmed.substring(8).trim();
      } else if (trimmed.startsWith('#:case ')) {    // #:case <case_name>
        case_name = trimmed.substring(7).trim();
      } else if (trimmed.startsWith('#:setup')) {    // #:setup
        is_setup = true;
      } else if (trimmed.startsWith('#:teardown')) { // #:teardown
        is_teardown = true;
      } else if (trimmed.startsWith('#:pinpoint')) { // #:pinpoint
        is_pinpoint = true;
      }
    }

    // 必要な情報が揃っている場合のみ登録.
    // unit, suite, case (setup, teardown) が揃っていないと構築できないので.
    if (unit_name && suite_name && (case_name || is_setup || is_teardown)) {
      // 関数名 <namespace>:<path> 形式で取得.
      const function_name = get_function_namespace(filepath, input_dir);
      if (function_name) {
        test[unit_name] = test[unit_name] || {};
        test[unit_name][suite_name] = test[unit_name][suite_name] || {};

        if (is_setup) {
          // #:setup は __setup に登録.
          test[unit_name][suite_name].__setup = function_name;
        } else if (is_teardown) {
          // #:teardown は __teardown に登録.
          test[unit_name][suite_name].__teardown = function_name;
        } else {
          // #:case は通常登録.
          test[unit_name][suite_name][case_name] = function_name;
          // #:pinpoint 宣言があった場合はピンポイントテストユニットに追加.
          if (is_pinpoint) {
            test.__pinpoint = test.__pinpoint || {};
            test.__pinpoint[suite_name] = test.__pinpoint[suite_name] || {};

            test.__pinpoint[suite_name][case_name] = function_name;
          }
        }
      }
    } else if (unit_name || suite_name || case_name || is_setup || is_teardown) {
      // 情報不足時は警告ログを出力する.
      console.warn(`[WARNING] incomplete test definition in ${path.relative(input_dir, filepath)}`);
      if (!unit_name) console.warn('  missing #:unit');
      if (!suite_name) console.warn('  missing #:suite');
      if (!case_name && !is_setup && !is_teardown) console.warn('  missing #:case, #:setup or #:teardown');
    }
  }

  // ディレクトリ走査
  // 再帰的に走査していく.
  function scan(dir) {
    if (!fs.existsSync(dir)) return;
    
    const entries = fs.readdirSync(dir, {withFileTypes: true});
    for (const entry of entries) {
      const fullpath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // ディレクトリなら再帰呼出し.
        scan(fullpath);
      } else if (entry.isFile() && entry.name.endsWith('.mcfunction')) {
        // ファイルなら解析.
        parse_file(fullpath);
      }
    }
  }

  // 実行.
  // データパックのルートから走査開始.
  scan(input_dir);

  // 検証.
  // 動作に支障がある or 違和感のある構造に対して警告ログを出力する.
  for (const unit in test) {
    for (const suite in test[unit]) {
      const suite_structure = test[unit][suite];
      // setup がない.
      if (!suite_structure.__setup) {
        console.warn(`[WARNING] missing setup in ${unit} > ${suite}`);
      }
      // teardown がない.
      if (!suite_structure.__teardown) {
        console.warn(`[WARNING] missing teardown in ${unit} > ${suite}`);
      }
      // case 登録数が 0.
      // setup, teardown が存在するのに case が全く無い場合.
      const cases = Object.keys(suite_structure).filter(key => key !== '__setup' && key !== '__teardown');
      if (cases.length === 0) {
        console.warn(`[WARNING] no cases found in ${unit} > ${suite}`);
      }
    }
  }

  // ファイルのコピーと変換.
  // 付属機能のプリプロセッサを解決.
  function transform_test_commands(content, filepath, root_dir) {
    const function_name = get_function_namespace(filepath, root_dir) || path.relative(root_dir, filepath).replace(/\\/g, '/');
    const lines = content.split('\n');

    const transformed_content = [];

    for (let index = 0; index < lines.length; index++) {
      const line    = lines[index];
      const trimmed = line.trim();

      const test_keyword = '#:test ';
      if (trimmed.startsWith(test_keyword)) {
        // テスト用プリプロセッサ.
        const assert_keyword = ' assert ';
        const deny_keyword   = ' deny ';
        const failure_keyword = ' failure ';

        // #:test failure ...
        // 無条件で失敗するので下記の assert, deny のような条件判定は不要.
        const failure_index = trimmed.indexOf(failure_keyword);
        if (failure_index !== -1) {
          const fail_message = trimmed.substring(failure_index + failure_keyword.length).trim();
          const escaped_message = fail_message.replace(/"/g, '\\"');
          const nbt = `{file:"${function_name}",line:${index + 1},message:"${escaped_message}"}`;
          transformed_content.push(`return run function nest:failex ${nbt}`);
          continue;
        }

        // #:test ... assert(deny) ... という書式なので
        // #:test を検知したら最初に出てくる assert(deny) を探す.
        // 文法などを意識しない単なる置き換え実装なのでキーワード以外に assert, deny があると動作が壊れる.
        let keyword_index = trimmed.indexOf(assert_keyword);
        let keyword = assert_keyword;
        let command_type = 'unless';
        let message = 'assertion failed!!';

        // キーワードは assert 優先.
        if (keyword_index === -1) {
          keyword_index = trimmed.indexOf(deny_keyword);
          keyword = deny_keyword;
          command_type = 'if';
          message = 'denied expression!!';
        }

        // 見つかった assert(deny) で区切って置き換え.
        if (keyword_index !== -1) {
          // 前提条件 #:test (...) assert(deny) を取得.
          const condition = trimmed.substring(test_keyword.length, keyword_index).trim();
          // 評価式 assert(deny) (...) を取得.
          const expression = trimmed.substring(keyword_index + keyword.length).trim();
          // エスケープ処理 (エラーメッセージで expression をそのまま出力するのでエスケープが必要).
          const escaped_expression = expression.replace(/"/g, '\\"');
          // エラーメッセージ.
          // 行番号は 1 から始まる整数なので 0 から始まる index に 1 加算する必要あり.
          const full_message = `${message} (${escaped_expression})`;
          const nbt = `{file:"${function_name}",line:${index + 1},message:"${full_message}"}`;
          // 前提条件は存在しない場合があるので空文字対応が必要.
          const execute_prefix = condition ? `${condition} ` : '';
          // 前提条件を keyword_index - 1 ではなく keyword_index で取っているので末尾にスペースがあるか空文字.
          // なので ${execute_prefix} ${command_type} とするとスペース過多になる.
          transformed_content.push(`execute ${execute_prefix}${command_type} ${expression} run return run function nest:failex ${nbt}`);
        } else {
          // assert/deny がない不正な形式の場合は、クリーンアップ処理で削除されるようにそのまま残す
          transformed_content.push(line);
        }
      } else {
        // こちらも不正な形式は最終的なクリーンアップをするのでそのままで処理.
        transformed_content.push(line);
      }
    }
    return transformed_content.join('\n');
  }

  // #: コメントを全削除.
  // 行番号が変わる可能性があるが
  // その手前で元ソースの行番号は全て取得しているので問題なし.
  function cleanup_directives(content) {
    return content.split('\n')
      .filter(line => !line.trim().startsWith('#:'))
      .join('\n');
  }

  // プリプロセス処理を行いつつ全ファイルを出力先にコピー.
  // サブディレクトリも再帰的に走査.
  function preprocess_and_copy_files(source, destination) {
    // 出力先にディレクトリ生成.
    fs.mkdirSync(destination, {recursive: true});
    // ディレクトリ内のファイル or ディレクトリを処理.
    const entries = fs.readdirSync(source, {withFileTypes: true});
    for (const entry of entries) {
      const source_path = path.join(source, entry.name);
      const destination_path = path.join(destination, entry.name);

      if (entry.isDirectory()) {
        // 再帰呼出し.
        preprocess_and_copy_files(source_path, destination_path);
      } else if (entry.isFile()) {
        // .mcfunction なら処理をはさむ.
        if (entry.name.endsWith('.mcfunction')) {
          let content = fs.readFileSync(source_path, 'utf8');
          content = transform_test_commands(content, source_path, input_dir);
          content = cleanup_directives(content);
          fs.writeFileSync(destination_path, content);
        } else {
          fs.copyFileSync(source_path, destination_path);
        }
      }
    }
  }
  preprocess_and_copy_files(input_dir, output_dir);

  // テストケースが全く存在しない場合は nest 名前空間の生成を行わずに終了.
  if (Object.keys(test).length === 0) {
    return;
  }

  // ログ出力とエイリアス生成.
  const alias_dir = path.join(output_dir, 'data', 'nest', 'tags', 'function', 'alias');
  fs.mkdirSync(alias_dir, {recursive: true});

  // どのような構造になっているか分かるようログ出力をしつつ
  // nest のマクロから呼び出せるよう平坦化された alias 関数タグを生成.
  for (const unit in test) {
    console.log(unit);
    for (const suite in test[unit]) {
      console.log(`  ${suite}`);
      for (const case_name in test[unit][suite]) {
        // nest:alias/<unit>-<suite>-<case> で呼び出せる形式に平坦化.
        const funcName = test[unit][suite][case_name];
        const tag_path = path.join(alias_dir, `${unit}-${suite}-${case_name}.json`);
        const tag_content = {
          replace: true, // alias (別名) なので複数登録されてはいけない.
          values: [funcName]
        };
        fs.writeFileSync(tag_path, JSON.stringify(tag_content, null, 2));

        // __setup, __teardown はログ出力不要.
        if (case_name === '__setup' || case_name === '__teardown') continue;
        console.log(`    ${case_name}`);
      }
    }
  }

  // ユニットごとの登録関数生成.
  const generated_dir = path.join(output_dir, 'data', 'nest', 'function', '__generated');
  fs.mkdirSync(generated_dir, {recursive: true});

  // nest で読み取れるデータタグ構造を構築.
  for (const unit in test) {
    const suites_data = [];
    for (const suite in test[unit]) {
      const suite_structure = test[unit][suite];
      const setup_alias     = `${unit}-${suite}-__setup`;
      const teardown_alias  = `${unit}-${suite}-__teardown`;
      const cases = Object.keys(suite_structure)
        .filter(key => key !== '__setup' && key !== '__teardown')
        .map(case_name => `${unit}-${suite}-${case_name}`);

      suites_data.push(`{suite:${suite},setup:${setup_alias},teardown:${teardown_alias},cases:[${cases.join(',')}]}`);
    }
    const command = `data modify storage nest:data ${unit} set value [${suites_data.join(',')}]`;
    fs.writeFileSync(path.join(generated_dir, `${unit}.mcfunction`), command);
  }

  // 登録関数を呼び出すロードタグを生成.
  const load_json_path = path.join(output_dir, 'data', 'nest', 'tags', 'function', 'load.json');
  const generated_functions = Object.keys(test).map(unit => `nest:__generated/${unit}`);

  let load_json_content = {
    replace: false, // 複数のテストデータパックを持つ可能性があるので上書き厳禁.
    values: []
  };

  // 念のため既存の #nest:load が存在した場合読み取って
  // 今回の登録関数を追加する.
  if (fs.existsSync(load_json_path)) {
    try {
      const existing_content = fs.readFileSync(load_json_path, 'utf8');
      const existing_json = JSON.parse(existing_content);
      if (existing_json && Array.isArray(existing_json.values)) {
        load_json_content = existing_json;
        load_json_content.replace = false; // 念のため false に設定
      }
    } catch (error) {
      // 壊れた json だった場合は既存を破棄して新規のみ出力する流れ (ログ出力のみ).
      console.warn(`[WARNING] could not parse existing load.json: ${error.message}. overwriting.`);
    }
  }

  // 既存と新規を合成して出力.
  const merged_values = new Set([...load_json_content.values, ...generated_functions]);
  load_json_content.values = Array.from(merged_values);
  fs.writeFileSync(load_json_path, JSON.stringify(load_json_content, null, 2));
})();