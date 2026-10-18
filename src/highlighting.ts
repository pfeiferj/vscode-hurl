import { Language, Parser, Query } from 'web-tree-sitter';

import { highlights } from './query';

// Only standard VS Code semantic token types; the legend must be unique.
const captureTypes: Readonly<Record<string, string>> = {
  property: 'property',
  comment: 'comment',
  string: 'string',
  'string.special': 'string',
  'string.regex': 'regexp',
  'string.escape': 'operator',
  type: 'type',
  'type.builtin': 'type',
  'function.builtin': 'function',
  attribute: 'decorator',
  'constant.builtin': 'enumMember',
  boolean: 'keyword',
  keyword: 'keyword',
  variable: 'variable',
  'keyword.operator': 'operator',
  operator: 'operator',
  number: 'number',
  float: 'number',
};

export const tokenTypes = [...new Set(Object.values(captureTypes))];

export interface HighlightToken {
  line: number;
  start: number;
  length: number;
  type: number;
}

interface Span {
  start: number;
  end: number;
  type: number;
  order: number;
}

/** Owns the WASM parser/query; each parsed tree is freed before returning. */
export class Highlighter {
  private disposed = false;

  private constructor(private readonly parser: Parser, private readonly query: Query) {}

  static async create(grammarPath: string): Promise<Highlighter> {
    await Parser.init({
      locateFile: () => require.resolve('web-tree-sitter/web-tree-sitter.wasm'),
    });
    const language = await Language.load(grammarPath);
    const parser = new Parser();
    try {
      parser.setLanguage(language);
      return new Highlighter(parser, new Query(language, highlights));
    } catch (error) {
      parser.delete();
      throw error;
    }
  }

  tokenize(text: string): HighlightToken[] {
    if (this.disposed) {
      throw new Error('Highlighter has been disposed');
    }
    // VS Code treats standalone CR as a line ending; keep UTF-16 offsets unchanged.
    const tree = this.parser.parse(text.replace(/\r(?!\n)/g, '\n'));
    if (!tree) {
      return [];
    }
    try {
      const spans: Span[] = [];
      for (const [order, capture] of this.query.captures(tree.rootNode).entries()) {
        const type = tokenTypes.indexOf(captureTypes[capture.name]);
        if (type >= 0 && capture.node.endIndex > capture.node.startIndex) {
          spans.push({ start: capture.node.startIndex, end: capture.node.endIndex, type, order });
        }
      }
      return splitLines(text, normalize(spans));
    } finally {
      tree.delete();
    }
  }

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.query.delete();
      this.parser.delete();
    }
  }
}

/** Prefer specific (narrower) captures, with later query captures breaking ties. */
function normalize(spans: Span[]): Span[] {
  const events = new Map<number, { add: Span[]; remove: Span[] }>();
  for (const span of spans) {
    for (const offset of [span.start, span.end]) {
      if (!events.has(offset)) {
        events.set(offset, { add: [], remove: [] });
      }
    }
    events.get(span.start)!.add.push(span);
    events.get(span.end)!.remove.push(span);
  }
  const offsets = [...events.keys()].sort((a, b) => a - b);
  const active = new Set<Span>();
  const result: Span[] = [];
  for (let index = 0; index < offsets.length - 1; index++) {
    const start = offsets[index];
    const end = offsets[index + 1];
    const event = events.get(start)!;
    for (const span of event.remove) {
      active.delete(span);
    }
    for (const span of event.add) {
      active.add(span);
    }
    let winner: Span | undefined;
    for (const span of active) {
      if (!winner || span.end - span.start < winner.end - winner.start ||
          (span.end - span.start === winner.end - winner.start && span.order > winner.order)) {
        winner = span;
      }
    }
    if (winner) {
      const previous = result.at(-1);
      if (previous?.end === start && previous.type === winner.type) {
        previous.end = end;
      } else {
        result.push({ ...winner, start, end });
      }
    }
  }
  return result;
}

/** Web Tree-sitter string input uses UTF-16 offsets, as does VS Code. */
function splitLines(text: string, spans: Span[]): HighlightToken[] {
  const lines = [{ start: 0, end: text.length }];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\n' || text[index] === '\r') {
      lines[lines.length - 1].end = index;
      if (text[index] === '\r' && text[index + 1] === '\n') {
        index++;
      }
      lines.push({ start: index + 1, end: text.length });
    }
  }
  const tokens: HighlightToken[] = [];
  let line = 0;
  for (const span of spans) {
    while (line + 1 < lines.length && lines[line + 1].start <= span.start) {
      line++;
    }
    for (let row = line; row < lines.length && lines[row].start < span.end; row++) {
      const start = Math.max(span.start, lines[row].start);
      const end = Math.min(span.end, lines[row].end);
      if (end > start) {
        tokens.push({ line: row, start: start - lines[row].start, length: end - start, type: span.type });
      }
    }
  }
  return tokens;
}
