import { readFileSync } from 'node:fs';
import { Language, Node, Parser, Query } from 'web-tree-sitter';

export interface EmbeddedSpan {
  start: number;
  end: number;
  capture: string;
}

interface Grammar {
  parser: Parser;
  query: Query;
}

/** Reusable parsers; all returned offsets are absolute UTF-16 document offsets. */
export class EmbeddedHighlighter {
  private constructor(private readonly grammars: Map<string, Grammar>) {}

  static async create(): Promise<EmbeddedHighlighter> {
    await Parser.init({ locateFile: () => require.resolve('web-tree-sitter/web-tree-sitter.wasm') });
    const grammars = new Map<string, Grammar>();
    const highlighter = new EmbeddedHighlighter(grammars);
    try {
      for (const name of ['json', 'xml', 'graphql']) {
        const language = await Language.load(require.resolve(`@lumis-sh/wasm-${name}/tree-sitter-${name}.wasm`));
        const parser = new Parser();
        try {
          parser.setLanguage(language);
          const metadata = JSON.parse(readFileSync(require.resolve(`@lumis-sh/wasm-${name}/lumis.json`), 'utf8'));
          const query = new Query(language, (name === 'json' ? '(string) @string\n' : '') +
            metadata.languages[name].highlights);
          grammars.set(name, { parser, query });
        } catch (error) {
          parser.delete();
          throw error;
        }
      }
      return highlighter;
    } catch (error) {
      highlighter.dispose();
      throw error;
    }
  }

  spans(text: string, fenceNode: Node, shouldCancel: () => boolean = () => false): EmbeddedSpan[] {
    if (this.grammars.size === 0) { throw new Error('EmbeddedHighlighter has been disposed'); }
    if (shouldCancel()) { return []; }
    const hint = fenceNode.namedChildren.find(node => node.type === 'multiline_string_type')?.text;
    const grammar = hint && this.grammars.get(hint);
    if (!grammar) { return []; }
    const newline = fenceNode.children.find(node => node.type === '\n');
    if (!newline) { return []; }
    const start = newline.endIndex;
    const end = fenceNode.children.find(node => node.type === '```' && node.startIndex >= start)?.startIndex
      ?? fenceNode.endIndex;
    const templates = fenceNode.descendantsOfType('template')
      .map(node => ({ start: node.startIndex, end: node.endIndex }));
    let source = '';
    let cursor = start;
    for (const template of templates) {
      if (shouldCancel()) { return []; }
      source += text.slice(cursor, template.start);
      // No /u flag: replace each UTF-16 code unit, including both halves of emoji.
      const masked = text.slice(template.start, template.end).replace(/[^\r\n]/g, ' ');
      source += (hint === 'json' ? '0' : 'x') + masked.slice(1);
      cursor = template.end;
    }
    source += text.slice(cursor, end);
    const tree = grammar.parser.parse(source, null, { progressCallback: shouldCancel });
    if (!tree) {
      grammar.parser.reset();
      return [];
    }
    try {
      const aliases: Readonly<Record<string, string>> = {
        'constant.builtin': hint === 'xml' ? 'string.escape' : 'keyword',
        'keyword.directive': 'keyword', 'keyword.directive.define': 'keyword', 'keyword.modifier': 'keyword',
        tag: 'type', 'tag.attribute': 'property', 'tag.delimiter': 'punctuation.bracket',
        'string.special': 'string', 'string.special.url': 'string', constant: 'string.escape',
        character: 'string.escape', 'character.special': 'operator', 'type.builtin': 'type',
        'type.definition': 'type', attribute: 'keyword', label: 'type', 'function.macro': 'function.builtin',
        module: 'punctuation.special', 'markup.raw': 'string',
        'variable.parameter': 'variable', 'number.float': 'float', 'keyword.type': 'keyword',
        'string.documentation': 'string',
      };
      const captures = grammar.query.captures(tree.rootNode, { progressCallback: shouldCancel });
      const result: EmbeddedSpan[] = [];
      for (const capture of captures) {
        if (shouldCancel()) { return []; }
        if (capture.name === 'conceal' || capture.name === 'none') { continue; }
        let cursor = start + capture.node.startIndex;
        const end = start + capture.node.endIndex;
        const name = aliases[capture.name] ?? capture.name;
        // Only inspect overlapping templates, not every template for every capture.
        let low = 0;
        let high = templates.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (templates[middle].end <= cursor) { low = middle + 1; } else { high = middle; }
        }
        for (let index = low; index < templates.length; index++) {
          if (shouldCancel()) { return []; }
          const template = templates[index];
          if (template.start >= end) { break; }
          if (template.start > cursor) { result.push({ start: cursor, end: template.start, capture: name }); }
          cursor = Math.max(cursor, template.end);
        }
        if (cursor < end) { result.push({ start: cursor, end, capture: name }); }
      }
      return shouldCancel() ? [] : result;
    } finally { tree.delete(); }
  }

  dispose(): void {
    for (const { parser, query } of this.grammars.values()) {
      query.delete();
      parser.delete();
    }
    this.grammars.clear();
  }
}
