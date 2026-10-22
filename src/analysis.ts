import type { Node } from 'web-tree-sitter';

export interface OffsetRange { start: number; end: number }
export interface FoldRange extends OffsetRange { kind?: 'comment' }
export interface IndentContainer extends OffsetRange { close: number; kind: 'json' | 'xml' }
export interface SyntaxIssue extends OffsetRange { message: string; code: 'syntax-error' | 'missing-token' }
export interface DocumentStructure {
  folds: FoldRange[];
  links: Array<OffsetRange & { target: string }>;
  xmlRegions: OffsetRange[];
  protectedRanges: OffsetRange[];
  containers: IndentContainer[];
  issues: SyntaxIssue[];
}

export function emptyStructure(): DocumentStructure {
  return { folds: [], links: [], xmlRegions: [], protectedRanges: [], containers: [], issues: [] };
}

const foldTypes = new Set([
  'comment', 'entry', 'request', 'response', 'header', 'request_section', 'response_section',
  'body', 'multipart_form_data_section', 'cookies_section', 'captures_section', 'asserts_section',
  'options_section', 'basic_auth_section', 'query_string_params_section', 'form_params_section',
  'json_object', 'json_array', 'xml_tag', 'element', 'Comment', 'multiline_string',
]);

/** The caller owns the tree and normalizes standalone CR before parsing (length preserving). */
export function analyzeTree(root: Node, text: string, shouldCancel: () => boolean = () => false): DocumentStructure {
  const result = emptyStructure();
  const seenFolds = new Set<string>();
  const cursor = root.walk();
  let visited = 0;
  try {
    for (;;) {
      if ((visited++ & 127) === 0 && shouldCancel()) { return emptyStructure(); }
      const node = cursor.currentNode;
      const { startIndex: start, endIndex: end, type } = node;
      if (foldTypes.has(type) && node.startPosition.row !== node.endPosition.row) {
        const key = `${start}:${end}`;
        if (!seenFolds.has(key)) {
          result.folds.push(type === 'comment' ? { start, end, kind: 'comment' } : { start, end });
          seenFolds.add(key);
        }
      }
      const xmlRegion = result.xmlRegions[result.xmlRegions.length - 1];
      if ((type === 'xml' && node.isNamed) || (type === 'xml_comment' && (!xmlRegion || xmlRegion.start > start || xmlRegion.end < end))) {
        result.xmlRegions.push({ start, end });
      }
      if (type === 'xml_tag' || type === 'element') {
        const open = node.firstNamedChild;
        const close = node.lastNamedChild;
        if ((open?.type === 'xml_open_tag' || open?.type === 'STag') &&
            (close?.type === 'xml_close_tag' || close?.type === 'ETag') &&
            !open.hasError && !close.hasError) {
          result.containers.push({ start: open.startIndex, end, close: close.startIndex, kind: 'xml' });
        }
      }
      if (type === 'multiline_string') {
        const first = node.firstNamedChild;
        const hint = first?.type === 'multiline_string_type' ? first : null;
        if (!hint || !['json', 'xml'].includes(text.slice(hint.startIndex, hint.endIndex))) {
          let bodyStart: number | undefined;
          for (let index = 0; index < node.childCount; index++) {
            const child = node.child(index)!;
            if (child.type === '\n') { bodyStart = child.endIndex; break; }
          }
          const last = node.lastChild;
          const bodyEnd = last?.type === '```' && !last.isMissing ? last.startIndex : end;
          if (bodyStart !== undefined && bodyStart < bodyEnd) {
            result.protectedRanges.push({ start: bodyStart, end: bodyEnd });
          }
        }
      }
      if (['xml_value_string', 'xml_cdata', 'xml_comment', 'xml_attribute_value',
        'CharData', 'CDSect', 'Comment', 'AttValue'].includes(type) ||
          (type === 'multiline_string_content' && node.parent?.type !== 'multiline_string') ||
          (['template', 'quoted_string', 'json_string', 'json_key_string'].includes(type) &&
            node.startPosition.row !== node.endPosition.row)) {
        result.protectedRanges.push({ start, end });
      }
      if (type === 'value_string' && node.parent?.type === 'request') {
        const raw = text.slice(start, end);
        const target = raw.trim();
        if (/^https?:\/\//i.test(target) && !/[\s\\\x00-\x1f\x7f{}]/u.test(target)) {
          try {
            const url = new URL(target);
            if (url.hostname && (url.protocol === 'http:' || url.protocol === 'https:')) {
              const linkStart = start + raw.indexOf(target);
              result.links.push({ start: linkStart, end: linkStart + target.length, target });
            }
          } catch { /* Invalid literal URL: never resolve or repair it. */ }
        }
      }
      if (type === 'json_object' || type === 'json_array') {
        const open = node.firstChild;
        const close = node.lastChild;
        if (open && close && !open.isMissing && !close.isMissing &&
            open.type === (type === 'json_object' ? '{' : '[') &&
            close.type === (type === 'json_object' ? '}' : ']')) {
          result.containers.push({ start: open.startIndex, end, close: close.startIndex, kind: 'json' });
        }
      }
      if (cursor.gotoFirstChild()) { continue; }
      for (;;) {
        if ((visited++ & 127) === 0 && shouldCancel()) { return emptyStructure(); }
        // Postorder selects the narrowest parser recovery node, not its cascading ancestors.
        const finished = cursor.currentNode;
        if ((finished.type === 'ERROR' || finished.isMissing) && result.issues.length < 100) {
          const issueStart = finished.startIndex;
          const issueEnd = finished.endIndex;
          if (!result.issues.some(issue => issue.start >= issueStart && issue.end <= issueEnd)) {
            result.issues.push({ start: issueStart, end: issueEnd,
              code: finished.isMissing ? 'missing-token' : 'syntax-error',
              message: finished.isMissing ? `Missing ${finished.type}` : 'Unexpected syntax',
            });
          }
        }
        if (cursor.gotoNextSibling()) { break; }
        if (!cursor.gotoParent()) { return shouldCancel() ? emptyStructure() : result; }
      }
    }
  } finally { cursor.delete(); }
}
