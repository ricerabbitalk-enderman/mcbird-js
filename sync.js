/**
 * mcbird-js/sync.js
 * ファイル同期・変換エンジン
 * Refactored and optimized with the assistance of AI (Gemini).
 */

'use strict';

const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');

/**
 * ディレクトリを再帰的に走査し、ファイルにプロセッサを適用しながら同期する
 * @param {string} inputDir 入力ディレクトリ
 * @param {string} outputDir 出力ディレクトリ
 * @param {string} mode 同期モード ('copy' | 'convert')
 * @param {Function|Function[]} processors コンテンツ変換用プロセッサ
 * @param {Object} contextBase プロセッサに渡される共通コンテキスト
 */
async function walk(inputDir, outputDir, mode, processors, contextBase = {}) {
  const processorList = Array.isArray(processors) ? processors : [processors];

  if (mode === 'copy' || mode === 'convert') {
    await fsPromises.mkdir(outputDir, { recursive: true });
  }

  const entries = await fsPromises.readdir(inputDir, { withFileTypes: true });
  
  await Promise.all(entries.map(async (entry) => {
    const srcPath = path.join(inputDir, entry.name);
    const destPath = path.join(outputDir, entry.name);
    const relativePath = path.relative(contextBase.outputDir, destPath).replace(/\\/g, '/');

    if (contextBase.touchedFiles) contextBase.touchedFiles.add(relativePath);

    if (entry.isDirectory()) {
      await walk(srcPath, destPath, mode, processors, contextBase);
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.mcfunction')) {
        let content = await fsPromises.readFile(srcPath, 'utf8');
        const context = {
          ...contextBase,
          srcPath: srcPath,
          destPath: destPath,
          filename: entry.name
        };
        let currentContent = content;
        for (const proc of processorList) {
          if (typeof proc === 'function') {
            currentContent = await Promise.resolve(proc(currentContent, context));
          }
        }
        await fsPromises.writeFile(destPath, currentContent);
      } else if (mode === 'copy') {
        await fsPromises.copyFile(srcPath, destPath);
      }
    }
  }));
}

/**
 * コピー先にのみ存在する余剰ファイルを検知して警告を表示する
 * @param {string} sourceRoot コピー元ルート
 * @param {string} destinationRoot コピー先ルート
 * @param {Set<string>} touchedFiles 今回のプロセスで生成・更新されたファイルの相対パス集合
 */
async function warnAboutExtraFiles(sourceRoot, destinationRoot, touchedFiles) {
  const stack = [destinationRoot];
  const extraFiles = [];

  while (stack.length > 0) {
    const currentDestDir = stack.pop();
    let entries;
    try {
      entries = await fsPromises.readdir(currentDestDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }

    for (const entry of entries) {
      const currentDestPath = path.join(currentDestDir, entry.name);
      const relativePath = path.relative(destinationRoot, currentDestPath).replace(/\\/g, '/');
      const sourcePath = path.join(sourceRoot, relativePath);

      if (entry.isDirectory()) {
        stack.push(currentDestPath);
      } else if (entry.isFile()) {
        if (touchedFiles.has(relativePath)) continue;

        try {
          await fsPromises.access(sourcePath, fs.constants.F_OK);
        } catch (error) {
          if (error.code === 'ENOENT') {
            extraFiles.push(relativePath);
          } else {
            throw error;
          }
        }
      }
    }
  }

  if (extraFiles.length > 0) {
    console.warn('\n[WARNING] Extra files found in the destination directory that do not exist in the source.');
    console.warn('If the file structure has changed, please consider deleting these files manually:');
    extraFiles.forEach(file => console.warn(`  - ${file}`));
    console.warn('');
  }
}

/**
 * CLI実行時のメインエントリーポイント
 */
(async () => {
  const args = process.argv.slice(2);
  const touchedFiles = new Set();
  if (args.length < 2) {
    console.error('Usage: node js/sync.js <source_dir> <destination_dir> [plugin_path_1 plugin_path_2 ...]');
    process.exit(1);
  }

  const sourceDir = path.resolve(args.shift());
  const destinationDir = path.resolve(args.shift());
  const pluginPaths = args.map(p => path.resolve(p));

  const plugins = pluginPaths.map(p => require(p));
  const processors = plugins.map(p => typeof p === 'function' ? p : p.transform);

  const mode = 'copy';
  try {
    const context = { inputDir: sourceDir, outputDir: destinationDir, touchedFiles };
    
    // 同期・変換の実行
    await walk(sourceDir, destinationDir, mode, processors, context);

    for (const plugin of plugins) {
      if (plugin.finalize) {
        await Promise.resolve(plugin.finalize(context));
      }
    }
    await warnAboutExtraFiles(sourceDir, destinationDir, touchedFiles);
    
  } catch (e) {
    console.error('ERROR:', e);
    process.exit(1);
  }
})();