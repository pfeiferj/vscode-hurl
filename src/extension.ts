import * as vscode from 'vscode';

import { tokenModifiers, tokenTypes } from './tokens';
import { WorkerHighlighter } from './worker-highlighter';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const highlighter = await WorkerHighlighter.create(context.asAbsolutePath('tree-sitter-hurl.wasm'));
  context.subscriptions.push(highlighter,
    vscode.workspace.onDidCloseTextDocument(document => highlighter.release(document.uri.toString())),
    vscode.workspace.onDidChangeTextDocument(event => highlighter.release(event.document.uri.toString())));
  const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);
  context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider(
    { language: 'hurl' },
    {
      async provideDocumentSemanticTokens(document, cancellation) {
        if (cancellation.isCancellationRequested) {
          return undefined;
        }
        const version = document.version;
        const abort = new AbortController();
        const subscription = cancellation.onCancellationRequested(() => abort.abort());
        try {
          if (cancellation.isCancellationRequested) {
            abort.abort();
          }
          const tokens = await highlighter.tokenize(document.uri.toString(), version, document.getText(), abort.signal);
          if (!tokens || cancellation.isCancellationRequested || document.isClosed || document.version !== version) {
            return undefined;
          }
          const builder = new vscode.SemanticTokensBuilder(legend);
          for (const token of tokens) {
            builder.push(token.line, token.start, token.length, token.type, token.modifiers || 0);
          }
          return builder.build();
        } finally {
          subscription.dispose();
        }
      },
    },
    legend,
  ));
}
