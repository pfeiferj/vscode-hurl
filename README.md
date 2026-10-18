# Hurl

Tree-sitter-based syntax highlighting for [Hurl](https://hurl.dev) files in VS Code.
This is an unofficial extension; see the Hurl website for the project itself.

## Features

- Semantic syntax highlighting for `.hurl` files, including requests, assertions,
  strings, escapes, variables, comments, and multiline bodies.
- Hurl language configuration for comments, brackets, and automatic closing pairs.
- Highlighting for local files, untitled documents, and other document URI schemes.

The extension only provides highlighting and language configuration. It does not
register a Hurl command, execute requests, start processes, or open output webviews.
No Hurl executable or other external runtime is required: both the Tree-sitter
runtime and the existing Hurl grammar are included as WebAssembly assets.

## Requirements

VS Code **1.142.0 or newer**. Your theme must enable semantic highlighting; if
needed, set `editor.semanticHighlighting.enabled` to `true` in VS Code settings.

## Development

Use Node.js **24 LTS** and npm. Install the exact dependency graph with `npm ci`.

```sh
npm test                  # Compile, lint, and run real WASM/query regressions
npm run test:integration  # Download current stable VS Code; run extension-host tests
npm run verify:package    # Build hurl.vsix; verify and smoke-test the extracted assets
```

The package verifier requires `unzip` (available on macOS and most Linux systems).
It prints the extracted extension path for an additional extension-host check of
the actual packaged artifact:

```sh
HURL_EXTENSION_PATH="/absolute/path/printed/by/verifier/extension" npm run test:integration
```

Integration tests need a desktop session and network access for the initial VS
Code download. They check actual semantic tokens for untitled and custom-scheme
documents, edits, and the absence of the removed `hurl.hurl` command.

The runtime uses the current `web-tree-sitter` named `Parser`, `Language`, and
`Query` APIs, explicitly locating the packaged runtime WASM. The unchanged Hurl
parser has ABI 14, supported by runtime 0.27.1 (ABI 13–15); tests load the real
parser and compile the real highlighting query. Trees are deleted after every
request, and the parser, query, and provider are disposed with the extension.

ESLint uses Babel's TypeScript syntax parser because the current
`@typescript-eslint` release does not support the current stable TypeScript 7
peer dependency. TypeScript performs strict type checking and unused-code checks.

## Release notes

See [CHANGELOG.md](CHANGELOG.md).
