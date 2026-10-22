import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

async function apply(document: vscode.TextDocument, edits: vscode.TextEdit[]): Promise<void> {
  const change = new vscode.WorkspaceEdit();
  change.set(document.uri, edits);
  assert.ok(await vscode.workspace.applyEdit(change));
}

export async function checkEditorFeatures(): Promise<void> {
  const source = 'POST https://example.org/path\n{\n"items": [\n1,\n2\n]\n}\nHTTP 200\n';
  const document = await vscode.workspace.openTextDocument({ language: 'hurl', content: source });
  await vscode.window.showTextDocument(document);
  const folds = await vscode.commands.executeCommand<vscode.FoldingRange[]>('vscode.executeFoldingRangeProvider', document.uri);
  assert.ok(folds && folds.some(fold => fold.start === 1 && fold.end >= 5), 'JSON body must have a structural fold');
  const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', document.uri);
  assert.ok(links?.some(link => link.target?.toString() === 'https://example.org/path'));
  const options = { tabSize: 2, insertSpaces: true };
  const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider', document.uri, options);
  assert.ok(edits && edits.length > 0, 'document formatting must indent JSON');
  await apply(document, edits);
  assert.equal(document.getText(), 'POST https://example.org/path\n{\n  "items": [\n    1,\n    2\n  ]\n}\nHTTP 200\n');

  const selection = await vscode.workspace.openTextDocument({ language: 'hurl', content: source });
  const rangeEdits = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatRangeProvider', selection.uri,
    new vscode.Range(2, 0, 3, 0), options);
  assert.ok(rangeEdits?.length);
  await apply(selection, rangeEdits);
  assert.equal(selection.lineAt(2).text, '  "items": [');
  assert.equal(selection.lineAt(3).text, '1,', 'selection formatting must not change excluded lines');
  const typing = await vscode.workspace.openTextDocument({ language: 'hurl', content: 'POST https://example.org\n{\n\n}\n' });
  const typingEdits = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatOnTypeProvider', typing.uri,
    new vscode.Position(2, 0), '\n', options);
  assert.ok(typingEdits?.length, 'on-type indentation must handle a new blank JSON line');
  await apply(typing, typingEdits);
  assert.equal(typing.lineAt(2).text, '  ');
  for (const [hint, body, expected] of [
    ['json', '{\n"x": 1\n}', '{\n  "x": 1\n}'],
    ['xml', '<root>\n        <child/>\n</root>', '<root>\n  <child/>\n</root>'],
  ]) {
    const document = await vscode.workspace.openTextDocument({ language: 'hurl', content:
      `POST https://example.org\n\`\`\`${hint}\n${body}\n\`\`\`\n` });
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider', document.uri, options);
    assert.ok(edits?.length, `${hint} fence must support structural indentation`);
    await apply(document, edits);
    assert.ok(document.getText().includes(expected), hint);
  }

  const raw = await vscode.workspace.openTextDocument({ language: 'hurl', content:
    'POST https://example.org\n```raw\n    literal\n  {not JSON}\n```\n' });
  const untouched = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider', raw.uri, options);
  assert.deepEqual(untouched ?? [], [], 'raw payload whitespace must remain unchanged');

  const xml = await vscode.workspace.openTextDocument({ language: 'hurl', content:
    'POST https://example.org\n<root>\n  <child/>\n</root>\n' });
  const editor = await vscode.window.showTextDocument(xml);
  editor.selection = new vscode.Selection(2, 0, 2, xml.lineAt(2).text.length);
  await vscode.commands.executeCommand('hurl.toggleComment');
  assert.equal(xml.lineAt(2).text, '  <!-- <child/> -->');
  await vscode.commands.executeCommand('hurl.toggleComment');
  assert.equal(xml.lineAt(2).text, '  <child/>');
  editor.selection = new vscode.Selection(0, 0, 0, 0);
  await vscode.commands.executeCommand('hurl.toggleComment');
  assert.ok(xml.lineAt(0).text.startsWith('#'), 'ordinary Hurl lines use normal line commenting');

  const rootSource = 'POST https://example.org\n<root/>\n';
  const root = await vscode.workspace.openTextDocument({ language: 'hurl', content: rootSource });
  const rootEditor = await vscode.window.showTextDocument(root);
  rootEditor.selection = new vscode.Selection(1, 0, 1, 0);
  await vscode.commands.executeCommand('hurl.toggleComment');
  assert.equal(root.lineAt(1).text, '<!-- <root/> -->');
  await vscode.commands.executeCommand('hurl.toggleComment');
  assert.equal(root.getText(), rootSource, 'commenting the entire XML root must still roundtrip');

  const unchecked: vscode.TextDocument[] = [];
  for (const content of ['POST https://example.org\n{"broken": }\n',
    'POST https://example.org\n[\n1, 2\n]\n', 'POST https://example.org\n```json\n{"broken": }\n```\n']) {
    const document = await vscode.workspace.openTextDocument({ language: 'hurl', content });
    unchecked.push(document);
    await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens', document.uri);
  }
  await new Promise(resolve => setTimeout(resolve, 350));
  for (const document of unchecked) {
    assert.deepEqual(vscode.languages.getDiagnostics(document.uri).filter(item => item.source === 'Hurl syntax'), [],
      'syntax squiggles are deferred, including for known grammar false positives');
  }
  console.log('Hurl editor features passed: AST folding, request links, safe indentation, XML/Hurl comments; syntax squiggles deferred.');
}
