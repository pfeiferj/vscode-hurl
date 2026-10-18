import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { after, before, test, mock } from 'node:test';
import { LANGUAGE_VERSION, Language, MIN_COMPATIBLE_VERSION, Parser, Query, Tree } from 'web-tree-sitter';

import { Highlighter, tokenTypes } from '../highlighting';

const root = path.resolve(__dirname, '../..');
const grammar = path.join(root, 'tree-sitter-hurl.wasm');
let highlighter: Highlighter;
before(async () => { highlighter = await Highlighter.create(grammar); });
after(() => highlighter.dispose());

function tokens(text: string) {
  const lines = text.split(/\r\n|\r|\n/);
  const result = highlighter.tokenize(text);
  for (let i = 0; i < result.length; i++) {
    const token = result[i];
    assert.ok(token.length > 0);
    assert.ok(token.start >= 0 && token.start + token.length <= lines[token.line].length);
    assert.ok(token.type >= 0 && token.type < tokenTypes.length);
    const previous = result[i - 1];
    if (previous) {
      assert.ok(token.line > previous.line ||
        (token.line === previous.line && token.start >= previous.start + previous.length));
    }
  }
  return result.map(token => ({ ...token, type: tokenTypes[token.type],
    text: lines[token.line].slice(token.start, token.start + token.length) }));
}

test('bundled grammar ABI is supported by the current runtime', async () => {
  const language = await Language.load(grammar);
  assert.ok(language.abiVersion >= MIN_COMPATIBLE_VERSION);
  assert.ok(language.abiVersion <= LANGUAGE_VERSION);
});

test('standard unique legend and actual Hurl query captures', () => {
  assert.equal(new Set(tokenTypes).size, tokenTypes.length);
  assert.ok(!tokenTypes.includes('boolean'));
  const result = tokens('GET https://example.com/{{id}}\nHTTP 200\n[Asserts]\njsonpath "$.ok" == true\n');
  for (const [text, type] of [['GET', 'type'], ['id', 'variable'], ['200', 'number'],
    ['[Asserts]', 'property'], ['jsonpath', 'function'], ['==', 'operator'], ['true', 'keyword']]) {
    assert.ok(result.some(token => token.text === text && token.type === type), `${text}: ${type}`);
  }
});

test('nested escape captures override strings without overlapping, using UTF-16 columns', () => {
  const result = tokens('POST https://example.com\r\n{ "emoji": "😀\\nvalue", "ok": true }\r\n');
  assert.deepEqual(result.filter(token => token.line === 1).map(({ start, length, type, text }) =>
    ({ start, length, type, text })), [
    { start: 2, length: 7, type: 'property', text: '"emoji"' },
    { start: 11, length: 3, type: 'string', text: '"😀' },
    { start: 14, length: 2, type: 'operator', text: '\\n' },
    { start: 16, length: 6, type: 'string', text: 'value"' },
    { start: 24, length: 4, type: 'property', text: '"ok"' },
  ]);
});

test('multiline strings split at actual LF/CRLF line ends, skipping empty lines', () => {
  for (const newline of ['\n', '\r\n']) {
    const text = ['POST https://example.com', '```', 'hello 😀', '', 'é', '```', ''].join(newline);
    assert.deepEqual(tokens(text).filter(token => token.line > 0), [
      { line: 1, start: 0, length: 3, type: 'string', text: '```' },
      { line: 2, start: 0, length: 8, type: 'string', text: 'hello 😀' },
      { line: 4, start: 0, length: 1, type: 'string', text: 'é' },
      { line: 5, start: 0, length: 3, type: 'string', text: '```' },
    ]);
  }
});

test('standalone CR and mixed line endings also use document line boundaries', () => {
  const result = tokens('POST https://example.com\r\n```\rhello 😀\nworld\r```');
  assert.ok(result.some(token => token.line === 2 && token.text === 'hello 😀'));
  assert.ok(result.some(token => token.line === 3 && token.text === 'world'));
});

test('empty, incomplete and edited documents do not retain stale tokens', () => {
  assert.deepEqual(tokens(''), []);
  tokens('POST https://example.com\n{ "unfinished": "😀');
  assert.deepEqual(tokens('# 😀 no newline'), [
    { line: 0, start: 0, length: 15, type: 'comment', text: '# 😀 no newline' },
  ]);
  assert.deepEqual(tokens(''), []);
});

test('trees are released after success and errors; parser/query disposal is idempotent', async () => {
  const local = await Highlighter.create(grammar);
  const treeDelete = mock.method(Tree.prototype, 'delete');
  const parserDelete = mock.method(Parser.prototype, 'delete');
  const queryDelete = mock.method(Query.prototype, 'delete');
  try {
    for (let i = 0; i < 25; i++) {
      local.tokenize('GET https://example.com\n');
    }
    assert.equal(treeDelete.mock.callCount(), 25);
    const captures = mock.method(Query.prototype, 'captures', () => { throw new Error('capture failure'); });
    assert.throws(() => local.tokenize('GET https://example.com\n'), /capture failure/);
    assert.equal(treeDelete.mock.callCount(), 26);
    captures.mock.restore();
    local.dispose();
    local.dispose();
    assert.equal(parserDelete.mock.callCount(), 1);
    assert.equal(queryDelete.mock.callCount(), 1);
    assert.throws(() => local.tokenize(''), /disposed/);
  } finally {
    local.dispose();
    mock.restoreAll();
  }
});

test('initialization failures reject instead of silently providing no tokens', async () => {
  await assert.rejects(Highlighter.create(path.join(root, 'does-not-exist.wasm')));
});

test('extension manifest and activation have no runner, commands or shell execution', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.contributes.commands, undefined);
  assert.deepEqual(manifest.activationEvents, ['onLanguage:hurl']);
  assert.deepEqual(Object.keys(manifest.dependencies), ['web-tree-sitter']);
  const source = readFileSync(path.join(root, 'src/extension.ts'), 'utf8');
  assert.doesNotMatch(source, /child_process|registerCommand|createWebviewPanel|ansi-to-html/);
  assert.equal(manifest.contributes.languages[0].configuration, './language-configuration.json');
});
