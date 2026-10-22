import * as assert from 'node:assert/strict';
import Module = require('node:module');
import { test } from 'node:test';
import type * as vscode from 'vscode';
import { emptyStructure } from '../analysis';
import type { DocumentAnalysis } from '../highlighting';
import { WorkerHighlighter } from '../worker-highlighter';

test('on-type formatting discards stale analysis before reading a removed line', async t => {
  const disposable = { dispose() {} };
  let provider: vscode.OnTypeFormattingEditProvider | undefined;
  let resolveAnalysis!: (result: DocumentAnalysis | undefined) => void;
  let requestedVersion: number | undefined;
  const highlighter = {
    ...disposable,
    analyze(_key: string, version: number) {
      requestedVersion = version;
      return new Promise<DocumentAnalysis | undefined>(resolve => { resolveAnalysis = resolve; });
    },
  };
  t.mock.method(WorkerHighlighter, 'create', async () => highlighter as unknown as WorkerHighlighter);
  const languages = Object.fromEntries([
    'registerDocumentSemanticTokensProvider', 'registerFoldingRangeProvider', 'registerDocumentLinkProvider',
    'registerDocumentFormattingEditProvider', 'registerDocumentRangeFormattingEditProvider',
  ].map(name => [name, () => disposable]));
  const api = {
    languages: {
      ...languages,
      createDiagnosticCollection: () => disposable,
      registerOnTypeFormattingEditProvider(_selector: unknown, value: vscode.OnTypeFormattingEditProvider) {
        provider = value;
        return disposable;
      },
    },
    SemanticTokensLegend: class {},
    commands: { registerCommand: () => disposable },
    workspace: {
      textDocuments: [],
      onDidOpenTextDocument: () => disposable,
      onDidChangeTextDocument: () => disposable,
      onDidCloseTextDocument: () => disposable,
      onDidChangeConfiguration: () => disposable,
    },
  };
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  t.mock.method(loader, '_load', function (id: string, ...args: unknown[]) {
    return id === 'vscode' ? api : originalLoad.call(Module, id, ...args);
  });
  const { activate } = require('../extension') as typeof import('../extension');
  const subscriptions: vscode.Disposable[] = [];
  await activate({ subscriptions, asAbsolutePath: (value: string) => value } as vscode.ExtensionContext);
  assert.ok(provider, 'activation must register the actual on-type provider');
  const cancellation = { isCancellationRequested: false, onCancellationRequested: () => disposable } as vscode.CancellationToken;
  let lineReads = 0;
  let text = 'POST https://x\n<root>\n</root>';
  const document = {
    version: 1, isClosed: false, languageId: 'hurl',
    uri: { toString: () => 'file:///lifecycle.hurl' },
    getText: () => text,
    get lineCount() { return text.split('\n').length; },
    lineAt(line: number) {
      lineReads++;
      if (line >= this.lineCount) { throw new Error('Illegal line'); }
      return { range: { start: { line, character: 0 }, end: { line, character: 0 } } };
    },
    offsetAt: () => 0,
  };
  const run = () => provider!.provideOnTypeFormattingEdits(document as unknown as vscode.TextDocument,
    { line: 2, character: 0 } as vscode.Position, '\n', { tabSize: 2, insertSpaces: true }, cancellation);
  const result: DocumentAnalysis = { ...emptyStructure(), tokens: [] };
  try {
    const pending = run();
    assert.equal(requestedVersion, 1, 'analysis must start before the document changes');
    text = 'POST https://x';
    document.version++;
    resolveAnalysis(result);
    assert.equal(await pending, undefined);
    assert.equal(lineReads, 0, 'stale requests must not access the removed line');

    // A closed document must also return before touching its lines.
    text = 'POST https://x\n<root>\n</root>';
    const closing = run();
    document.isClosed = true;
    resolveAnalysis(result);
    assert.equal(await closing, undefined);
    assert.equal(lineReads, 0);

    // An unchanged document still reaches formatting normally.
    document.isClosed = false;
    const current = run();
    resolveAnalysis(result);
    assert.deepEqual(await current, []);
    assert.equal(lineReads, 1);
  } finally {
    for (const subscription of subscriptions.reverse()) { subscription.dispose(); }
  }
});
