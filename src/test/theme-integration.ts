import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) {
    await wait(50);
  }
  assert.ok(predicate(), message);
}

/** Observe editor-driven requests, not commands that bypass highlighting enablement. */
export async function checkThemeDelivery(extension: vscode.Extension<unknown>): Promise<void> {
  const { WorkerHighlighter } = require(path.join(extension.extensionPath, 'out/worker-highlighter.js'));
  const original = WorkerHighlighter.prototype.tokenize;
  const calls = new Map<string, number>();
  WorkerHighlighter.prototype.tokenize = function(key: string, ...args: unknown[]) {
    calls.set(key, (calls.get(key) || 0) + 1);
    return original.call(this, key, ...args);
  };
  const editor = vscode.workspace.getConfiguration('editor', { languageId: 'hurl' });
  const previous = editor.inspect('semanticHighlighting.enabled')?.globalLanguageValue;
  const workbench = vscode.workspace.getConfiguration('workbench');
  const previousTheme = workbench.inspect('colorTheme')?.globalValue;
  try {
    assert.equal(editor.inspect('semanticHighlighting.enabled')?.defaultLanguageValue, true,
      'Hurl must enable semantic highlighting independently of the selected theme');
    await workbench.update('colorTheme', 'Hurl Test Semantic Off', vscode.ConfigurationTarget.Global);
    await editor.update('semanticHighlighting.enabled', undefined, vscode.ConfigurationTarget.Global, true);
    const document = await vscode.workspace.openTextDocument({ language: 'hurl', content: 'GET https://example.org\n# visible editor\n' });
    const key = document.uri.toString();
    await vscode.window.showTextDocument(document);
    await waitFor(() => (calls.get(key) || 0) > 0, 'visible editor never requested Hurl highlighting under a semantic-disabled theme');

    for (const disabled of [false, 'configuredByTheme'] as const) {
      await editor.update('semanticHighlighting.enabled', disabled, vscode.ConfigurationTarget.Global, true);
      await wait(400);
      const before = calls.get(key) || 0;
      const edit = new vscode.WorkspaceEdit();
      edit.insert(document.uri, new vscode.Position(1, 0), '# updated\n');
      assert.ok(await vscode.workspace.applyEdit(edit));
      await wait(500);
      assert.equal(calls.get(key) || 0, before, `explicit ${disabled} override must disable automatic highlighting`);
      const direct = await vscode.commands.executeCommand<vscode.SemanticTokens>('vscode.provideDocumentSemanticTokens', document.uri);
      assert.ok(direct && direct.data.length > 0, 'provider tokens alone do not establish editor delivery');
    }
    const before = calls.get(key) || 0;
    await editor.update('semanticHighlighting.enabled', true, vscode.ConfigurationTarget.Global, true);
    await waitFor(() => (calls.get(key) || 0) > before, 'explicit enablement did not restore editor-driven requests');
    console.log('Visible-editor theme test passed: language default, explicit false/configuredByTheme overrides, explicit true.');
  } finally {
    WorkerHighlighter.prototype.tokenize = original;
    await editor.update('semanticHighlighting.enabled', previous, vscode.ConfigurationTarget.Global, true);
    await workbench.update('colorTheme', previousTheme, vscode.ConfigurationTarget.Global);
  }
}
