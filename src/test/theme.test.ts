import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

import { semanticTokenScopes, semanticTokenTypes, tokenTypes } from '../tokens';

const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));

test('all custom semantic types are contributed with Hurl-specific TextMate fallback scopes', () => {
  assert.deepEqual(manifest.contributes.semanticTokenTypes, semanticTokenTypes);
  assert.deepEqual(manifest.contributes.semanticTokenScopes, semanticTokenScopes);
  const standard = new Set(['namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter',
    'parameter', 'variable', 'property', 'enumMember', 'event', 'function', 'method', 'macro', 'keyword',
    'modifier', 'comment', 'string', 'number', 'regexp', 'operator', 'decorator']);
  const custom = tokenTypes.filter(type => !standard.has(type));
  assert.ok(custom.length > 0, 'Hurl-specific tokens must retain their styling distinctions');
  for (const id of custom) {
    assert.ok(manifest.contributes.semanticTokenTypes?.some((type: { id: string }) => type.id === id), `missing contributed ${id}`);
    assert.ok(manifest.contributes.semanticTokenScopes?.some((entry: { language: string; scopes: Record<string, string[]> }) =>
      entry.language === 'hurl' && entry.scopes[id]?.length > 0), `missing Hurl scope fallback for ${id}`);
  }
});

test('semantic highlighting is enabled only as an overridable Hurl language default', () => {
  assert.deepEqual(manifest.contributes.configurationDefaults, { '[hurl]': { 'editor.semanticHighlighting.enabled': true } });
});
