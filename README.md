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
runtime and the Hurl grammar are included as WebAssembly assets.

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
Code download. They check actual modern Hurl semantic tokens for untitled and custom-scheme
documents, edits, and the absence of the removed `hurl.hurl` command. Custom URI
coverage is not a test of a genuine remote extension host.

The runtime uses the current `web-tree-sitter` named `Parser`, `Language`, and
`Query` APIs, explicitly locating the packaged runtime WASM. The bundled Hurl
parser has ABI 15, supported by runtime 0.27.1 (ABI 13–15); tests verify its digest,
load the real parser, and compile the real highlighting query. Trees are deleted after every
request, and the parser, query, and provider are disposed with the extension.
Standalone CR is normalized to LF for parsing without changing UTF-16 offsets;
token ranges still use the original document and exclude all line terminators.

ESLint uses Babel's TypeScript syntax parser because the current
`@typescript-eslint` release does not support the current stable TypeScript 7
peer dependency. TypeScript performs strict type checking and unused-code checks.

## Bundled grammar and updates

The grammar is built from the upstream default branch **main**, pinned at
[`3343774c9dff87570dd5d5b90d5e92405678d1d5`](https://github.com/pfeiferj/tree-sitter-hurl/commit/3343774c9dff87570dd5d5b90d5e92405678d1d5).
[tree-sitter-hurl.json](tree-sitter-hurl.json) records the source, ABI, build
versions, and bundled asset SHA-256. The source is Apache-2.0 licensed, like this
extension. No upstream checkout or build tool is needed by extension users.

Rebuild the pinned asset from an isolated checkout using upstream's locked
Tree-sitter CLI **0.27.1**. It automatically downloads WASI SDK **34.0** (Clang
**23.1.0**) and Binaryen **132** into the user cache; Emscripten and Docker are
not required. The following was verified on macOS arm64 with Node **24.22.0**
and npm **11.19.1**:

```sh
extension_dir="$PWD"  # Run from this extension's root
source_dir=$(mktemp -d)
git clone https://github.com/pfeiferj/tree-sitter-hurl.git "$source_dir"
git -C "$source_dir" checkout --detach 3343774c9dff87570dd5d5b90d5e92405678d1d5
cd "$source_dir"
npm ci --ignore-scripts
npm rebuild tree-sitter-cli
./node_modules/.bin/tree-sitter build --wasm --verbose --output tree-sitter-hurl.wasm
shasum -a 256 tree-sitter-hurl.wasm
# Expected: 5c92d8449e95f024470de90ff116174dc977661d55ee584e10fb6a00960c8048
cp tree-sitter-hurl.wasm "$extension_dir/tree-sitter-hurl.wasm"
cd "$extension_dir"
```

The build compiles upstream's committed `src/parser.c` **and** `src/scanner.c`;
no parser regeneration or custom build framework is needed. The CLI prints the
compiler/optimizer commands with `--verbose`. Repeated builds produced the same
digest with these versions.

For an update, resolve the live default-branch HEAD first (do not substitute an
unmerged development branch or a stale local checkout):

```sh
git ls-remote --symref https://github.com/pfeiferj/tree-sitter-hurl.git HEAD
```

Use that exact commit in the isolated checkout, inspect upstream's locked CLI
version, and update the asset and provenance together. Adapt `src/query.ts` to
upstream node/field changes while using standard VS Code semantic token types.
The current query covers Hurl functions, filters, option units and verbosity,
filename/JSON interpolation, raw fences, and native XML without extra runtimes.
Add real parsing/token regressions, then run `npm test`, `npm run verify:package`,
and the printed extracted-package extension-host command before releasing.

## Release notes

See [CHANGELOG.md](CHANGELOG.md).
