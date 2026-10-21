/** Query captures and their intentionally chosen semantic classifications. */
export const captureTypes: Readonly<Record<string, string>> = {
  'punctuation.delimiter': 'punctuationDelimiter',
  'punctuation.bracket': 'punctuationBracket',
  'punctuation.special': 'punctuationSpecial',
  property: 'property', comment: 'comment', string: 'string',
  'string.special': 'string', 'string.regex': 'regexp', 'string.escape': 'hurlEscape',
  type: 'type', 'type.builtin': 'hurlMethod', 'function.builtin': 'function',
  attribute: 'decorator', 'constant.builtin': 'enumMember', boolean: 'hurlBoolean',
  option: 'hurlOption', keyword: 'keyword', variable: 'variable',
  'variable.declaration': 'variable',
  'keyword.operator': 'operator', operator: 'operator', number: 'number', float: 'number',
};

export const tokenTypes = [...new Set(Object.values(captureTypes))];
export const tokenModifiers = ['declaration'];

/** Manifest-ready custom token definitions; keep distinct categories themeable. */
export const semanticTokenTypes: { id: string; superType?: string; description: string }[] = [
  { id: 'hurlMethod', superType: 'method', description: 'Hurl HTTP request method' },
  { id: 'hurlEscape', superType: 'string', description: 'Hurl string escape or XML entity reference' },
  { id: 'hurlBoolean', superType: 'keyword', description: 'Hurl or JSON boolean literal' },
  { id: 'hurlOption', superType: 'property', description: 'Hurl option name or verbosity level' },
  { id: 'punctuationBracket', description: 'Hurl, JSON or XML structural bracket' },
  { id: 'punctuationDelimiter', description: 'Hurl, JSON or XML punctuation separator' },
  { id: 'punctuationSpecial', description: 'Hurl variable interpolation delimiter' },
];

/** TextMate scopes are explicit: custom semantic supertypes do not inherit scope maps. */
export const semanticTokenScopes: { language: 'hurl'; scopes: Record<string, string[]> }[] = [{
  language: 'hurl',
  scopes: {
    hurlMethod: ['keyword.control.http-method.hurl'],
    hurlEscape: ['constant.character.escape.hurl'],
    hurlBoolean: ['constant.language.boolean.hurl'],
    hurlOption: ['support.constant.option.hurl'],
    punctuationBracket: ['punctuation.section.brackets.hurl'],
    punctuationDelimiter: ['punctuation.separator.hurl'],
    punctuationSpecial: ['punctuation.section.interpolation.hurl'],
    'variable.declaration': ['variable.other.readwrite.hurl'],
  },
}];
