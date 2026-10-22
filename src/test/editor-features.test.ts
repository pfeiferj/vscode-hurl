import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

test('editor features are Hurl-scoped and deferred syntax squiggles have no runtime entry point', () => {
  const root = path.resolve(__dirname, '../..');
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.contributes.commands?.map((command: { command: string }) => command.command), ['hurl.toggleComment']);
  const binding = manifest.contributes.keybindings.find((item: { command: string }) => item.command === 'hurl.toggleComment');
  assert.equal(binding.key, 'ctrl+/');
  assert.equal(binding.mac, 'cmd+/');
  assert.match(binding.when, /editorLangId == hurl/);
  assert.match(binding.when, /!editorReadonly/);
  assert.equal(manifest.contributes.configuration?.properties?.['hurl.syntaxDiagnostics.enabled'], undefined);
  const source = readFileSync(path.join(root, 'src/extension.ts'), 'utf8');
  assert.doesNotMatch(source, /createDiagnosticCollection|new vscode\.Diagnostic|syntaxDiagnostics/);
  assert.equal(manifest.contributes.configurationDefaults['[hurl]']['editor.formatOnType'], true);
});
