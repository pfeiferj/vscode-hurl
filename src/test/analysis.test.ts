import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import { Language, Parser } from 'web-tree-sitter';
import { analyzeTree, emptyStructure } from '../analysis';

let parser: Parser;
before(async () => {
  await Parser.init({ locateFile: () => require.resolve('web-tree-sitter/web-tree-sitter.wasm') });
  parser = new Parser();
  parser.setLanguage(await Language.load(path.resolve(process.cwd(), 'tree-sitter-hurl.wasm')));
});
after(() => parser.delete());
function analyze(text: string, shouldCancel?: () => boolean) {
  const tree = parser.parse(text.replace(/\r(?!\n)/g, '\n'))!;
  try { return analyzeTree(tree.rootNode, text, shouldCancel); }
  finally { tree.delete(); }
}

test('folds Neovim structures and returns complete nested JSON containers', () => {
  const text = 'POST https://example.org\n[Options]\nverbose: true\n{\n"a": [\ntrue, false\n]\n}\nHTTP 200\n[Asserts]\nstatus == 200\n';
  const result = analyze(text);
  assert.equal(result.issues.length, 0);
  assert.deepEqual(result.containers, [
    { start: text.indexOf('{'), end: text.lastIndexOf('}') + 1, close: text.lastIndexOf('}'), kind: 'json' },
    { start: text.indexOf('[\n'), end: text.indexOf(']\n', text.indexOf('[\n')) + 1, close: text.indexOf(']\n', text.indexOf('[\n')), kind: 'json' },
  ]);
  for (const fragment of ['POST', '[Options]', '{', '[\n', 'HTTP', '[Asserts]']) {
    assert.ok(result.folds.some(range => range.start === text.indexOf(fragment)), fragment);
  }
  assert.equal(new Set(result.folds.map(range => `${range.start}:${range.end}`)).size, result.folds.length);
});

test('links only literal safe HTTP request URLs with exact UTF16 offsets', () => {
  const text = '# 😀\r\nGET   https://example.org/😀?a=1  \r\nHTTP 200\r\nLocation: https://not-request.example\r\n';
  const target = 'https://example.org/😀?a=1';
  assert.deepEqual(analyze(text).links, [{ start: text.indexOf(target), end: text.indexOf(target) + target.length, target }]);
  for (const unsafe of ['{{host}}/a', 'https://example.org/{{id}}', 'file:///etc/passwd',
    'https://example.org/a b', 'https://example.org/\\\\x', 'https://', 'https://example.org/\u0001x', 'https://[bad']) {
    assert.deepEqual(analyze(`GET ${unsafe}\n`).links, [], unsafe);
  }
  assert.equal(analyze('GET http://localhost:8080/a\rGET https://example.org\r').links.length, 2);
});

test('native XML regions, nested containers and payload whitespace protection use AST boundaries', () => {
  const text = 'POST https://example.org\r\n<root a="😀\r\nx">\r\n<child> keep\r\n  spaces </child>\r\n<![CDATA[\r\n raw]]>\r\n<!--\r\n comment -->\r\n<empty/>\r\n</root>\r\n';
  const result = analyze(text);
  assert.deepEqual(result.xmlRegions, [{ start: text.indexOf('<root'), end: text.indexOf('</root>') + 7 }]);
  assert.deepEqual(result.containers, [
    { start: text.indexOf('<root'), end: text.indexOf('</root>') + 7, close: text.indexOf('</root>'), kind: 'xml' },
    { start: text.indexOf('<child>'), end: text.indexOf('</child>') + 8, close: text.indexOf('</child>'), kind: 'xml' },
  ]);
  for (const payload of ['"😀\r\nx"', ' keep\r\n  spaces ', '<![CDATA[\r\n raw]]>', '<!--\r\n comment -->']) {
    assert.ok(result.protectedRanges.some(range => text.slice(range.start, range.end) === payload), payload);
  }
  assert.ok(result.folds.some(range => range.start === text.indexOf('<root')));
});

test('raw unknown and GraphQL fences stay protected; exact JSON/XML hints permit injected indentation', () => {
  for (const hint of ['', 'raw', 'graphql', 'unknown', 'JSON', 'json+extra']) {
    const text = `POST https://example.org\n\`\`\`${hint}\n keep\n   spacing\n\`\`\`\n`;
    const bodyStart = text.indexOf('\n', text.indexOf('```')) + 1;
    const bodyEnd = text.lastIndexOf('```');
    assert.ok(analyze(text).protectedRanges.some(range => range.start <= bodyStart && range.end >= bodyEnd), hint);
  }
  for (const hint of ['json', 'xml']) {
    const text = `POST https://example.org\n\`\`\`${hint}\n keep\n{{name\n}}\n\`\`\`\n`;
    const result = analyze(text);
    assert.ok(result.folds.some(range => range.start === text.indexOf('```')));
    assert.ok(!result.protectedRanges.some(range => range.start <= text.indexOf(' keep') && range.end >= text.lastIndexOf('```')));
    assert.ok(result.protectedRanges.some(range => text.slice(range.start, range.end) === '{{name\n}}'));
  }
});

test('quoted multiline content including templates remains protected', () => {
  const text = 'GET https://example.org\nHTTP 200\n[Asserts]\nbody == " keep\n  {{name\n}}\n spacing"\n';
  const result = analyze(text);
  assert.ok(result.protectedRanges.some(range => text.slice(range.start, range.end) === '" keep\n  {{name\n}}\n spacing"'));
});

test('parser errors and missing nodes produce bounded nonoverlapping syntax issues', () => {
  for (const text of ['POST https://example.org\n{"a":1\n', 'GET https://example.org\nHTTP\n',
    'GET https://example.org\nHTTP 200\n[Asserts]\nstatus ==\n']) {
    const result = analyze(text);
    assert.ok(result.issues.some(issue => issue.code === 'syntax-error'), text);
    assert.equal(result.containers.length, 0);
    for (const issue of result.issues) {
      assert.ok(issue.start >= 0 && issue.end <= text.length && issue.start <= issue.end);
      assert.ok(issue.message.length > 0 && issue.message.length < 200);
    }
  }
  const text = 'POST https://example.org\n{"a":}\n';
  assert.deepEqual(analyze(text).issues, [{ start: text.indexOf('}'), end: text.indexOf('}'), code: 'missing-token', message: 'Missing null' }]);
  const many = analyze(text.repeat(150)).issues;
  assert.equal(many.length, 100);
  for (let index = 1; index < many.length; index++) {
    assert.ok(many[index].start >= many[index - 1].end);
  }
});

test('external XML element tags supply injected containers and protected character data', async () => {
  const xmlParser = new Parser();
  try {
    xmlParser.setLanguage(await Language.load(require.resolve('@lumis-sh/wasm-xml/tree-sitter-xml.wasm')));
    const text = '<root a="😀\n x">\n<child> keep\n spacing </child><![CDATA[a\nb]]><!--c\nd--><empty/>\n</root>';
    const tree = xmlParser.parse(text)!;
    try {
      const result = analyzeTree(tree.rootNode, text);
      assert.deepEqual(result.containers, [
        { start: 0, end: text.length, close: text.indexOf('</root>'), kind: 'xml' },
        { start: text.indexOf('<child>'), end: text.indexOf('</child>') + 8, close: text.indexOf('</child>'), kind: 'xml' },
      ]);
      assert.ok(result.folds.some(range => range.start === 0 && range.end === text.length));
      for (const payload of ['"😀\n x"', ' keep\n spacing ', '<![CDATA[a\nb]]>', '<!--c\nd-->']) {
        assert.ok(result.protectedRanges.some(range => text.slice(range.start, range.end) === payload), payload);
      }
    } finally { tree.delete(); }
  } finally { xmlParser.delete(); }
});

test('standalone CR fence payload protection preserves original offsets', () => {
  const text = 'POST https://example.org\r```raw\r keep\r  spacing\r```\r';
  const result = analyze(text);
  assert.ok(result.protectedRanges.some(range => text.slice(range.start, range.end) === ' keep\r  spacing\r'));
});

test('cancellation discards partial results and parser reuse retains no tree-backed objects', () => {
  const text = 'GET https://example.org\nHTTP 200\n'.repeat(300);
  let checks = 0;
  assert.deepEqual(analyze(text, () => ++checks >= 3), emptyStructure());
  assert.equal(checks, 3);
  assert.deepEqual(analyze(text, () => true), emptyStructure());
  const source = 'POST https://example.org\n{ "a": true }\n';
  const baseline = analyze(source);
  for (let index = 0; index < 50; index++) {
    assert.deepEqual(analyze(source), baseline);
    analyze('POST https://example.org\n{"a":}\n');
  }
  assert.equal(baseline.issues.length, 0);
  assert.equal(baseline.containers.length, 1);
});

test('deep real trees use iterative traversal without a JavaScript recursion limit', () => {
  const depth = 2048;
  const text = 'POST https://example.org\n' + '{"a":\n'.repeat(depth) + 'true\n' + '}\n'.repeat(depth);
  const result = analyze(text);
  assert.equal(result.containers.length, depth);
  assert.deepEqual(result.issues, []);
  assert.equal(result.containers[0].end, text.length - 1);
});

test('incomplete raw fence content stays protected even during parser recovery', () => {
  const text = 'POST https://example.org\n```raw\n keep\n  spacing\n';
  const result = analyze(text);
  assert.ok(result.issues.length > 0);
  const payload = ' keep\n  spacing\n';
  assert.ok(result.protectedRanges.some(range => text.slice(range.start, range.end) === payload));
});

test('JSON strings across physical lines stay protected including invalid controls and valid templates', () => {
  for (const value of ['"keep\n spaces"', '"{{name\n}}"']) {
    const text = `POST https://example.org\n{"a":${value}}\n`;
    const result = analyze(text);
    assert.ok(result.protectedRanges.some(range => text.slice(range.start, range.end) === value));
    assert.equal(result.issues.length > 0, value.includes(' spaces'));
  }
});

test('empty structures own independent arrays and analyze empty input', () => {
  const expected = { folds: [], links: [], xmlRegions: [], protectedRanges: [], containers: [], issues: [] };
  assert.deepEqual(emptyStructure(), expected);
  assert.notEqual(emptyStructure().folds, emptyStructure().folds);
  assert.deepEqual(analyze(''), expected);
});
