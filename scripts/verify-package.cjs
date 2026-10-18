// Requires unzip (macOS/Linux); no global extension installation is performed.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const archive = path.resolve('hurl.vsix');
  const listing = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split('\n');
  for (const file of ['out/extension.js', 'out/highlighting.js', 'out/query.js',
    'tree-sitter-hurl.wasm', 'language-configuration.json',
    'node_modules/web-tree-sitter/web-tree-sitter.cjs',
    'node_modules/web-tree-sitter/web-tree-sitter.wasm']) {
    assert.ok(listing.includes(`extension/${file}`), `Missing packaged ${file}`);
  }
  assert.ok(!listing.some(file => /extension\/(src|scripts|out\/test)\//.test(file)));
  assert.ok(!listing.some(file => /node_modules\/(ansi-to-html|lodash|typescript|eslint)\//.test(file)));
  const directory = fs.mkdtempSync(path.resolve('.vscode-test/package-'));
  execFileSync('unzip', ['-q', archive, '-d', directory]);
  const root = path.join(directory, 'extension');
  const runtime = require.resolve('web-tree-sitter', { paths: [root] });
  assert.ok(runtime.startsWith(path.join(root, 'node_modules')));
  const { Highlighter, tokenTypes } = require(path.join(root, 'out/highlighting.js'));
  const highlighter = await Highlighter.create(path.join(root, 'tree-sitter-hurl.wasm'));
  try {
    const tokens = highlighter.tokenize('GET https://example.com\r\n# 😀 packaged\r\n');
    assert.ok(tokens.some(token => tokenTypes[token.type] === 'comment' && token.length === 13));
  } finally {
    highlighter.dispose();
  }
  const manifest = require(path.join(root, 'package.json'));
  assert.equal(manifest.contributes.commands, undefined);
  console.log(`Packaged WASM/query smoke passed: ${root}`);
  console.log(`Extension-host smoke: HURL_EXTENSION_PATH="${root}" npm run test:integration`);
}
fs.mkdirSync('.vscode-test', { recursive: true });
main().catch(error => { console.error(error); process.exitCode = 1; });
