import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { after, before, mock, test } from 'node:test';
import { Language, Parser, Node, Query, Tree } from 'web-tree-sitter';

import { EmbeddedHighlighter } from '../embedded';

let hurl: Parser;
let embedded: EmbeddedHighlighter;
before(async () => {
  await Parser.init({ locateFile: () => require.resolve('web-tree-sitter/web-tree-sitter.wasm') });
  hurl = new Parser();
  hurl.setLanguage(await Language.load(path.resolve(__dirname, '../../tree-sitter-hurl.wasm')));
  embedded = await EmbeddedHighlighter.create();
});
after(() => { embedded?.dispose(); hurl?.delete(); });

function fences<T>(text: string, run: (nodes: Node[]) => T): T {
  const tree = hurl.parse(text)!;
  try {
    const nodes = tree.rootNode.descendantsOfType('multiline_string');
    assert.ok(nodes.length > 0, tree.rootNode.toString());
    return run(nodes);
  } finally { tree.delete(); }
}

function marked(text: string) {
  return fences(text, nodes => nodes.flatMap(node => embedded.spans(text, node)))
    .map(span => ({ ...span, text: text.slice(span.start, span.end) }));
}

test('embedded parsing cooperatively cancels and resets before the next fence', () => {
  const body = '[' + '{"x":true},'.repeat(5000) + 'null]';
  const text = `POST https://x\n\`\`\`json\n${body}\n\`\`\`\n`;
  fences(text, nodes => {
    let checks = 0;
    const cancellable = embedded.spans.bind(embedded) as (text: string, node: Node, shouldCancel: () => boolean) => unknown[];
    const result = cancellable(text, nodes[0], () => ++checks > 5);
    assert.ok(result.length === 0, 'cancelled embedded parse must not return partial captures');
    assert.ok(checks > 5, 'embedded parser must consult cancellation during active work');
  });
  const next = marked('POST https://x\n```json\n{"fresh":false}\n```\n');
  assert.ok(next.some(span => span.text === 'false' && span.capture === 'boolean'));
});

test('pinned packaged WASM assets match provenance and load with runtime ABI 13–15', async () => {
  for (const [name, version] of [['json', '0.26.5'], ['xml', '0.26.4'], ['graphql', '0.26.3']]) {
    const metadata = JSON.parse(readFileSync(require.resolve(`@lumis-sh/wasm-${name}/lumis.json`), 'utf8'));
    const wasmPath = require.resolve(`@lumis-sh/wasm-${name}/tree-sitter-${name}.wasm`);
    const pinned = JSON.parse(readFileSync(path.resolve(__dirname, '../../grammars/embedded/provenance.json'), 'utf8'))[name];
    assert.equal(metadata.version, version);
    assert.deepEqual(metadata.parser, pinned.parser);
    assert.equal(createHash('sha256').update(readFileSync(wasmPath)).digest('hex'), pinned.parser.sha256);
    const language = await Language.load(wasmPath);
    assert.equal(language.abiVersion, 15);
    const query = new Query(language, metadata.languages[name].highlights);
    query.delete();
  }
});

test('packaged JSON grammar highlights only the fenced body with absolute offsets', () => {
  const text = 'POST https://example.com\n```json\n{"name":"Ada", "ok":true,"n":42,"nil":null}\n```\n';
  const result = marked(text);
  for (const [value, capture] of [['"name"', 'property'], ['"Ada"', 'string'],
    ['true', 'boolean'], ['42', 'number'], ['null', 'keyword'], ['{', 'punctuation.bracket']]) {
    assert.ok(result.some(span => span.text === value && span.capture === capture), `${value}: ${capture}`);
  }
  assert.ok(result.every(span => span.start >= text.indexOf('{') && span.end <= text.lastIndexOf('```')));
});

test('GraphQL grammar classifies operations, variables, fields and scalar values', () => {
  const result = marked('POST https://example.com\n```graphql\n# note\nquery Find($id: ID!) { user(id: $id, active: true, ratio: 1.5, n: 2, s: "x") { name } }\n```');
  for (const [value, capture] of [['query', 'keyword'], ['$id', 'variable'], ['ID', 'type'],
    ['user', 'property'], ['# note', 'comment'], ['1.5', 'float'], ['2', 'number'],
    ['true', 'boolean'], ['"x"', 'string']]) {
    assert.ok(result.some(span => span.text === value && span.capture === capture), `${value}: ${capture}`);
  }
});

test('templates are masked without shifting UTF-16 offsets or consuming Hurl interpolation', () => {
  for (const [hint, body, expected] of [
    ['json', '{"é":"😀{{ value | replace "😀" "y" }}tail\\n", "amount":{{\r\namount\r\n}}, "ok":true}', 'tail'],
    ['xml', '<root id="😀{{value}}tail">{{content}}<child ok="yes" /></root>', '"yes"'],
    ['graphql', 'query { user(id: {{id}}) { name(note: "😀{{value}}tail") active } }', 'active'],
  ]) {
    const text = `# 😀 prefix\r\nPOST https://example.com\r\n\`\`\`${hint}\r\n${body}\r\n\`\`\`\r\n`;
    fences(text, nodes => {
      const fence = nodes[0];
      const templates = fence.descendantsOfType('template');
      assert.ok(templates.length >= 1);
      const spans = embedded.spans(text, fence);
      assert.ok(spans.some(span => text.slice(span.start, span.end).includes(expected)), hint);
      for (const span of spans) {
        assert.ok(span.end > span.start);
        assert.ok(span.start >= text.indexOf(body) && span.end <= text.indexOf(body) + body.length);
        assert.ok(templates.every(template => span.end <= template.startIndex || span.start >= template.endIndex),
          `${hint}: ${JSON.stringify(text.slice(span.start, span.end))}`);
      }
      if (hint === 'json') {
        assert.ok(spans.some(span => span.capture === 'boolean' && text.slice(span.start, span.end) === 'true'));
        assert.ok(spans.some(span => span.capture === 'string.escape' && text.slice(span.start, span.end) === '\\n'));
      }
    });
  }
});

test('disposal releases parsers and queries once and rejects further work', async () => {
  const local = await EmbeddedHighlighter.create();
  const parsers = mock.method(Parser.prototype, 'delete');
  const queries = mock.method(Query.prototype, 'delete');
  try {
    local.dispose();
    local.dispose();
    assert.equal(parsers.mock.callCount(), 3);
    assert.equal(queries.mock.callCount(), 3);
    fences('POST https://x\n```json\n{}\n```', nodes => {
      assert.throws(() => local.spans('unused', nodes[0]), /disposed/);
    });
  } finally {
    parsers.mock.restore();
    queries.mock.restore();
    local.dispose();
  }
});

test('failed initialization releases earlier grammars and the failing parser', async () => {
  const setLanguage = Parser.prototype.setLanguage;
  let attempts = 0;
  const failure = mock.method(Parser.prototype, 'setLanguage', function(this: Parser, language: Language) {
    if (++attempts === 2) { throw new Error('initialization failed'); }
    return setLanguage.call(this, language);
  });
  const parsers = mock.method(Parser.prototype, 'delete');
  const queries = mock.method(Query.prototype, 'delete');
  try {
    await assert.rejects(EmbeddedHighlighter.create(), /initialization failed/);
    assert.equal(parsers.mock.callCount(), 2);
    assert.equal(queries.mock.callCount(), 1);
  } finally {
    failure.mock.restore();
    parsers.mock.restore();
    queries.mock.restore();
  }
});

test('unsupported hints and raw fences remain generic Hurl strings', () => {
  for (const hint of ['', 'raw', 'yaml', 'JSON', 'json;escape', 'gql']) {
    const text = `POST https://example.com\n\`\`\`${hint}\n{"looks":"json", "value":"{{id}}"}\n\`\`\``;
    fences(text, nodes => assert.deepEqual(embedded.spans(text, nodes[0]), [], hint));
  }
});

test('multiple fenced languages are parsed independently, never as a whole document', () => {
  const text = [
    'POST https://x/{{url}}', '```json', '{"a":true}', '```', 'HTTP 200',
    'POST https://x', '```xml', '<root name="Ada" />', '```', 'HTTP 200',
    'POST https://x', '```graphql', 'query { user { name } }', '```', 'HTTP 200',
    'POST https://x', '```json', '{"b":false}', '```',
  ].join('\r\n');
  fences(text, nodes => {
    assert.equal(nodes.length, 4);
    const results = nodes.map(node => embedded.spans(text, node));
    for (const [index, spans] of results.entries()) {
      assert.ok(spans.length > 0);
      assert.ok(spans.every(span => span.start > nodes[index].startIndex && span.end < nodes[index].endIndex));
    }
    assert.ok(results[0].some(span => text.slice(span.start, span.end) === 'true'));
    assert.ok(results[3].some(span => text.slice(span.start, span.end) === 'false'));
    assert.deepEqual(embedded.spans(text, nodes[0]), results[0]);
  });
});

test('incomplete embedded content recovers without retaining tokens from previous fences', () => {
  for (const [hint, body] of [['json', '{"ok": true, "broken": ['],
    ['xml', '<root id="x"><unfinished'], ['graphql', 'query { user(id: 1) { name']]) {
    const text = `POST https://x\n\`\`\`${hint}\n${body}\n\`\`\``;
    const result = marked(text);
    assert.ok(result.length > 0, hint);
    assert.ok(result.every(span => span.start >= text.indexOf(body) && span.end <= text.lastIndexOf('```')));
    const empty = `POST https://x\n\`\`\`${hint}\n\`\`\``;
    fences(empty, nodes => assert.deepEqual(embedded.spans(empty, nodes[0]), []));
  }
});

test('parsed trees are released on success and query failure', () => {
  const text = 'POST https://x\n```json\n{"x":1}\n```';
  fences(text, nodes => {
    const deleted = mock.method(Tree.prototype, 'delete');
    try {
      for (let i = 0; i < 10; i++) { embedded.spans(text, nodes[0]); }
      assert.equal(deleted.mock.callCount(), 10);
      const captures = mock.method(Query.prototype, 'captures', () => { throw new Error('query failed'); });
      try {
        assert.throws(() => embedded.spans(text, nodes[0]), /query failed/);
        assert.equal(deleted.mock.callCount(), 11);
      } finally { captures.mock.restore(); }
    } finally { deleted.mock.restore(); }
  });
});

test('XML grammar classifies tags, attributes, entities, comments and declarations', () => {
  const result = marked('POST https://example.com\n```xml\n<?xml version="1.0"?>\n<!-- note -->\n<root id="42">&amp;<child /></root>\n```');
  for (const [value, capture] of [['root', 'type'], ['id', 'property'], ['"42"', 'string'],
    ['<!-- note -->', 'comment'], ['&amp;', 'string.escape'], ['xml', 'keyword'], ['<', 'punctuation.bracket']]) {
    assert.ok(result.some(span => span.text === value && span.capture === capture), `${value}: ${capture}`);
  }
});
