import * as vscode from 'vscode';

import { Highlighter, tokenTypes } from './highlighting';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const highlighter = await Highlighter.create(context.asAbsolutePath('tree-sitter-hurl.wasm'));
  context.subscriptions.push(highlighter);
  const legend = new vscode.SemanticTokensLegend(tokenTypes);
  context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider(
    { language: 'hurl' },
    {
      provideDocumentSemanticTokens(document, cancellation) {
        if (cancellation.isCancellationRequested) {
          return undefined;
        }
        const builder = new vscode.SemanticTokensBuilder(legend);
        for (const token of highlighter.tokenize(document.getText())) {
          builder.push(token.line, token.start, token.length, token.type, 0);
        }
        return builder.build();
      },
    },
    legend,
  ));
}
