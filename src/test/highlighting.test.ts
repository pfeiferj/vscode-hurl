import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { after, before, test, mock } from 'node:test';
import { LANGUAGE_VERSION, Language, MIN_COMPATIBLE_VERSION, Parser, Query, Tree } from 'web-tree-sitter';

import { Highlighter, tokenTypes } from '../highlighting';
import { highlights } from '../query';
import { captureTypes } from '../tokens';
import * as tokenMetadata from '../tokens';

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

test('custom token metadata supplies intentional TextMate theme fallbacks', () => {
  const definitions = Reflect.get(tokenMetadata, 'semanticTokenTypes');
  const scopes = Reflect.get(tokenMetadata, 'semanticTokenScopes');
  assert.ok(Array.isArray(definitions), 'semanticTokenTypes');
  assert.ok(Array.isArray(scopes), 'semanticTokenScopes');
  assert.deepEqual(definitions.map(({ id }) => id).sort(), [
    'hurlBoolean', 'hurlEscape', 'hurlMethod', 'hurlOption',
    'punctuationBracket', 'punctuationDelimiter', 'punctuationSpecial',
  ]);
  assert.deepEqual(tokenMetadata.tokenModifiers, ['declaration']);
  const fallbacks = scopes.find(({ language }) => language === 'hurl')?.scopes;
  for (const [id, scope] of Object.entries({
    hurlMethod: 'keyword.control.http-method.hurl', hurlEscape: 'constant.character.escape.hurl',
    hurlBoolean: 'constant.language.boolean.hurl', hurlOption: 'support.constant.option.hurl',
    punctuationBracket: 'punctuation.section.brackets.hurl',
    punctuationDelimiter: 'punctuation.separator.hurl', punctuationSpecial: 'punctuation.section.interpolation.hurl',
    'variable.declaration': 'variable.other.readwrite.hurl',
  })) {
    assert.ok(fallbacks?.[id]?.includes(scope), `${id}: ${scope}`);
  }
  assert.ok(definitions.every(({ id, description }) => tokenTypes.includes(id) && description.length > 0));
});

test('native XML entity references override text and attributes but not CDATA or comments', () => {
  const result = tokens('POST https://example.org\n<root a="😀&amp;&#65;&#x1F600;">&custom; &#x41;' +
    '<![CDATA[&literal;]]><!-- &comment; --></root>\n');
  for (const entity of ['&amp;&#65;&#x1F600;', '&custom;', '&#x41;']) {
    assert.ok(result.some(token => token.text === entity && token.type === 'hurlEscape'), entity);
  }
  assert.ok(result.some(token => token.text === '"😀' && token.type === 'string'));
  assert.ok(result.some(token => token.text === '<![CDATA[&literal;]]>' && token.type === 'string'));
  assert.ok(result.some(token => token.text === '<!-- &comment; -->' && token.type === 'comment'));
});

test('XML prolog, DOCTYPE and DTD retain native semantic coverage', () => {
  const result = tokens('POST https://example.org\n<?xml version="1.0"?>\n' +
    '<!DOCTYPE root SYSTEM "root.dtd" [<!ELEMENT root (#PCDATA)>%defs;]>\n<root a="1">text</root>\n');
  for (const [text, type] of [['<?xml version="1.0"?>', 'keyword'], ['<!DOCTYPE', 'keyword'],
    ['SYSTEM', 'keyword'], ['"root.dtd"', 'string'], ['<!ELEMENT root (#PCDATA)>', 'keyword'],
    ['%defs;', 'hurlEscape'], ['root', 'type'], ['<', 'punctuationBracket'],
    ['>', 'punctuationBracket'], ['</', 'punctuationBracket'], ['=', 'punctuationDelimiter']]) {
    assert.ok(result.some(token => token.text === text && token.type === type), `${text}: ${type}`);
  }
  assert.equal(result.filter(token => token.type === 'operator').length, 0);
  const comparisons = tokens('GET https://example.org\nHTTP 200\n[Asserts]\nstatus > 100\nstatus < 300\n');
  for (const operator of ['>', '<']) {
    assert.ok(comparisons.some(token => token.text === operator && token.type === 'operator'));
  }
});

test('additional absolute capture spans preserve adjacent modifier differences', () => {
  const result = highlighter.tokenize('abc', [
    { start: 0, end: 3, capture: 'variable' },
    { start: 1, end: 2, capture: 'variable.declaration' },
  ]);
  assert.deepEqual(result.map(({ start, length, type, modifiers }) =>
    ({ start, length, type: tokenTypes[type], modifiers: modifiers ?? 0 })), [
    { start: 0, length: 1, type: 'variable', modifiers: 0 },
    { start: 1, length: 1, type: 'variable', modifiers: 1 },
    { start: 2, length: 1, type: 'variable', modifiers: 0 },
  ]);
});

test('every query capture is explicitly mapped and unknown captures are rejected', async () => {
  const query = new Query(await Language.load(grammar), highlights);
  try {
    for (const name of query.captureNames) {
      assert.ok(Object.hasOwn(captureTypes, name), name);
      assert.ok(tokenTypes.includes(captureTypes[name]), name);
    }
  } finally {
    query.delete();
  }
  for (const capture of ['unknown.capture', 'toString', '__proto__']) {
    assert.throws(() => highlighter.tokenize('abc', [{ start: 0, end: 3, capture }]), /Unknown highlight capture/);
  }
});

test('capture keys are variable declarations, unlike headers and variable references', () => {
  const result = tokens('GET https://example.org/{{session}}\nX-Session: value\nHTTP 200\n[Captures]\nsession: header "X-Session"\n');
  const declaration = result.find(token => token.line === 4 && token.text === 'session');
  assert.equal(declaration?.type, 'variable');
  assert.equal((declaration as { modifiers?: number })?.modifiers, 1);
  assert.ok(result.some(token => token.text === 'X-Session' && token.type === 'property'));
  const reference = result.find(token => token.line === 0 && token.text === 'session');
  assert.equal(reference?.type, 'variable');
  assert.equal((reference as { modifiers?: number })?.modifiers ?? 0, 0);
});

test('binary and file literals capture payloads and terminators, not only prefixes', () => {
  for (const literal of ['hex,CA FE01;', 'base64,SGVsbG8=;', 'file,fixtures/body.bin;']) {
    const result = tokens(`POST https://example.org\n${literal}\n`).filter(token => token.line === 1);
    assert.deepEqual(result.map(token => token.text).join(''), literal);
    assert.ok(result.every(token => token.type === 'string'));
  }
  const assertions = tokens('GET https://example.org\nHTTP 200\n[Asserts]\nbody == hex,CAFE;\nbody == base64,QQ==;\nbody == file,body.bin;\n');
  for (const literal of ['hex,CAFE;', 'base64,QQ==;', 'file,body.bin;']) {
    assert.ok(assertions.some(token => token.text === literal && token.type === 'string'), literal);
  }
});

test('punctuation categories distinguish brackets, delimiters and interpolation', () => {
  const result = tokens('POST https://example.org/{{id}}\n{"ok":true,"v":[1]}\n');
  for (const [text, type] of [['{{', 'punctuationSpecial'], ['}}', 'punctuationSpecial'],
    ['{', 'punctuationBracket'], ['[', 'punctuationBracket'], [']}', 'punctuationBracket'],
    [':', 'punctuationDelimiter'], [',', 'punctuationDelimiter']]) {
    assert.ok(result.some(token => token.text === text && token.type === type), `${text}: ${type}`);
  }
});

test('bundled grammar ABI is supported by the current runtime', async () => {
  const language = await Language.load(grammar);
  const provenance = JSON.parse(readFileSync(path.join(root, 'tree-sitter-hurl.json'), 'utf8'));
  assert.equal(language.abiVersion, provenance.abiVersion);
  assert.equal(createHash('sha256').update(readFileSync(grammar)).digest('hex'), provenance.sha256);
  const query = new Query(language, highlights);
  query.delete();
  assert.ok(language.abiVersion >= MIN_COMPATIBLE_VERSION);
  assert.ok(language.abiVersion <= LANGUAGE_VERSION);
});

test('distinct Hurl classifications have a unique legend', () => {
  assert.equal(new Set(tokenTypes).size, tokenTypes.length);
  for (const type of ['hurlMethod', 'hurlEscape', 'hurlBoolean', 'hurlOption']) {
    assert.ok(tokenTypes.includes(type), type);
  }
  const result = tokens('GET https://example.com/{{id}}\nHTTP 200\n[Asserts]\njsonpath "$.ok" == true\n');
  for (const [text, type] of [['GET', 'hurlMethod'], ['id', 'variable'], ['200', 'number'],
    ['[Asserts]', 'property'], ['jsonpath', 'function'], ['==', 'operator'], ['true', 'hurlBoolean']]) {
    assert.ok(result.some(token => token.text === text && token.type === type), `${text}: ${type}`);
  }
});

test('nested escape captures override strings without overlapping, using UTF-16 columns', () => {
  const result = tokens('POST https://example.com\r\n{ "emoji": "😀\\nvalue", "ok": true }\r\n');
  assert.deepEqual(result.filter(token => token.line === 1).map(({ start, length, type, text }) =>
    ({ start, length, type, text })), [
    { start: 0, length: 1, type: 'punctuationBracket', text: '{' },
    { start: 2, length: 7, type: 'property', text: '"emoji"' },
    { start: 9, length: 1, type: 'punctuationDelimiter', text: ':' },
    { start: 11, length: 3, type: 'string', text: '"😀' },
    { start: 14, length: 2, type: 'hurlEscape', text: '\\n' },
    { start: 16, length: 6, type: 'string', text: 'value"' },
    { start: 22, length: 1, type: 'punctuationDelimiter', text: ',' },
    { start: 24, length: 4, type: 'property', text: '"ok"' },
    { start: 28, length: 1, type: 'punctuationDelimiter', text: ':' },
    { start: 30, length: 4, type: 'hurlBoolean', text: 'true' },
    { start: 35, length: 1, type: 'punctuationBracket', text: '}' },
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
    assert.equal(parserDelete.mock.callCount(), 4); // Hurl plus JSON/XML/GraphQL.
    assert.equal(queryDelete.mock.callCount(), 4);
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
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
    '@lumis-sh/wasm-graphql', '@lumis-sh/wasm-xml', 'web-tree-sitter',
  ]);
  const source = readFileSync(path.join(root, 'src/extension.ts'), 'utf8');
  assert.doesNotMatch(source, /child_process|registerCommand|createWebviewPanel|ansi-to-html/);
  assert.equal(manifest.contributes.languages[0].configuration, './language-configuration.json');
});

test('latest grammar parses modern Hurl syntax and scanner boundaries without errors', async () => {
  const parser = new Parser();
  parser.setLanguage(await Language.load(grammar));
  const fixtures = [
    { source: 'GET https://example.org/{{getEnv}}', counts: { function: 1, template: 1 } },
    { source: 'GET https://example.org/{{getEnvSuffix}}', counts: { function: 0, variable_name: 1 } },
    { source: 'GET https://example.org\n[Options]\nretry: -1\nretry-interval: 2ms\nverbosity: debug',
      counts: { count_option: 1, duration_unit: 1, verbosity_option: 1 } },
    { source: 'GET https://example.org\nHTTP 200\n[Asserts]\nbody charsetEncode "UTF-8" == "x"\n' +
      'certificate Subject not isEmpty\n', counts: { argument_filter: 1, certificate_attribute: 1 } },
    { source: 'POST https://example.org\n{"x":"{{name}}","v":{{value}},"ok":true}\n',
      counts: { template: 2, json_boolean: 1 } },
    { source: 'POST https://example.org\n{}\nGET https://example.org/next', counts: { entry: 2 } },
    { source: 'POST https://example.org\n[]', counts: { json_array: 1 } },
    { source: 'POST https://example.org\n<!DOCTYPE root><root><![CDATA[]]]></root>\n' +
      'GET https://example.org/next\n', counts: { xml_doctype: 1, xml_cdata: 1, entry: 2 } },
    { source: "POST https://example.org\n<á a·b='1'><𐀀/></á>\n", counts: { xml_name: 4 } },
  ];
  try {
    for (const { source, counts } of fixtures) {
      const tree = parser.parse(source)!;
      try {
        assert.equal(tree.rootNode.hasError, false, `${source}: ${tree.rootNode.toString()}`);
        for (const [type, count] of Object.entries(counts)) {
          assert.equal(tree.rootNode.descendantsOfType(type).length, count, `${source}: ${type}`);
        }
      } finally {
        tree.delete();
      }
    }
    for (const source of ['POST https://example.org\n{"x":1,}\n',
      'POST https://example.org\n{"x":"a\nb"}\n',
      'POST https://example.org\n<root a="1"b="2"/>\n']) {
      const tree = parser.parse(source)!;
      try {
        assert.equal(tree.rootNode.hasError, true, source);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('modern Hurl functions, filters, options and predicates have semantic tokens', () => {
  const result = tokens('GET https://example.org/{{getEnv}}/{{newUuid}}\n[Options]\n' +
    'retry: -1\nretry-interval: 2ms\nverbosity: debug\nHTTP 200\n[Captures]\n' +
    'secret: body redact\n[Asserts]\nbody charsetEncode "UTF-8" == "x"\n' +
    'certificate Subject not isEmpty\n');
  for (const [text, type] of [['getEnv', 'function'], ['newUuid', 'function'], ['retry', 'hurlOption'],
    ['-1', 'number'], ['ms', 'string'], ['debug', 'hurlOption'], ['redact', 'keyword'],
    ['charsetEncode', 'function'], ['certificate', 'function'], ['Subject', 'string'],
    ['not', 'operator'], ['isEmpty', 'operator']]) {
    assert.ok(result.some(token => token.text === text && token.type === type), `${text}: ${type}`);
  }
});

test('interpolation and filename escapes remain narrower than surrounding strings', () => {
  const result = tokens('POST https://example.org\n[Options]\ncert: {{cert}}\\ name.pem\n' +
    '{ "emoji": "😀{{name}}", "value": {{value}}, "ok": true, "empty": null }\n');
  for (const [text, type] of [['cert', 'variable'], ['name', 'variable'], ['value', 'variable'],
    ['\\ ', 'hurlEscape'], ['true', 'hurlBoolean'], ['null', 'enumMember']]) {
    assert.ok(result.some(token => token.text === text && token.type === type), `${text}: ${type}`);
  }
  assert.ok(result.some(token => token.text === '"😀' && token.start === 11 && token.type === 'string'));
});

test('raw fences and multiline backslashes are literal, normal fences interpolate', () => {
  for (const mode of ['', 'raw']) {
    const result = tokens(`POST https://example.org\n\`\`\`${mode}\nhello \\n {{name}}\n\`\`\`\n`);
    assert.equal(result.filter(token => token.type === 'operator').length, 0);
    assert.equal(result.filter(token => token.type === 'variable').length, mode === 'raw' ? 0 : 1);
    assert.ok(result.some(token => token.type === 'string' && token.text.includes('\\n')));
  }
});

test('native XML tags, attributes, CDATA and comments highlight without interpolation', () => {
  const result = tokens('POST https://example.org\n<root a="{{literal}}"><!-- note -->' +
    '<![CDATA[]]]><𐀀/></root>\n');
  for (const [text, type] of [['root', 'type'], ['a', 'property'], ['"{{literal}}"', 'string'],
    ['<!-- note -->', 'comment'], ['<![CDATA[]]]>', 'string'], ['𐀀', 'type']]) {
    assert.ok(result.some(token => token.text === text && token.type === type), `${text}: ${type}`);
  }
  assert.equal(result.filter(token => token.type === 'variable').length, 0);
});
