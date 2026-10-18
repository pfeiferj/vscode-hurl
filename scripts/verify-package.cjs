// Requires unzip (macOS/Linux); no global extension installation is performed.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const archive = path.resolve('hurl.vsix');
  const listing = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split('\n');
  for (const file of ['out/extension.js', 'out/highlighting.js', 'out/query.js',
    'tree-sitter-hurl.wasm', 'tree-sitter-hurl.json', 'language-configuration.json',
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
  const grammar = path.join(root, 'tree-sitter-hurl.wasm');
  const provenance = require(path.join(root, 'tree-sitter-hurl.json'));
  assert.equal(createHash('sha256').update(fs.readFileSync(grammar)).digest('hex'), provenance.sha256);
  const highlighter = await Highlighter.create(grammar);
  const treeSitter = require(runtime);
  const language = await treeSitter.Language.load(grammar);
  assert.equal(language.abiVersion, provenance.abiVersion);
  assert.ok(language.abiVersion >= treeSitter.MIN_COMPATIBLE_VERSION);
  assert.ok(language.abiVersion <= treeSitter.LANGUAGE_VERSION);
  try {
    const tokens = highlighter.tokenize('GET https://example.com\r\n# 😀 packaged\r\n');
    assert.ok(tokens.some(token => tokenTypes[token.type] === 'comment' && token.length === 13));
    const source = 'POST https://example.org/{{newUuid}}\r\n' +
      '{ "emoji": "😀{{name}}", "ok": true }\r\n';
    const lines = source.split('\r\n');
    const modern = highlighter.tokenize(source).map(token => ({
      text: lines[token.line].slice(token.start, token.start + token.length),
      type: tokenTypes[token.type],
    }));
    for (const [text, type] of [['newUuid', 'function'], ['name', 'variable'], ['true', 'keyword']]) {
      assert.ok(modern.some(token => token.text === text && token.type === type), `${text}: ${type}`);
    }
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
