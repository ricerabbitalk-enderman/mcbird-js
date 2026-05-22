/**
 * mcbird-js/bde2egg.js
 * BDEngine形式のモデル・アニメデータをeggデータパック形式に変換する
 * Refactored and optimized with the assistance of AI (Gemini).
 */

'use strict';

const NEARLY_ZERO = 1e-6;
const MIN_VERSION = [101,1];
const MAX_VERSION = [101,1];
const FILE_HEADER = '# this data is created via BDEngine.\n# Processed by mcbird/bde2egg.js.\n';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const os = require('os');

/** SNBTをJSONオブジェクトにパースするクラス */
class JsonFromSNBT {
  constructor(snbt) {
    this._index = 0;
    this._snbt  = snbt;
  }

  #skipWhitespace() {
    while (this._index < this._snbt.length && /\s/.test(this._snbt[this._index])) {
      this._index++;
    }
  }

  #peek() {
    this.#skipWhitespace();
    return this._snbt[this._index];
  }

  #consume(char) {
    this.#skipWhitespace();
    if (this._snbt[this._index] === char) {
      this._index++;
      return true;
    }
    return false;
  }

  #parseNoneQuoteString() {
    const start = this._index;
    while (this._index < this._snbt.length && /[a-zA-Z0-9._+\-]/.test(this._snbt[this._index])) {
      this._index++;
    }
    return this._snbt.substring(start, this._index);
  }

  #parseString() {
    this.#skipWhitespace();
    const quote = this._snbt[this._index];
    if (quote === '"' || quote === "'") {
      this._index++;
      let str = '';
      while (this._index < this._snbt.length) {
        const char = this._snbt[this._index++];
        if (char === '\\') {
          str += this._snbt[this._index++];
        } else if (char === quote) {
          return str;
        } else {
          str += char;
        }
      }
      throw new Error("ERROR: invalid string at " + this._index);
    }
    return this.#parseNoneQuoteString();
  }

  #parseValue() {
    this.#skipWhitespace();

    const char = this._snbt[this._index];
    if (char === '{') return this.#parseCompound();
    if (char === '[') return this.#parseListOrArray();
    if (char === '"' || char === "'") return this.#parseString();

    const token = this.#parseNoneQuoteString();
    if (token === 'true') return true;
    if (token === 'false') return false;

    if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?[bBsSlLfFdD]?$/.test(token)) {
      const lastChar = token.slice(-1).toLowerCase();
      let rawValue = token;
      if (['b', 's', 'l', 'f', 'd'].includes(lastChar)) {
        rawValue = token.slice(0, -1);
      }
      const num = Number(rawValue);
      if (!isNaN(num)) return num;
    }
    return token;
  }

  #parseCompound() {
    this.#consume('{');
    const object = {};
    while (this.#peek() !== '}') {
      const key = this.#parseString();
      this.#consume(':');
      object[key] = this.#parseValue();
      if (!this.#consume(',')) break;
    }
    this.#consume('}');
    return object;
  }

  #parseListOrArray() {
    this.#consume('[');
    if (this._snbt.length > this._index + 1 && this._snbt[this._index + 1] === ';') {
      this._index += 2;
    }
    const list = [];
    while (this.#peek() !== ']') {
      list.push(this.#parseValue());
      if (!this.#consume(',')) break;
    }
    this.#consume(']');
    return list;
  }

  parse() {
    return this.#parseValue();
  }
}

/** JSONオブジェクトをSNBT文字列に変換するクラス */
class JsonToSNBT {
  /**
   * 再帰的にデータをSNBT文字列にシリアライズする
   * @param {*} data シリアライズ対象
   * @param {string|null} key キー名
   */
  static serialize(data, key = null) {
    if (typeof data === 'string') {
      return `"${data.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    if (typeof data === 'number') {
      const rounded = parseFloat(data.toFixed(6));
      return rounded.toString();
    }
    if (typeof data === 'boolean') {
      return data ? 'true' : 'false';
    }
    if (Array.isArray(data)) {
      if (key === 'transformation') {
        const elements = data.map(e => {
          let val = e;
          if (typeof val === 'number') {
            if (val === 0) val = NEARLY_ZERO;
            let rounded = parseFloat(val.toFixed(6));
            if (rounded === 0 && val !== 0) {
              rounded = val > 0 ? NEARLY_ZERO : -NEARLY_ZERO;
            }
            return rounded.toString() + 'f';
          }
          return JsonToSNBT.serialize(e);
        }).join(',');
        return `[${elements}]`;
      }
      const elements = data.map(e => JsonToSNBT.serialize(e)).join(',');
      return key === 'id' ? `[I;${elements}]` : `[${elements}]`;
    }
    if (typeof data === 'object' && data !== null) {
      const entries = Object.entries(data).map(([k, v]) => {
        let compoundKey = /^[a-zA-Z0-9._+-]+$/.test(k) ? k : `"${k}"`;
        if (compoundKey === 'Count') {
          compoundKey = 'count';
        }
        return `${compoundKey}:${JsonToSNBT.serialize(v, k)}`;
      });
      return `{${entries.join(',')}}`;
    }
    return '';
  }
}

/**
 * モデルデータをegg形式に変換する
 * @param {string} inputDir 入力ディレクトリ
 * @param {string} outputDir 出力ディレクトリ
 * @param {string} modelName モデル名
 */
function convertModel(inputDir, outputDir, modelName) {
  const createFilename = path.join(inputDir, 'data', modelName, 'function', '_', 'create.mcfunction');
  
  const bdeData = fs.readFileSync(createFilename, 'utf8');
  if (bdeData === null)
    throw Error('create.mcfunction not found.');

  const match = bdeData.match(/Passengers:(\[.*\]),Tags:/s);
  if (!match)
    throw Error('Passengers data not found.');
  
  const passengers = new JsonFromSNBT(match[1]).parse();
  const looks = [];

  for (let index = 0; index < passengers.length; index++) {
    const part = passengers[index];
    const look = {};
    
    if (part.id === 'item_display' || part.id === 'minecraft:item_display') {
      if (part.item) {
        look.item = part.item;
        delete part.item;
      }
    } else if (part.id === 'block_display' || part.id === 'minecraft:block_display') {
      if (part.block_state) {
        look.block_state = part.block_state;
        delete part.block_state;
      }
    } else if (part.id === 'text_display' || part.id === 'minecraft:text_display') {
      if (part.text) {
        look.text = part.text;
        delete part.text;
      }
    }

    if (part.data && part.data.alias) {
      look.alias = part.data.alias;
      delete part.data.alias;
    }
    looks.unshift(look);

    if (index < passengers.length - 1) {
      passengers[index].Passengers = [passengers[index + 1]];
    }
  }

  const rootDataTag = {
    Tags: ['_uninitialized'],
    Passengers: [passengers[0]]
  };
  // mcfunction 書き出し.
  fs.writeFileSync(path.join(outputDir, 'new.mcfunction'), FILE_HEADER + `return run summon block_display ~ ~ ~ ${JsonToSNBT.serialize(rootDataTag)}`);
  const looksSnbt = looks.map(look => JsonToSNBT.serialize(look)).join(', \\\n  ');
  fs.writeFileSync(path.join(outputDir, 'looks.mcfunction'), FILE_HEADER + `return run data modify storage egg:bdengine looks.${modelName} set value [ \\\n  ${looksSnbt} \\\n]`);
  return `egg:bdengine/${modelName}/looks`
}

/**
 * アニメーションデータをegg形式に変換する
 * @param {string} inputDir 入力ディレクトリ
 * @param {string} outputDir 出力ディレクトリ
 * @param {string} modelName モデル名
 * @param {string} animationName アニメーション名
 * @param {number} chunkSize 分割単位
 */
function convertAnimation(inputDir, outputDir, modelName, animationName, chunkSize) {
  const keyframeDir = path.join(inputDir, 'data', modelName, 'function', 'k', animationName);

  if (!fs.existsSync(keyframeDir))
    throw Error(`Directory not found: ${keyframeDir}`);

  const internalOutputDir = path.join(outputDir, '-');
  makeDirectory(internalOutputDir);

  const keyframes = [];
  const files = fs.readdirSync(keyframeDir).filter(f => /^keyframe_\d+\.mcfunction$/.test(f));

  files.sort((a, b) => {
    const aNum = parseInt(a.match(/^keyframe_(\d+)\.mcfunction$/)[1]);
    const bNum = parseInt(b.match(/^keyframe_(\d+)\.mcfunction$/)[1]);
    return aNum - bNum;
  });

  files.forEach(file => {
    const bdeData = fs.readFileSync(path.join(keyframeDir, file), 'utf8');
    const transformations = [];
    const regex = /transformation:\[([^\]]+)\]/g;
    let match;
    
    while ((match = regex.exec(bdeData)) !== null) {
      const values = match[1].split(',').map(v => {
        return parseFloat(v.trim());
      });

      if (values.length > 0) {
        transformations.unshift(values);
      } else {
        transformations.unshift(transformations[0]);
      }
    }

    if (transformations.length === 0 && keyframes) {
      keyframes.unshift(keyframes.map(v => [...v]));
    } else {
      keyframes.unshift(transformations);
    }
  });
  
  function serialize(data) {
    if (Array.isArray(data)) {
      const result = [];
      for (let index = 0; index < data.length; index++) {
        const value = data[index];
        if (value === undefined) {
          result.push('[]');
        } else {
          result.push(serialize(value));
        }
      }
      return `[${result.join(',')}]`;
    }
    if (typeof data === 'number') {
      let val = data;
      if (val === 0) {
        val = NEARLY_ZERO;
      }
      let rounded = parseFloat(val.toFixed(6));
      if (rounded === 0 && val !== 0) {
        rounded = val > 0 ? NEARLY_ZERO : -NEARLY_ZERO;
      }
      return `${rounded}f`;
    }
    return JSON.stringify(data);
  }

  let page = 1;
  const subFunctions = [];

  for (let index = 0; index < keyframes.length; index += chunkSize) {
    const chunk = keyframes.slice(index, index + chunkSize);
    const content = `data modify storage egg:bdengine animation.${modelName}-${animationName} append value ${serialize(chunk)}`;
    const subFilename = `${animationName}-${page}`;
    fs.writeFileSync(path.join(internalOutputDir, `${subFilename}.mcfunction`), FILE_HEADER + content);
    subFunctions.push(`function egg:bdengine/${modelName}/-/${subFilename}`);
    page++;
  }

  const initCommand = `data modify storage egg:bdengine animation.${modelName}-${animationName} set value []\n`;
  fs.writeFileSync(path.join(internalOutputDir, `${animationName}.mcfunction`), FILE_HEADER + initCommand + subFunctions.join('\n'));
  return `egg:bdengine/${modelName}/-/${animationName}`;
}

/**
 * ZIPファイルを解凍する
 * @param {string} source 
 * @param {string} destination 
 */
function unzip(source, destination) {
  if (os.platform() === 'win32') {
    const src = source.replace(/'/g, "''");
    const dst = destination.replace(/'/g, "''");
    execSync(`powershell -command "Expand-Archive -LiteralPath '${src}' -DestinationPath '${dst}' -Force"`);
  } else {
    execSync(`unzip -o "${source}" -d "${destination}"`);
  }
}

function makeDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function makeDatapackRoot(datapackRoot, minFormat = MIN_VERSION, maxFormat = MAX_VERSION) {
  makeDirectory(datapackRoot);
  fs.writeFileSync(path.join(datapackRoot, 'pack.mcmeta'), JSON.stringify({
    "pack": {
      "min_format": minFormat,
      "max_format": maxFormat,
      "description": "Data set of BDEngine model and animation."
    }
  }, null, 2));
}

function makeLoadJson(datapackRoot, loadFunctions) {
  const loadTagDir = path.join(datapackRoot, 'data', 'egg', 'tags', 'function', 'bdengine');
  makeDirectory(loadTagDir);
  fs.writeFileSync(path.join(loadTagDir, 'load.json'), JSON.stringify({
    "replace": false,
    "values": loadFunctions
  }, null, 2));
}

function convertAnimationSet(inputDir, outputDir, modelName, chunkSize) {
  // outputDir は datapackRoot/data/egg/function/bdengine/modelName に相当
  const keyframeRoot = path.join(inputDir, 'data', modelName, 'function', 'k');
  const animationLoadCommands = []; // 各アニメーションのメイン関数呼び出しを格納
  
  if (fs.existsSync(keyframeRoot)) {
    fs.readdirSync(keyframeRoot, {withFileTypes: true}).forEach(entry => {
      if (entry.isDirectory()) {
        // convertAnimation は egg:bdengine/modelName/-/animationName を返す
        const animationMainFunction = convertAnimation(inputDir, outputDir, modelName, entry.name, chunkSize);
        animationLoadCommands.push(`function ${animationMainFunction}`);
      }
    });
  }

  if (animationLoadCommands.length > 0) {
    const modelLoadFunctionPath = path.join(outputDir, 'load.mcfunction');
    fs.writeFileSync(modelLoadFunctionPath, FILE_HEADER + animationLoadCommands.join('\n'));
    return `egg:bdengine/${modelName}/load`; // このモデルのロード関数のMinecraftパスを返す
  }
  return null; // アニメーションがない場合は何も返さない
}

try {
  if (process.argv.length < 4 || process.argv.length > 5)
    throw Error('invalid arguments has been given.');

  const modelDir = path.resolve(process.argv[2]);
  const outputDir = path.resolve(process.argv[3]);
  const chunkSize = parseInt(process.argv[4] || 50);
  
  const datapackRoot = outputDir;
  let loadFunctions = [];

  makeDatapackRoot(datapackRoot);

  const bdengineDir = path.join(datapackRoot, 'data', 'egg', 'function', 'bdengine');
  if (fs.existsSync(bdengineDir)) {
    fs.rmSync(bdengineDir, {recursive: true, force: true});
  }

  fs.readdirSync(modelDir, {withFileTypes: true}).forEach(entry => {
    let modelName = entry.name;
    let inputDir = path.join(modelDir, entry.name);
    let tempDir = null;
    let shouldProcess = false;

    if (entry.isDirectory()) {
      shouldProcess = true;
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.zip') {
      shouldProcess = true;
      modelName = path.parse(entry.name).name;
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beak-'));
      unzip(inputDir, tempDir);
      inputDir = tempDir;
    }

    if (shouldProcess) {
      try {
        const currentOutputDir = path.join(datapackRoot, 'data', 'egg', 'function', 'bdengine', modelName);
        makeDirectory(currentOutputDir);
        loadFunctions.push(convertModel(inputDir, currentOutputDir, modelName));
        const modelLoadFunc = convertAnimationSet(inputDir, currentOutputDir, modelName, chunkSize);
        if (modelLoadFunc) {
          loadFunctions.push(modelLoadFunc);
        }
      } finally {
        if (tempDir) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      }
    }
  });
  makeLoadJson(datapackRoot, loadFunctions);
} catch (e) {
  console.error('[ERROR] ', e);
  process.exit(1);
}
