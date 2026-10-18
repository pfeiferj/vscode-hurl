import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

async function checkDocument(document: vscode.TextDocument): Promise<void> {
  const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>(
    'vscode.provideDocumentSemanticTokensLegend', document.uri);
  const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
    'vscode.provideDocumentSemanticTokens', document.uri);
  assert.ok(legend && tokens && tokens.data.length > 0, `No tokens for ${document.uri}`);
  assert.equal(new Set(legend.tokenTypes).size, legend.tokenTypes.length);
  let line = 0;
  let start = 0;
  let previousEnd = 0;
  for (let i = 0; i < tokens.data.length; i += 5) {
    const deltaLine = tokens.data[i];
    line += deltaLine;
    start = deltaLine ? tokens.data[i + 1] : start + tokens.data[i + 1];
    const length = tokens.data[i + 2];
    assert.ok(length > 0 && start + length <= document.lineAt(line).text.length);
    assert.ok(deltaLine > 0 || start >= previousEnd);
    previousEnd = start + length;
    assert.ok(tokens.data[i + 3] < legend.tokenTypes.length);
  }
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('JacobPfeifer.pfeifer-hurl');
  assert.ok(extension);
  const text = 'POST https://example.com\r\n{ "emoji": "😀\\nvalue" }\r\n';
  const document = await vscode.workspace.openTextDocument({ language: 'hurl', content: text });
  await extension.activate();
  assert.ok(extension.isActive);
  await checkDocument(document);
  const contentProvider = vscode.workspace.registerTextDocumentContentProvider('hurl-test', {
    provideTextDocumentContent: () => text,
  });
  try {
    const custom = await vscode.workspace.openTextDocument(vscode.Uri.parse('hurl-test:/remote.hurl'));
    await vscode.languages.setTextDocumentLanguage(custom, 'hurl');
    await checkDocument(custom);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)),
      '# 😀 changed\n');
    assert.ok(await vscode.workspace.applyEdit(edit));
    await checkDocument(document);
    assert.ok(!(await vscode.commands.getCommands(true)).includes('hurl.hurl'));
    console.log(`Hurl integration passed: VS Code ${vscode.version}, Node ${process.versions.node}; untitled/custom schemes, edits, no runner.`);
  } finally {
    contentProvider.dispose();
  }
}
