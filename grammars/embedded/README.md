# Embedded Tree-sitter grammars

`src/embedded.ts` loads the real WASM grammars and highlight queries from these
exact production dependencies (no native compilation or network access at runtime):

| Fence hint | Package | Upstream grammar | ABI |
| --- | --- | --- | --- |
| `json` | `@lumis-sh/wasm-json@0.26.5` | tree-sitter-json 0.24.8 | 15 |
| `xml` | `@lumis-sh/wasm-xml@0.26.4` | tree-sitter-xml 0.7.0 | 15 |
| `graphql` | `@lumis-sh/wasm-graphql@0.26.3` | tree-sitter-graphql 0.2.1 | 15 |

`provenance.json` records upstream revisions and packaged WASM SHA-256 hashes.
The dedicated tests load the actual installed assets, verify their hashes against
the package manifests, compile their queries, and exercise all three parsers.
ABI 15 is compatible with the supported runtime ABI range 13–15.

All three packages and upstream grammars are MIT licensed. The adjacent LICENSE
files preserve the upstream grammar notices, fetched from their pinned revisions.
The production dependencies carry the Lumis distribution's own MIT LICENSE files.
The package lock pins their registry integrity hashes. WASM binaries are not
copied into this directory: keep each production dependency's `package.json`,
`lumis.json`, `tree-sitter-<language>.wasm`, and `LICENSE` in the extension package.
Also include this directory so the upstream notices accompany the grammars.

## API and integration

```ts
const embedded = await EmbeddedHighlighter.create();
const spans = embedded.spans(documentText, multilineStringNode);
embedded.dispose();
```

`spans` is synchronous and returns absolute UTF-16 `{ start, end, capture }`
ranges for that one `multiline_string` node only. Captures can overlap (e.g. a
JSON key is both a string and a property); use the highlighter's normal capture
precedence rules. More specific packaged query captures follow generic ones.
Only lowercase exact `json`, `xml`, and `graphql` hints opt in. Unknown, raw,
untyped, and alias hints return no embedded spans, preserving generic Hurl strings.

Hurl template nodes are replaced in parser input with offset-preserving blanks
and a one-code-unit scalar placeholder. CR/LF and surrogate-pair widths remain
unchanged. All returned captures are clipped around templates so Hurl owns the
entire interpolation, including braces. Fence markers/hints are never embedded
captures. Trees are freed after every call, including errors. Disposal frees
queries and parsers, is idempotent, and later calls throw. Initialization failure
releases already-created resources.

The packaged upstream queries are adapted to the agreed generic capture names;
no new parent capture types or regex language parsers are introduced. Injections
from those packages are intentionally not executed.
