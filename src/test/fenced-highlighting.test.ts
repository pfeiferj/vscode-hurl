import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { before, after, test } from 'node:test';

import { Highlighter, tokenTypes } from '../highlighting';

let highlighter: Highlighter;
before(async () => { highlighter = await Highlighter.create(path.resolve(__dirname, '../../tree-sitter-hurl.wasm')); });
after(() => highlighter.dispose());

function tokens(text: string) {
  const lines = text.split(/\r\n|\r|\n/);
  const result = highlighter.tokenize(text);
  for (let i = 0; i < result.length; i++) {
    const token = result[i];
    assert.ok(token.length > 0 && token.start + token.length <= lines[token.line].length);
    const previous = result[i - 1];
    assert.ok(!previous || previous.line < token.line ||
      (previous.line === token.line && previous.start + previous.length <= token.start));
  }
  return result.map(token => ({ ...token, type: tokenTypes[token.type],
    text: lines[token.line].slice(token.start, token.start + token.length) }));
}

test('fenced languages reach final semantic tokens without swallowing Hurl interpolation', () => {
  const source = ['POST https://example.org/{{url}}', '```json', '{"enabled":true,"value":"😀{{name}}tail"}', '```',
    'POST https://example.org', '```xml', '<root attr="{{id}}"/>', '```',
    'POST https://example.org', '```graphql', 'query Demo { user(id: {{id}}) { name } }', '```', ''].join('\r\n');
  const result = tokens(source);
  for (const [text, type] of [['"enabled"', 'property'], ['true', 'hurlBoolean'], ['name', 'variable'],
    ['root', 'type'], ['attr', 'property'], ['query', 'keyword'], ['{{', 'punctuationSpecial'], ['}}', 'punctuationSpecial']]) {
    assert.ok(result.some(token => token.text === text && token.type === type), `${text}: ${type}`);
  }
  assert.ok(result.some(token => token.text === 'tail"' && token.type === 'string'));
});

test('raw, untagged and unknown fences stay generic strings', () => {
  for (const hint of ['raw', '', 'unknown']) {
    const result = tokens(`POST https://example.org\n\`\`\`${hint}\n{"enabled":true,"v":"{{name}}"}\n\`\`\`\n`);
    assert.ok(!result.some(token => token.type === 'hurlBoolean'));
    assert.equal(result.filter(token => token.type === 'variable').length, hint === 'raw' ? 0 : 1);
  }
});
