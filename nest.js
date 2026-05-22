/**
 * mcbird-js/nest.js
 * nestデータパック用テスト自動生成コンバータ
 * Refactored and optimized with the assistance of AI (Gemini).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const testMetadata = {};

/**
 * .mcfunctionファイルのパスからMinecraftの名前空間付きパスを取得する
 * @param {string} filePath 
 * @param {string} rootDir 
 * @returns {string|null}
 */
function getFunctionNamespace(filePath, rootDir) {
  const relativePath = path.relative(rootDir, filePath);
  const parts = relativePath.split(path.sep);
  
  if (parts.length < 4 || parts[0] !== 'data' || parts[2] !== 'function') {
    return null;
  }

  const namespace = parts[1]; // 名前空間
  const functionPath = parts.slice(3).join('/').replace(/\.mcfunction$/, ''); // function以下のパスを結合し、拡張子を除去
  return `${namespace}:${functionPath}`;
}

/**
 * XML属性文字列から指定された属性値を取得する
 * @param {string} attrStr 
 * @param {string} name 
 * @returns {string|null}
 */
function getAttribute(attrStr, name) {
  const match = attrStr.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`));
  return match ? (match[1] || match[2] || match[3]) : null;
}

/**
 * コンテンツ内のnestタグを置換しメタデータを収集する
 * @param {string} content 
 * @param {Object} context 
 */
function transform(content, context) {
  const functionName = getFunctionNamespace(context.srcPath, context.inputDir);
  const relativePath = path.relative(context.inputDir, context.srcPath).replace(/\\/g, '/');
  const lines = content.split('\n');
  const transformedContent = [];

  /**
   * 名前がMinecraftの命名規則（小文字、数字、一部の記号）に従っているか検証する
   */
  const validate = (val, type, lineIndex) => {
    // Minecraftの有効な文字: a-z, 0-9, /, ., _, -
    if (val && !/^[a-z0-9/._-]+$/.test(val)) {
      throw new Error(`[FATAL] Invalid character(s) detected in ${type} name: "${val}" at ${context.srcPath}:${lineIndex + 1}. Minecraft identifiers must be lowercase and only contain a-z, 0-9, /, ., _, or -.`);
    }
  };

  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];

    line = line.replace(/<nest:(case|setup|teardown|file|line)\s*([^>]*?)\/?>/g, (fullTag, tagName, attrStr) => {
      if (tagName === 'file') return relativePath;
      if (tagName === 'line') return (index + 1).toString();

      const rawUnit = getAttribute(attrStr, 'unit');
      const rawSuite = getAttribute(attrStr, 'suite');

      validate(rawUnit, 'unit', index);
      validate(rawSuite, 'suite', index);

      if (rawUnit && rawSuite) {
        const unitKey = '_' + rawUnit;
        const suiteKey = '_' + rawSuite;
        let nameOrType = null;
        
        if (tagName === 'case') {
          const rawName = getAttribute(attrStr, 'name');
          validate(rawName, 'case', index);
          if (rawName) nameOrType = '_nest_' + rawName;
        } else if (tagName === 'setup' || tagName === 'teardown') {
          nameOrType = '_' + tagName;
        }

        if (nameOrType && functionName) {
          if (testMetadata[unitKey] && testMetadata[unitKey][suiteKey] && testMetadata[unitKey][suiteKey][nameOrType]) {
            const displayName = tagName === 'case' ? getAttribute(attrStr, 'name') : tagName;
            console.warn(`[WARNING] Metadata conflict detected in ${rawUnit}/${rawSuite}: ${displayName}`);
            console.warn(`  - Existing: ${testMetadata[unitKey][suiteKey][nameOrType]}`);
            console.warn(`  - New:      ${functionName}`);
          }
          
          testMetadata[unitKey] = testMetadata[unitKey] || {};
          testMetadata[unitKey][suiteKey] = testMetadata[unitKey][suiteKey] || {};
          testMetadata[unitKey][suiteKey][nameOrType] = functionName;

          return '';
        }
      }
      return fullTag;
    });

    if (line.trim().match(/^say\s*$/)) {
      line = '';
    }

    transformedContent.push(line);
  }
  return transformedContent.join('\n');
}

/**
 * 収集したテスト構造を検証し警告を表示する
 */
function verifyTestStructure() {
  for (const unit in testMetadata) {
    for (const suite in testMetadata[unit]) {
      const suiteStructure = testMetadata[unit][suite];

      const cases = Object.keys(suiteStructure).filter(key => key.startsWith('_nest_'));
      if (cases.length === 0) {
        const displayUnit = unit.replace(/^_/, '');
        const displaySuite = suite.replace(/^_/, '');
        console.warn(`[WARNING] No test cases found in ${displayUnit} > ${displaySuite}. (Only setup/teardown exist)`);
      }
    }
  }
}

function trackFile(context, filePath) {
  const rel = path.relative(context.outputDir, filePath).replace(/\\/g, '/');
  if (context.touchedFiles) context.touchedFiles.add(rel);
}

/**
 * 収集したメタデータを元に関数タグや制御用ファイルを生成する
 * @param {Object} context 
 */
async function finalize(context) {
  const outputDir = context.outputDir;
  if (Object.keys(testMetadata).length === 0) return;

  verifyTestStructure();

  const aliasDir = path.join(outputDir, 'data', 'nest', 'tags', 'function', 'alias');
  fs.mkdirSync(aliasDir, {recursive: true});

  for (const unit in testMetadata) {
    console.log(unit.replace(/^_/, ''));
    for (const suite in testMetadata[unit]) {
      console.log(`  ${suite.replace(/^_/, '')}`);
      for (const caseName in testMetadata[unit][suite]) {
        const functionName = testMetadata[unit][suite][caseName];
        const tagPath = path.join(aliasDir, `${unit}-${suite}-${caseName}.json`);
        const tagContent = { replace: true, values: [functionName] };
        fs.writeFileSync(tagPath, JSON.stringify(tagContent, null, 2));
        trackFile(context, tagPath);
        
        if (caseName === '_setup' || caseName === '_teardown') continue;
        console.log(`    ${caseName.replace(/^_nest_/, '')}`);
      }
    }
  }

  const generatedDir = path.join(outputDir, 'data', 'nest', 'function', '_generated');
  fs.mkdirSync(generatedDir, {recursive: true});

  for (const unit in testMetadata) {
    const suitesData = [];
    for (const suite in testMetadata[unit]) {
      const suiteStructure = testMetadata[unit][suite];
      const aliasSetup = `${unit}-${suite}-_setup`;
      const aliasTeardown = `${unit}-${suite}-_teardown`;
      const cases = Object.keys(suiteStructure)
        .filter(key => key !== '_setup' && key !== '_teardown')
        .map(caseName => `{name:${caseName},alias:${unit}-${suite}-${caseName}}`);
        
      suitesData.push(`{suite:${suite},setup:${aliasSetup},teardown:${aliasTeardown},cases:[${cases.join(',')}]}`);
    }
    const command = `data modify storage nest:run data.${unit} set value [${suitesData.join(',')}]`;
    fs.writeFileSync(path.join(generatedDir, `${unit}.mcfunction`), command);
    trackFile(context, path.join(generatedDir, `${unit}.mcfunction`));
  }

  const loadJsonPath = path.join(outputDir, 'data', 'nest', 'tags', 'function', 'load.json');
  const generatedFunctions = Object.keys(testMetadata).map(unit => `nest:_generated/${unit}`);
  let loadJsonContent = { replace: false, values: [] };

  if (fs.existsSync(loadJsonPath)) {
    try {
      const existingJson = JSON.parse(fs.readFileSync(loadJsonPath, 'utf8'));
      if (existingJson && Array.isArray(existingJson.values)) loadJsonContent = existingJson;
    } catch (e) { console.warn(`[WARNING] load.json parse error: ${e.message}`); }
  }

  const mergedValues = new Set([...loadJsonContent.values, ...generatedFunctions]);
  loadJsonContent.values = Array.from(mergedValues);
  fs.writeFileSync(loadJsonPath, JSON.stringify(loadJsonContent, null, 2));
  trackFile(context, loadJsonPath);
}

// モジュールエクスポート.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { transform, finalize };
}

// スタンドアロン実行時のロジック
if (require.main === module) {
  console.log('Usage (as plugin): node js/sync.js <source_dir> <destination_dir> js/nest.js');
  process.exit(1);
}