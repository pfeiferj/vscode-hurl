# Hurl

Tree-sitter-based syntax highlighting for [Hurl](https://hurl.dev) files in VS Code.
This is an unofficial extension; see the Hurl website for the project itself.

## Features

- Semantic syntax highlighting for `.hurl` files, including requests, assertions,
  strings, escapes, variables, comments, and multiline bodies.
- Distinct interpolation/punctuation, HTTP method, boolean, escape, and option
  token types with Hurl-specific TextMate fallback scopes for theme compatibility.
- Native XML declarations, DTDs, tags and attributes, complete encoded literals,
  and variable declarations in capture sections.
- Embedded JSON, XML, and GraphQL highlighting in explicitly language-tagged
  fences, preserving Hurl interpolation. `raw`, untagged, and unknown-language
  fences remain literal strings.
- Background worker parsing with bounded document caching and cancellation of
  superseded requests, keeping parsing off the shared extension-host thread.
- Hurl language configuration for comments, brackets, and automatic closing pairs.
- Highlighting for local files, untitled documents, and other document URI schemes.

The extension only provides highlighting and language configuration. It does not
register a Hurl command, execute requests, start processes, or open output webviews.
No Hurl executable or other external runtime is required: both the Tree-sitter
runtime and the Hurl grammar are included as WebAssembly assets.

## Requirements

VS Code **1.142.0 or newer**. Semantic highlighting is enabled by default for Hurl,
including with themes that do not opt into it. Explicit user settings still win:
`[hurl].editor.semanticHighlighting.enabled: false` disables it, and
`"configuredByTheme"` restores theme-controlled behavior. There is no TextMate
grammar fallback when semantic highlighting is explicitly disabled.

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
Code download. They check provider tokens for untitled and custom-scheme documents,
edits, and the absence of the removed `hurl.hurl` command. A separate visible-editor
test observes automatic requests under a semantic-disabled test theme, checking
both the Hurl default and explicit user overrides. Tests use isolated user data
and do not change your normal VS Code settings. Set `HURL_VSCODE_VERSION=1.142.0`
to test the minimum supported release instead of current stable. Custom URI
coverage is not a test of a genuine remote extension host; automatic requests are
not a screenshot-based assertion of theme colors.

The runtime uses the current `web-tree-sitter` named `Parser`, `Language`, and
`Query` APIs, explicitly locating the packaged runtime WASM. The bundled Hurl
parser has ABI 15, supported by runtime 0.27.1 (ABI 13–15); tests verify its digest,
load the real parser, and compile the real highlighting query. Trees are deleted after every
request. The worker is terminated with the extension; closing or editing a document
invalidates its cache and pending requests. Results are cached for at most eight
documents with a bounded estimated source/token footprint. Cancellation promptly
discards stale results, skips queued obsolete jobs, and cooperatively interrupts
active native/embedded parsing and queries. Unexpected worker failures reject
outstanding requests; later requests can restart it with bounded backoff (at most
two restarts per 30 seconds). Parsing still processes the whole changed
document, but never runs on the shared extension-host thread.
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
upstream node/field changes. Keep `src/tokens.ts` and the manifest's custom semantic
types and scope mappings in sync; tests enforce capture and theme coverage.
The current query covers Hurl functions, filters, option units and verbosity,
filename/JSON interpolation, raw fences, and native XML. Fenced JSON/XML/GraphQL
parsers are pinned `@lumis-sh/wasm-*` dependencies, shipped as WASM assets with
their licenses; they use the same Tree-sitter runtime and require no external tools.
Add real parsing/token regressions, then run `npm test`, `npm run verify:package`,
and the printed extracted-package extension-host command before releasing.

## Release notes

See [CHANGELOG.md](CHANGELOG.md).
