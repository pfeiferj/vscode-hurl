import type { DocumentStructure, OffsetRange } from './analysis';

export interface TextEdit { start: number; end: number; text: string }

interface Line { start: number; end: number; content: number }

/** UTF-16 offsets; CRLF is one line break, standalone CR is also a break. */
function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i !== text.length && text[i] !== '\r' && text[i] !== '\n') { continue; }
    let content = start;
    while (content < i && (text[content] === ' ' || text[content] === '\t')) { content++; }
    lines.push({ start, end: i, content });
    if (text[i] === '\r' && text[i + 1] === '\n') { i++; }
    start = i + 1;
  }
  return lines;
}

function selected(line: Line, range: OffsetRange): boolean {
  return range.start === range.end ? line.start <= range.start && range.start <= line.end :
    line.start < range.end && line.end >= range.start;
}

export function indentationEdits(text: string, structure: DocumentStructure,
  options: { tabSize: number; insertSpaces: boolean }, range?: OffsetRange): TextEdit[] {
  const lines = linesOf(text);
  const containers = [...structure.containers].sort((a, b) => a.start - b.start || b.end - a.end);
  const protectedRanges = [...structure.protectedRanges].sort((a, b) => a.start - b.start);
  const unit = options.insertSpaces ? ' '.repeat(Math.max(1, Math.floor(options.tabSize) || 1)) : '\t';
  const stack: Array<{ start: number; end: number; close: number; base: string }> = [];
  const edits: TextEdit[] = [];
  let next = 0;
  let protectedIndex = 0;
  let protectedEnd = -1;
  let openingLine = 0;
  for (const line of lines) {
    while (next < containers.length && containers[next].start < line.start) {
      const node = containers[next++];
      while (stack.length && stack[stack.length - 1].end <= node.start) { stack.pop(); }
      while (openingLine + 1 < lines.length && lines[openingLine + 1].start <= node.start) { openingLine++; }
      const opening = lines[openingLine];
      stack.push({ ...node, base: stack[0]?.base ?? text.slice(opening.start, opening.content) });
    }
    while (stack.length && stack[stack.length - 1].end <= line.start) { stack.pop(); }
    while (protectedIndex < protectedRanges.length && protectedRanges[protectedIndex].start < line.content) {
      const protectedRange = protectedRanges[protectedIndex++];
      // A token beginning at the first non-whitespace character may be indented;
      // continuation whitespace inside a payload must never be rewritten.
      if (protectedRange.start < line.start) { protectedEnd = Math.max(protectedEnd, protectedRange.end); }
      else if (protectedRange.end > line.end) { protectedEnd = Math.max(protectedEnd, protectedRange.end); }
    }
    if (!stack.length || (range && !selected(line, range)) || protectedEnd > line.content) { continue; }
    let depth = stack.length;
    while (depth > 0 && stack[depth - 1].close <= line.content) { depth--; }
    const indent = stack[0].base + unit.repeat(depth);
    if (indent !== text.slice(line.start, line.content)) {
      edits.push({ start: line.start, end: line.content, text: indent });
    }
  }
  return edits;
}

/**
 * Toggle whole selected lines, using XML comments only in AST XML regions.
 * undefined delegates an entirely non-XML selection unless includeHurl is true. [] is an
 * atomic conservative no-op for unsafe XML (partial tags, CDATA, multiline
 * payload/comment continuations, nested comments, or forbidden `--`).
 */
export function commentEdits(text: string, structure: DocumentStructure,
  selections: readonly OffsetRange[], includeHurl = false): TextEdit[] | undefined {
  const ranges = selections.map(range => ({ start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: OffsetRange[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) { previous.end = Math.max(previous.end, range.end); }
    else { merged.push({ ...range }); }
  }
  const xml = [...structure.xmlRegions].sort((a, b) => a.start - b.start);
  const protectedRanges = [...structure.protectedRanges].sort((a, b) => a.start - b.start);
  const chosen: Array<{ line: Line; xml: boolean; body: string; commented: boolean }> = [];
  let selectionIndex = 0;
  let xmlIndex = 0;
  let hasXml = false;
  let partialXmlLine = false;
  for (const line of linesOf(text)) {
    while (selectionIndex < merged.length && (merged[selectionIndex].end < line.start ||
      (merged[selectionIndex].end === line.start && merged[selectionIndex].start !== merged[selectionIndex].end))) { selectionIndex++; }
    if (selectionIndex === merged.length || !selected(line, merged[selectionIndex])) { continue; }
    while (xmlIndex < xml.length && xml[xmlIndex].end <= line.start) { xmlIndex++; }
    const region = xml[xmlIndex];
    const inXml = !!region && region.start <= line.end && region.end > line.start;
    hasXml ||= inXml;
    const body = text.slice(line.content, line.end);
    if (inXml && body.length > 0 && (region.start > line.content || region.end < line.content + body.trimEnd().length)) {
      partialXmlLine = true;
    }
    chosen.push({ line, xml: inXml, body, commented: inXml ?
      body.startsWith('<!--') && body.trimEnd().endsWith('-->') : body.startsWith('#') });
  }
  if (!hasXml && !includeHurl) { return undefined; }
  if (partialXmlLine) { return []; }
  const meaningful = chosen.filter(item => item.body.length > 0);
  const uncomment = meaningful.length > 0 && meaningful.every(item => item.commented);
  const edits: TextEdit[] = [];
  let protectedIndex = 0;
  let protectedEnd = -1;
  for (const item of meaningful) {
    const { line, body } = item;
    while (protectedIndex < protectedRanges.length && protectedRanges[protectedIndex].start < line.end) {
      const protectedRange = protectedRanges[protectedIndex++];
      // Reject continuations entering this line and tokens leaving it, including
      // attributes that begin on this line but contain a misleading `>`.
      if (protectedRange.start < line.start || protectedRange.end > line.end) {
        protectedEnd = Math.max(protectedEnd, protectedRange.end);
      }
    }
    if (item.xml) {
      const trimmed = body.trimEnd();
      const inner = item.commented ? trimmed.slice(4, -3) : body;
      if (protectedEnd > line.content || inner.includes('--') || inner.includes('<![CDATA[') || inner.includes(']]>') ||
          (!item.commented && (!trimmed.startsWith('<') || !trimmed.endsWith('>')))) { return []; }
      // A standalone XML comment can be unwrapped; any other comment delimiter
      // on a line would create nesting or consume only part of a comment.
      if (!item.commented && (body.includes('<!--') || body.includes('-->'))) { return []; }
      if (uncomment) {
        let value = inner;
        if (value.startsWith(' ') && value.endsWith(' ')) { value = value.slice(1, -1); }
        edits.push({ start: line.content, end: line.end, text: value + body.slice(trimmed.length) });
      } else if (!item.commented) {
        edits.push({ start: line.content, end: line.end, text: `<!-- ${body} -->` });
      }
    } else if (uncomment) {
      edits.push({ start: line.content, end: line.content + (body.startsWith('# ') ? 2 : 1), text: '' });
    } else if (!item.commented) {
      edits.push({ start: line.content, end: line.content, text: '# ' });
    }
  }
  return edits;
}
