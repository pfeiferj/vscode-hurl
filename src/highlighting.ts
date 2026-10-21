import { Language, Parser, Query } from 'web-tree-sitter';

import { highlights } from './query';
import { EmbeddedHighlighter } from './embedded';

import { captureTypes, tokenModifiers, tokenTypes } from './tokens';
export { tokenTypes } from './tokens';

export interface HighlightToken {
  line: number;
  start: number;
  length: number;
  type: number;
  /** Semantic modifier bitset; omitted means zero. */
  modifiers?: number;
}

/** Absolute UTF-16 offsets; shared by native and embedded-language captures. */
export interface CaptureSpan {
  start: number;
  end: number;
  capture: string;
}

interface Span {
  start: number;
  end: number;
  type: number;
  order: number;
  modifiers: number;
}

/** Owns the WASM parser/query; each parsed tree is freed before returning. */
export class Highlighter {
  private disposed = false;

  private constructor(private readonly parser: Parser, private readonly query: Query,
    private readonly embedded: EmbeddedHighlighter) {}

  static async create(grammarPath: string): Promise<Highlighter> {
    await Parser.init({
      locateFile: () => require.resolve('web-tree-sitter/web-tree-sitter.wasm'),
    });
    const language = await Language.load(grammarPath);
    const parser = new Parser();
    let query: Query | undefined;
    try {
      parser.setLanguage(language);
      query = new Query(language, highlights);
      return new Highlighter(parser, query, await EmbeddedHighlighter.create());
    } catch (error) {
      query?.delete();
      parser.delete();
      throw error;
    }
  }

  tokenize(text: string, additionalSpans: readonly CaptureSpan[] = [], shouldCancel: () => boolean = () => false): HighlightToken[] {
    if (this.disposed) {
      throw new Error('Highlighter has been disposed');
    }
    // VS Code treats standalone CR as a line ending; keep UTF-16 offsets unchanged.
    if (shouldCancel()) {
      return [];
    }
    const source = text.replace(/\r(?!\n)/g, '\n');
    const tree = this.parser.parse(source, null, { progressCallback: shouldCancel });
    if (!tree) {
      // A cancelled parse otherwise resumes on the next (possibly unrelated) input.
      this.parser.reset();
      return [];
    }
    try {
      // Embedded providers can append absolute spans without owning normalization or line splitting.
      const captures: CaptureSpan[] = [];
      const matches = this.query.captures(tree.rootNode, { progressCallback: shouldCancel });
      if (shouldCancel()) {
        return [];
      }
      for (const { name, node } of matches) {
        if (shouldCancel()) {
          return [];
        }
        captures.push({ start: node.startIndex, end: node.endIndex, capture: name });
        // The native Hurl grammar exposes XML values as opaque leaves, not entity nodes.
        if (['xml_attribute_value', 'xml_value_string', 'xml_dtd_string', 'xml_dtd_declaration'].includes(node.type)) {
          for (const entity of node.text.matchAll(/&(?:#x[0-9a-fA-F]+|#[0-9]+|[\p{L}_:][\p{L}\p{N}_.:\-\u00b7\p{M}]*);/gu)) {
            const start = node.startIndex + entity.index;
            captures.push({ start, end: start + entity[0].length, capture: 'string.escape' });
          }
        }
      }
      for (const fence of tree.rootNode.descendantsOfType('multiline_string')) {
        if (shouldCancel()) { return []; }
        for (const span of this.embedded.spans(source, fence, shouldCancel)) {
          captures.push(span);
        }
      }
      for (const span of additionalSpans) {
        captures.push(span);
      }
      const spans: Span[] = [];
      for (const [order, capture] of captures.entries()) {
        if ((order & 1023) === 0 && shouldCancel()) {
          return [];
        }
        if (!Object.hasOwn(captureTypes, capture.capture)) {
          throw new Error(`Unknown highlight capture: ${capture.capture}`);
        }
        const type = tokenTypes.indexOf(captureTypes[capture.capture]);
        if (type >= 0 && capture.end > capture.start) {
          const modifiers = capture.capture === 'variable.declaration' ? 1 << tokenModifiers.indexOf('declaration') : 0;
          spans.push({ start: capture.start, end: capture.end, type, modifiers, order });
        }
      }
      const normalized = normalize(spans, shouldCancel);
      return shouldCancel() ? [] : splitLines(text, normalized, shouldCancel);
    } finally {
      tree.delete();
    }
  }

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.embedded.dispose();
      this.query.delete();
      this.parser.delete();
    }
  }
}

/** Prefer specific (narrower) captures, with later query captures breaking ties. */
function normalize(spans: Span[], shouldCancel: () => boolean): Span[] {
  const events = new Map<number, { add: Span[]; remove: Span[] }>();
  for (const span of spans) {
    if (shouldCancel()) {
      return [];
    }
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
    if ((index & 1023) === 0 && shouldCancel()) {
      return [];
    }
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
      if (previous?.end === start && previous.type === winner.type && previous.modifiers === winner.modifiers) {
        previous.end = end;
      } else {
        result.push({ ...winner, start, end });
      }
    }
  }
  return result;
}

/** Web Tree-sitter string input uses UTF-16 offsets, as does VS Code. */
function splitLines(text: string, spans: Span[], shouldCancel: () => boolean): HighlightToken[] {
  const lines = [{ start: 0, end: text.length }];
  for (let index = 0; index < text.length; index++) {
    if ((index & 4095) === 0 && shouldCancel()) {
      return [];
    }
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
    if (shouldCancel()) {
      return [];
    }
    while (line + 1 < lines.length && lines[line + 1].start <= span.start) {
      line++;
    }
    for (let row = line; row < lines.length && lines[row].start < span.end; row++) {
      const start = Math.max(span.start, lines[row].start);
      const end = Math.min(span.end, lines[row].end);
      if (end > start) {
        tokens.push({ line: row, start: start - lines[row].start, length: end - start, type: span.type,
          ...(span.modifiers ? { modifiers: span.modifiers } : {}) });
      }
    }
  }
  return tokens;
}
