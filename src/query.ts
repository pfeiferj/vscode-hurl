export const highlights = `
; highlights.scm

(_ section_header: _ @property)

(comment) @comment

(key_string) @property
(json_key_string) @property

[
  (value_string)
  (quoted_string)
  (json_string)
] @string


(file_value) @string.special
(regex) @string.regex

[
  "\\\\" @string.escape
  (regex_escaped_char)
  (quoted_string_escaped_char)
  (key_string_escaped_char)
  (value_string_escaped_char)
  (oneline_string_escaped_char)
  (multiline_string_escaped_char)
  (filename_escaped_char)
  (json_string_escaped_char)
] @string.escape

(method) @type.builtin
(multiline_string_type) @type

(_ query_name: _ @function.builtin)

(filter (_ filter_key: _ @attribute) )

(version) @string.special

(_ option_key: _ @constant.builtin)

(boolean) @boolean

(variable_name) @variable

(_ predicate_name: _ @keyword.operator)

[
  "=="
  "!="
  ">"
  ">="
  "<"
  "<="
] @operator

(integer) @number
(float) @float
(status) @number
(json_number) @float

":" @punctuation.delimiter
"," @punctuation.delimiter

"[" @punctuation.bracket
"]" @punctuation.bracket
"{" @punctuation.bracket
"}" @punctuation.bracket
"{{" @punctuation.special
"}}" @punctuation.special

"base64," @string.special
"file," @string.special
"hex," @string.special

`;
