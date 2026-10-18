import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

async function checkDocument(document: vscode.TextDocument,
  expected: ReadonlyArray<readonly [string, string]> = []): Promise<void> {
  const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>(
    'vscode.provideDocumentSemanticTokensLegend', document.uri);
  const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
    'vscode.provideDocumentSemanticTokens', document.uri);
  assert.ok(legend && tokens && tokens.data.length > 0, `No tokens for ${document.uri}`);
  assert.equal(new Set(legend.tokenTypes).size, legend.tokenTypes.length);
  let line = 0;
  let start = 0;
  let previousEnd = 0;
  const decoded: Array<{ text: string; type: string }> = [];
  for (let i = 0; i < tokens.data.length; i += 5) {
    const deltaLine = tokens.data[i];
    line += deltaLine;
    start = deltaLine ? tokens.data[i + 1] : start + tokens.data[i + 1];
    const length = tokens.data[i + 2];
    assert.ok(length > 0 && start + length <= document.lineAt(line).text.length);
    assert.ok(deltaLine > 0 || start >= previousEnd);
    previousEnd = start + length;
    assert.ok(tokens.data[i + 3] < legend.tokenTypes.length);
    decoded.push({ text: document.lineAt(line).text.slice(start, start + length),
      type: legend.tokenTypes[tokens.data[i + 3]] });
  }
  for (const [text, type] of expected) {
    assert.ok(decoded.some(token => token.text === text && token.type === type), `${text}: ${type}`);
  }
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('JacobPfeifer.pfeifer-hurl');
  assert.ok(extension);
  const text = 'POST https://example.com/{{newUuid}}\r\n[Options]\r\nretry: -1\r\n' +
    'retry-interval: 2ms\r\nverbosity: debug\r\n' +
    '{ "emoji": "😀\\n{{name}}", "ok": true }\r\nHTTP 200\r\n[Asserts]\r\n' +
    'body charsetEncode "UTF-8" == "x"\r\n';
  const expected = [['newUuid', 'function'], ['-1', 'number'], ['ms', 'string'],
    ['debug', 'enumMember'], ['name', 'variable'], ['true', 'keyword'],
    ['charsetEncode', 'function']] as const;
  const document = await vscode.workspace.openTextDocument({ language: 'hurl', content: text });
  await extension.activate();
  assert.ok(extension.isActive);
  await checkDocument(document, expected);
  const contentProvider = vscode.workspace.registerTextDocumentContentProvider('hurl-test', {
    provideTextDocumentContent: () => text,
  });
  try {
    const custom = await vscode.workspace.openTextDocument(vscode.Uri.parse('hurl-test:/remote.hurl'));
    await vscode.languages.setTextDocumentLanguage(custom, 'hurl');
    await checkDocument(custom, expected);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)),
      '# 😀 changed\n');
    assert.ok(await vscode.workspace.applyEdit(edit));
    await checkDocument(document);
    assert.ok(!(await vscode.commands.getCommands(true)).includes('hurl.hurl'));
    console.log(`Hurl integration passed: VS Code ${vscode.version}, Node ${process.versions.node}; latest grammar tokens, untitled/custom schemes, edits, no runner.`);
  } finally {
    contentProvider.dispose();
  }
}
