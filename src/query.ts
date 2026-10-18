export const highlights = `
; highlights.scm

(_ section_header: _ @property)

(comment) @comment
(xml_comment) @comment

(key_string) @property
(json_key_string) @property

[
  (value_string)
  (quoted_string)
  (json_string)
  (multiline_string)
  (oneline_string)
  (filename)
  (filename_password)
  (xml_attribute_value)
  (xml_cdata)
  (xml_value_string)
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
  (filename_escaped_char)
  (filename_password_escaped_char)
  (json_string_escaped_char)
] @string.escape

(method) @type.builtin
(multiline_string_type) @type

(_ query_name: _ @function.builtin)

(_ filter_key: _ @function.builtin)
(function) @function.builtin

(version) @string.special
(duration_unit) @string.special
(certificate_attribute) @string.special

(_ option_key: _ @constant.builtin)
(verbosity_option level: _ @constant.builtin)
"null" @constant.builtin

(boolean) @boolean
(json_boolean) @boolean
"redact" @keyword

(variable_name) @variable

(_ predicate_name: _ @keyword.operator)
"not" @keyword.operator

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

; Native XML fallback; no injected-language runtime is needed.
(xml_open_tag (xml_name) @type)
(xml_close_tag (xml_name) @type)
(xml_self_closing_tag (xml_name) @type)
(xml_attribute (xml_name) @property)

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
