import * as vscode from 'vscode';

import { tokenModifiers, tokenTypes } from './tokens';
import { WorkerHighlighter } from './worker-highlighter';
import { commentEdits, indentationEdits, TextEdit } from './editing';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const highlighter = await WorkerHighlighter.create(context.asAbsolutePath('tree-sitter-hurl.wasm'));
  const selector = { language: 'hurl' };
  let disposed = false;
  context.subscriptions.push(highlighter, { dispose() { disposed = true; } });

  async function request<T>(document: vscode.TextDocument, cancellation: vscode.CancellationToken | undefined,
    operation: (key: string, version: number, text: string, signal: AbortSignal) => Promise<T | undefined>): Promise<T | undefined> {
    if (disposed || document.isClosed || document.languageId !== 'hurl' || cancellation?.isCancellationRequested) { return undefined; }
    const version = document.version;
    const abort = new AbortController();
    const subscription = cancellation?.onCancellationRequested(() => abort.abort());
    try {
      if (cancellation?.isCancellationRequested) { abort.abort(); }
      const result = await operation(document.uri.toString(), version, document.getText(), abort.signal);
      return !disposed && !abort.signal.aborted && !document.isClosed && document.languageId === 'hurl' && document.version === version
        ? result : undefined;
    } catch (error) {
      console.warn('Hurl analysis failed:', error);
      return undefined;
    } finally { subscription?.dispose(); }
  }

  const analyze = (document: vscode.TextDocument, cancellation?: vscode.CancellationToken) =>
    request(document, cancellation, (key, version, text, signal) => highlighter.analyze(key, version, text, signal));
  const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);
  context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider(selector, {
    async provideDocumentSemanticTokens(document, cancellation) {
      const tokens = await request(document, cancellation, (key, version, text, signal) =>
        highlighter.tokenize(key, version, text, signal));
      if (!tokens) { return undefined; }
      const builder = new vscode.SemanticTokensBuilder(legend);
      for (const token of tokens) { builder.push(token.line, token.start, token.length, token.type, token.modifiers || 0); }
      return builder.build();
    },
  }, legend));

  context.subscriptions.push(vscode.languages.registerFoldingRangeProvider(selector, {
    async provideFoldingRanges(document, _context, cancellation) {
      const result = await analyze(document, cancellation);
      if (!result) { return undefined; }
      const text = document.getText();
      const byStart = new Map<number, vscode.FoldingRange>();
      const limit = 5000;
      for (const fold of result.folds) {
        if (cancellation.isCancellationRequested) { return undefined; }
        let endOffset = fold.end;
        while (endOffset > fold.start && /[\r\n]/.test(text[endOffset - 1])) { endOffset--; }
        const start = document.positionAt(fold.start).line;
        const end = document.positionAt(Math.max(fold.start, endOffset - 1)).line;
        if (end <= start) { continue; }
        const previous = byStart.get(start);
        if (!previous || previous.end < end) {
          byStart.set(start, new vscode.FoldingRange(start, end, fold.kind === 'comment' ? vscode.FoldingRangeKind.Comment : undefined));
        }
        if (byStart.size >= limit) { break; }
      }
      return [...byStart.values()].sort((left, right) => left.start - right.start);
    },
  }), vscode.languages.registerDocumentLinkProvider(selector, {
    async provideDocumentLinks(document, cancellation) {
      const result = await analyze(document, cancellation);
      return result?.links.map(link => new vscode.DocumentLink(
        new vscode.Range(document.positionAt(link.start), document.positionAt(link.end)), vscode.Uri.parse(link.target)));
    },
  }));

  const convert = (document: vscode.TextDocument, edits: TextEdit[]) => edits.map(edit =>
    vscode.TextEdit.replace(new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.text));
  context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(selector, {
    async provideDocumentFormattingEdits(document, options, cancellation) {
      const result = await analyze(document, cancellation);
      return result && convert(document, indentationEdits(document.getText(), result, options));
    },
  }), vscode.languages.registerDocumentRangeFormattingEditProvider(selector, {
    async provideDocumentRangeFormattingEdits(document, range, options, cancellation) {
      const result = await analyze(document, cancellation);
      return result && convert(document, indentationEdits(document.getText(), result, options,
        { start: document.offsetAt(range.start), end: document.offsetAt(range.end) }));
    },
  }), vscode.languages.registerOnTypeFormattingEditProvider(selector, {
    async provideOnTypeFormattingEdits(document, position, _character, options, cancellation) {
      const result = await analyze(document, cancellation);
      if (!result || position.line < 0 || position.line >= document.lineCount) { return undefined; }
      const range = document.lineAt(position.line).range;
      return convert(document, indentationEdits(document.getText(), result, options,
        { start: document.offsetAt(range.start), end: document.offsetAt(range.end) }));
    },
  }, '\n', '}', ']', '>'));

  context.subscriptions.push(vscode.commands.registerCommand('hurl.toggleComment', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'hurl') { return; }
    const document = editor.document;
    const version = document.version;
    const selections = [...editor.selections];
    const result = await analyze(document);
    if (!result || editor !== vscode.window.activeTextEditor || document.version !== version ||
      editor.selections.length !== selections.length || !selections.every((selection, index) => selection.isEqual(editor.selections[index]))) { return; }
    try {
      const edits = commentEdits(document.getText(), result, selections.map(selection =>
        ({ start: document.offsetAt(selection.start), end: document.offsetAt(selection.end) })), true);
      if (edits?.length) {
        await editor.edit(builder => {
          for (const edit of convert(document, edits)) { builder.replace(edit.range, edit.newText); }
        });
      }
    } catch (error) {
      await vscode.window.showWarningMessage(error instanceof Error ? error.message : 'This selection cannot safely be commented as XML.');
    }
  }));

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => highlighter.release(event.document.uri.toString())),
    vscode.workspace.onDidCloseTextDocument(document => highlighter.release(document.uri.toString())));
}
