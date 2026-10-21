# Change Log

All notable changes to the "hurl" extension will be documented in this file.

## [Unreleased]

- Preserve punctuation and interpolation captures; add Hurl-specific semantic
  types and TextMate fallback scopes for methods, escapes, booleans, and options.
- Complete native XML declaration/DTD and encoded-body highlighting; classify
  capture names as variable declarations.
- Highlight JSON, XML, and GraphQL fences while preserving Hurl templates and
  leaving raw/unknown fences literal.
- Reuse the bundled Hurl JSON grammar and native query in tagged JSON blocks,
  parsing templates intact and removing the separate JSON grammar dependency.
- Move parsing/query work into a worker thread, cache unchanged documents, and
  discard cancelled or superseded requests.
- Enable semantic highlighting by default for Hurl, preserving explicit user
  overrides, and test actual visible-editor requests under a disabled theme.

- Update the bundled Hurl grammar to upstream main at `3343774` (ABI 15), with
  pinned build provenance and modern Hurl/JSON/XML highlighting regressions.

- Remove the Hurl command runner, output webview, and execution-only dependencies;
  retain syntax highlighting and the existing language configuration.
- Update direct dependencies and tooling to current stable releases; require VS
  Code 1.142.0 or newer.
- Await Tree-sitter initialization before registering the semantic token provider,
  support all Hurl document schemes, and dispose WASM resources correctly.
- Emit a unique semantic token legend and non-overlapping UTF-16 ranges,
  including CRLF, nested escapes, variables, and multiline strings.
- Add real WASM/query regressions, extension-host tests, a reproducible lockfile,
  and verification of the runtime and grammar assets in the packaged VSIX.

## [1.4.2]
* Latest tree-sitter-hurl with missing options

## [1.4.1]
* Latest tree-sitter-hurl with missing predicates

## [1.4.0]
* Latest tree-sitter-hurl with missing predicates, shorter section syntax, and HTTP/3 asserts (Huge thanks to @kpbaks!)
* Adds missing predicates to vscode queries (Thanks @Fenex!)

## [1.3.4]
* Latest tree-sitter-hurl with fixes for comments without a new line character

## [1.3.3]
* Latest tree-sitter-hurl with fixes comments with no characters (Thanks @pravic!)

## [1.3.2]
* Latest tree-sitter-hurl with fixes for multiline strings and comments at beginning of file

## [1.3.1]

* Add support for comments and brackets (Thanks @smithamax!)
* Show stderr in case of error exit code (Thanks @carlo-colombo!)

## [1.3.0]

Handle hurl v4 custom http methods and missing and new filters.
* Fixes comment highlighting

## [1.2.2]

Fix failure from api changes. (Thanks @cailloumajor for alerting me!)

## [1.2.1]

Handle additional options: (Thanks @elbart!)
  * compressed
  * path\_as\_is
  * proxy

## [1.2.0]

Handle hurl v3 http version syntax ("HTTP" instead of "HTTP/*")

## [1.1.2]

New line handling fixes.

## [1.1.1]

Add support for all front page examples on hurl.dev.

## [1.1.0]

Colorize output of hurl in vscode panel.

## [1.0.1]

Update to tree-sitter-hurl to correct parsing issue with the http version token

## [1.0.0]

- Initial release
