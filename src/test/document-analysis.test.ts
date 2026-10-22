import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import { Highlighter } from '../highlighting';
import { commentEdits } from '../editing';

let highlighter: Highlighter;
before(async () => { highlighter = await Highlighter.create(path.resolve(__dirname, '../../tree-sitter-hurl.wasm')); });
after(() => highlighter.dispose());

test('tagged XML multiline attributes make opening-line commenting an atomic no-op', () => {
  const text = 'POST https://x\n```xml\n<root attr="value>\nmore">\n<child/>\n</root>\n```\n';
  const result = highlighter.analyze(text);
  assert.deepEqual(result.issues, []);
  const start = text.indexOf('<root');
  assert.deepEqual(commentEdits(text, result, [{ start, end: start }]), []);
  assert.deepEqual(commentEdits(text, result, [{ start: 0, end: text.indexOf('more') }], true), []);
});

test('tagged XML hints never count as XML content or block header and mixed comments', () => {
  const text = 'POST https://x\n```xml\n<root>\n<child/>\n</root>\n```\n';
  const result = highlighter.analyze(text);
  assert.deepEqual(result.issues, []);
  const header = text.indexOf('```xml');
  const body = text.indexOf('<root>');
  assert.ok(result.xmlRegions.length > 0);
  assert.ok(result.xmlRegions.every(region => region.end <= header || region.start >= body),
    'no native or embedded XML region may overlap the language hint');
  assert.equal(commentEdits(text, result, [{ start: header, end: header }]), undefined);
  assert.deepEqual(commentEdits(text, result, [{ start: header, end: header }], true),
    [{ start: header, end: header, text: '# ' }]);
  assert.deepEqual(commentEdits(text, result, [{ start: header, end: text.indexOf('<child/>') }], true), [
    { start: header, end: header, text: '# ' },
    { start: body, end: body + '<root>'.length, text: '<!-- <root> -->' },
  ]);
});

test('analysis reports syntax errors inside tagged JSON in original document coordinates', () => {
  const body = '{"broken": }';
  const text = `# 😀\r\nPOST https://example.org\r\n\`\`\`json\r\n${body}\r\n\`\`\`\r\n`;
  const result = highlighter.analyze(text);
  assert.ok(result.issues.length > 0, 'tagged JSON must expose native parser errors');
  assert.ok(result.issues.every(issue => issue.start >= text.indexOf(body) && issue.end <= text.lastIndexOf('```')));
  assert.ok(result.tokens.length > 0);
});

test('valid tagged templates remain valid; opaque and masked languages do not cause diagnostic noise', () => {
  for (const [hint, body] of [
    ['json', '{"{{key}}":"{{value replace "old" "new"}}", "n":{{amount}}}'],
    ['json', '{{payload}}'],
    ['raw', '{{not Hurl syntax "unterminated'], ['', 'this is literal'],
    ['unknown', 'not this language'], ['xml', '<root attr="{{value replace "old" "new"}}"/>'],
    ['graphql', 'query { user(id: {{id}}) { name } }'],
  ]) {
    const text = `POST https://example.org\n\`\`\`${hint}\n${body}\n\`\`\`\n`;
    assert.deepEqual(highlighter.analyze(text).issues, [], hint);
  }
});

test('standalone native XML comments retain XML commenting context', () => {
  const text = 'POST https://example.org\n<!-- <root/> -->\n';
  const comment = text.indexOf('<!--');
  assert.ok(highlighter.analyze(text).xmlRegions.some(region => region.start <= comment && region.end >= text.indexOf('-->') + 3));
});

test('tagged JSON and XML expose structural editing data without leaking synthetic requests', () => {
  const text = 'POST https://example.org\n```json\n{\n"items": [\n1\n]\n}\n```\n' +
    'POST https://example.org/next\n```xml\n<root>\n<child/>\n</root>\n```\n';
  const result = highlighter.analyze(text);
  assert.ok(result.containers.some(container => container.kind === 'json'));
  assert.ok(result.xmlRegions.some(region => text.slice(region.start, region.end).includes('<root>')));
  assert.equal(result.links.length, 2);
  assert.ok(result.links.every(link => !link.target.includes('hurl.invalid')));
});
