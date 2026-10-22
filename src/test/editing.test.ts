import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import * as path from 'node:path';
import { Language, Parser } from 'web-tree-sitter';
import { analyzeTree, type DocumentStructure, type IndentContainer } from '../analysis';
import { commentEdits, indentationEdits, TextEdit } from '../editing';

function structure(containers: IndentContainer[] = [], extra: Partial<DocumentStructure> = {}): DocumentStructure {
  return { containers, folds: [], links: [], issues: [], xmlRegions: [], protectedRanges: [], ...extra };
}
function apply(text: string, edits: TextEdit[] | undefined): string {
  return [...(edits ?? [])].sort((a, b) => b.start - a.start)
    .reduce((value, edit) => value.slice(0, edit.start) + edit.text + value.slice(edit.end), text);
}
function container(text: string, kind: 'json' | 'xml' = 'json'): IndentContainer {
  return { start: text.indexOf(kind === 'json' ? '{' : '<'), end: text.length, close: text.lastIndexOf(kind === 'json' ? '}' : '</'), kind };
}
const spaces = { tabSize: 2, insertSpaces: true };

test('explicit Hurl commenting works without relying on editor focus and roundtrips', () => {
  const text = 'GET https://example.org\n  header: value\n';
  const selected = [{ start: 0, end: text.length }];
  const commented = apply(text, commentEdits(text, structure(), selected, true));
  assert.equal(commented, '# GET https://example.org\n  # header: value\n');
  assert.equal(apply(commented, commentEdits(commented, structure(), [{ start: 0, end: commented.length }], true)), text);
});

test('actual Hurl AST drives JSON indentation without modifying quoted values or request lines', async () => {
  await Parser.init({ locateFile: () => require.resolve('web-tree-sitter/web-tree-sitter.wasm') });
  const parser = new Parser();
  try {
    parser.setLanguage(await Language.load(path.resolve(process.cwd(), 'tree-sitter-hurl.wasm')));
    const text = 'POST https://x\n{\n"a": [\n" { value } ",\ntrue\n],\n"b": "{{variable}}"\n}\n';
    const tree = parser.parse(text)!;
    try {
      const model = analyzeTree(tree.rootNode, text);
      assert.equal(model.containers.length, 2);
      const result = apply(text, indentationEdits(text, model, spaces));
      assert.equal(result, 'POST https://x\n{\n  "a": [\n    " { value } ",\n    true\n  ],\n  "b": "{{variable}}"\n}\n');
      const updated = parser.parse(result)!;
      try { assert.deepEqual(indentationEdits(result, analyzeTree(updated.rootNode, result), spaces), []); }
      finally { updated.delete(); }
    } finally { tree.delete(); }
  } finally { parser.delete(); }
});

test('actual XML AST preserves text payloads and supplies comment regions', async () => {
  await Parser.init({ locateFile: () => require.resolve('web-tree-sitter/web-tree-sitter.wasm') });
  const parser = new Parser();
  try {
    parser.setLanguage(await Language.load(path.resolve(process.cwd(), 'tree-sitter-hurl.wasm')));
    const text = 'POST https://x\n<root>\n        <child/>\n<text>hello\n   keep this\n</text>\n</root>\n';
    const tree = parser.parse(text)!;
    try {
      const model = analyzeTree(tree.rootNode, text);
      assert.ok(model.xmlRegions.length);
      assert.equal(apply(text, indentationEdits(text, model, spaces)),
        'POST https://x\n<root>\n  <child/>\n  <text>hello\n   keep this\n  </text>\n</root>\n');
      const start = text.indexOf('<child/>');
      assert.equal(apply(text, commentEdits(text, model, [{ start, end: start }])),
        text.slice(0, start) + '<!-- <child/> -->' + text.slice(start + '<child/>'.length));
    } finally { tree.delete(); }
  } finally { parser.delete(); }
});

test('native XML multiline attributes make opening-line commenting an atomic no-op', async () => {
  await Parser.init({ locateFile: () => require.resolve('web-tree-sitter/web-tree-sitter.wasm') });
  const parser = new Parser();
  try {
    parser.setLanguage(await Language.load(path.resolve(process.cwd(), 'tree-sitter-hurl.wasm')));
    const text = 'POST https://x\n<root attr="value>\nmore">\n<child/>\n</root>\n';
    const tree = parser.parse(text)!;
    try {
      assert.equal(tree.rootNode.hasError, false);
      const model = analyzeTree(tree.rootNode, text);
      const start = text.indexOf('<root');
      assert.deepEqual(commentEdits(text, model, [{ start, end: start }]), []);
      assert.deepEqual(commentEdits(text, model, [{ start: 0, end: text.indexOf('more') }], true), []);
    } finally { tree.delete(); }
  } finally { parser.delete(); }
});

test('XML text beginning on its own line retains its leading payload whitespace', async () => {
  await Parser.init({ locateFile: () => require.resolve('web-tree-sitter/web-tree-sitter.wasm') });
  const parser = new Parser();
  try {
    parser.setLanguage(await Language.load(path.resolve(process.cwd(), 'tree-sitter-hurl.wasm')));
    const text = 'POST https://x\n<root>\n     literal text\n</root>\n';
    const tree = parser.parse(text)!;
    try {
      assert.equal(apply(text, indentationEdits(text, analyzeTree(tree.rootNode, text), spaces)), text);
    } finally { tree.delete(); }
  } finally { parser.delete(); }
});

test('nested XML containers align closing tags without touching protected text, CDATA, or comment continuations', () => {
  const text = '<root>\n<child>\n     literal text\n <![CDATA[\n   exact payload\n ]]>\n <!-- note\n  exact comment -->\n</child>\n</root>';
  const outer = container(text, 'xml');
  const child = { start: text.indexOf('<child>'), close: text.indexOf('</child>'), end: text.indexOf('</child>') + '</child>'.length, kind: 'xml' as const };
  const protectedRanges = [
    { start: text.indexOf('literal'), end: text.indexOf('\n', text.indexOf('literal')) },
    { start: text.indexOf('<![CDATA['), end: text.indexOf(']]>') + 3 },
    { start: text.indexOf('<!--'), end: text.indexOf('-->') + 3 },
  ];
  // The text range starts before the line's indentation: XML text whitespace is payload.
  protectedRanges[0].start = text.lastIndexOf('\n', protectedRanges[0].start - 1);
  const model = structure([outer, child], { protectedRanges });
  assert.equal(apply(text, indentationEdits(text, model, spaces)),
    '<root>\n  <child>\n     literal text\n    <![CDATA[\n   exact payload\n ]]>\n    <!-- note\n  exact comment -->\n  </child>\n</root>');
});

for (const newline of ['\n', '\r\n', '\r']) {
  test(`nested containers preserve tabs and ${JSON.stringify(newline)} offsets`, () => {
    const text = ['\t{', '"x": {', '"key": "😀"', '}', '}'].join(newline);
    const outer = container(text);
    const inner = { start: text.indexOf('{', outer.start + 1), end: text.indexOf('}'), close: text.indexOf('}'), kind: 'json' as const };
    inner.end++;
    const result = apply(text, indentationEdits(text, structure([inner, outer]), { tabSize: 4, insertSpaces: false }));
    assert.equal(result, ['\t{', '\t\t"x": {', '\t\t\t"key": "😀"', '\t\t}', '\t}'].join(newline));
  });
}

test('protected starting quoted keys indent but multiline payload continuations do not', () => {
  const text = '{\n"{{key\n     continuation}}": 1,\n"next": 2\n}';
  const start = text.indexOf('"');
  const end = text.indexOf('":') + 1;
  const result = apply(text, indentationEdits(text, structure([container(text)], { protectedRanges: [{ start, end }] }), spaces));
  assert.equal(result, '{\n  "{{key\n     continuation}}": 1,\n  "next": 2\n}');
});

test('selection end at column zero excludes its last line and blank lines can indent', () => {
  const text = '{\n\n"a": 1\n}';
  assert.equal(apply(text, indentationEdits(text, structure([container(text)]), spaces,
    { start: 2, end: text.indexOf('"') })), '{\n  \n"a": 1\n}');
});

test('non-container raw, unknown, and GraphQL payloads are unchanged', () => {
  const text = 'POST https://x\n```graphql\n query {\n  user\n }\n```\n';
  assert.deepEqual(indentationEdits(text, structure(), spaces), []);
});

test('XML-aware comment toggling handles a mixed selection and roundtrips', () => {
  const text = 'GET https://x\r\n<root>\r\n  <child/>\r\n</root>\r\n';
  const xmlStart = text.indexOf('<');
  const model = structure([], { xmlRegions: [{ start: xmlStart, end: text.lastIndexOf('>') + 1 }] });
  const edits = commentEdits(text, model, [{ start: 0, end: text.length }]);
  assert.ok(edits);
  const commented = apply(text, edits);
  assert.equal(commented, '# GET https://x\r\n<!-- <root> -->\r\n  <!-- <child/> -->\r\n<!-- </root> -->\r\n');
  const updated = structure([], { xmlRegions: [{ start: commented.indexOf('<'), end: commented.lastIndexOf('>') + 1 }] });
  assert.equal(apply(commented, commentEdits(commented, updated, [{ start: 0, end: commented.length }])), text);
});

test('a protected multiline token starting after indentation still permits its opening line indent', () => {
  const text = '{\n     "{{key\n untouched}}": 1\n}';
  const model = structure([container(text)], { protectedRanges: [{ start: text.indexOf('"'), end: text.lastIndexOf('"') + 1 }] });
  assert.equal(apply(text, indentationEdits(text, model, spaces)), '{\n  "{{key\n untouched}}": 1\n}');
});

test('disjoint selections include a later cursor on an excluded end-column-zero line', () => {
  const text = '<a/>\n<b/>\n<c/>';
  const model = structure([], { xmlRegions: [{ start: 0, end: text.length }] });
  const edits = commentEdits(text, model, [{ start: 0, end: 5 }, { start: 7, end: 7 }]);
  assert.equal(apply(text, edits), '<!-- <a/> -->\n<!-- <b/> -->\n<c/>');
});

test('non-XML selections defer to the builtin even when XML exists elsewhere', () => {
  const text = 'GET https://x\n<a/>';
  const model = structure([], { xmlRegions: [{ start: text.indexOf('<'), end: text.length }] });
  assert.equal(commentEdits(text, model, [{ start: 0, end: text.indexOf('<') }]), undefined);
});

for (const body of ['<x a="a--b"/>', '<![CDATA[anything]]>', '<x', ' attr="x">', '<!-- multi', 'continued -->', '<x><!-- inside --></x>']) {
  test(`unsafe XML comment operation is atomic for ${JSON.stringify(body)}`, () => {
    const text = `GET https://x\n${body}`;
    const model = structure([], { xmlRegions: [{ start: text.indexOf('\n') + 1, end: text.length }] });
    assert.deepEqual(commentEdits(text, model, [{ start: 0, end: text.length }]), []);
  });
}

test('overlapping reversed selections are deduplicated and blank lines remain untouched', () => {
  const text = '\t<a/>\n  \n\t<b/>  ';
  const model = structure([], { xmlRegions: [{ start: 1, end: text.length }] });
  const edits = commentEdits(text, model, [{ start: text.length, end: 0 }, { start: 1, end: 4 }]);
  assert.equal(edits?.length, 2);
  const result = apply(text, edits);
  assert.equal(result, '\t<!-- <a/> -->\n  \n\t<!-- <b/>   -->');
  assert.equal(apply(result, commentEdits(result, structure([], { xmlRegions: [{ start: 1, end: result.length }] }), [{ start: 0, end: result.length }])), text);
});

test('existing standalone XML comments unwrap without introducing nested comments', () => {
  const text = '  <!--original-->  ';
  assert.equal(apply(text, commentEdits(text, structure([], { xmlRegions: [{ start: 2, end: text.length }] }), [{ start: 5, end: 5 }])), '  original  ');
});

test('independent outer containers preserve their own bases and never edit intervening Hurl lines', () => {
  const text = '\t{\n"first": {}\n}\nGET https://x\n    {\n"second": 2\n}';
  const firstEnd = text.indexOf('\nGET');
  const first = { start: 1, close: firstEnd - 1, end: firstEnd, kind: 'json' as const };
  const second = { start: text.indexOf('{', firstEnd), close: text.lastIndexOf('}'), end: text.length, kind: 'json' as const };
  assert.equal(apply(text, indentationEdits(text, structure([second, first]), spaces)),
    '\t{\n\t  "first": {}\n\t}\nGET https://x\n    {\n      "second": 2\n    }');
});

test('selection formatting derives depth from containers opened outside the range', () => {
  const text = '{\n"nested": {\n"x": 1\n}\n}';
  const inner = { start: text.indexOf('{', 1), close: text.indexOf('}'), end: text.indexOf('}') + 1, kind: 'json' as const };
  const start = text.indexOf('"x"');
  assert.equal(apply(text, indentationEdits(text, structure([container(text), inner]), spaces, { start, end: start })),
    '{\n"nested": {\n    "x": 1\n}\n}');
});

test('protected XML attribute continuation resembling a tag is never commented', () => {
  const text = '<root attr="\n<fake/>\n">\n</root>';
  const start = text.indexOf('<fake/>');
  const model = structure([], { xmlRegions: [{ start: 0, end: text.length }],
    protectedRanges: [{ start: text.indexOf('"'), end: text.lastIndexOf('"') + 1 }] });
  assert.deepEqual(commentEdits(text, model, [{ start, end: start }]), []);
});

test('comments preserve standalone CR line breaks and skip the final end-column-zero line', () => {
  const text = '\t<a/>\r\t<b/>\r<c/>';
  const end = text.indexOf('<c/>');
  const model = structure([], { xmlRegions: [{ start: 1, end: text.length }] });
  assert.equal(apply(text, commentEdits(text, model, [{ start: 1, end }])),
    '\t<!-- <a/> -->\r\t<!-- <b/> -->\r<c/>');
});

test('XML comments never swallow non-XML text sharing the same line', () => {
  const text = '<xml/> <hurl/>';
  const model = structure([], { xmlRegions: [{ start: 0, end: '<xml/>'.length }] });
  assert.deepEqual(commentEdits(text, model, [{ start: 0, end: 0 }]), []);
});

test('indents parsed JSON children and aligns the close while preserving outer base indentation', () => {
  const text = '  {\n"key": 1,\n     "other": true\n       }';
  assert.equal(apply(text, indentationEdits(text, structure([container(text)]), spaces)),
    '  {\n    "key": 1,\n    "other": true\n  }');
});
