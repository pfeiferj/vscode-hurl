# Embedded Tree-sitter grammars

Tagged `json` fences reuse the bundled **tree-sitter-hurl** language and the same
highlight query as native JSON bodies. Their JSON and Hurl templates are parsed
unchanged: no template masking or separate JSON grammar is needed. The Hurl
parser's entry point is `hurl_file`, so the body is parsed after a synthetic
request line; its captures are mapped back to document offsets and restricted to
the original fenced body. The synthetic request is parser input only, never
executed. `tree-sitter-hurl.json` records the bundled grammar's provenance.

For `xml` and `graphql`, `src/embedded.ts` loads the real WASM grammars and highlight
queries from these exact production dependencies (no native compilation or
network access at runtime):

| Fence hint | Package | Upstream grammar | ABI |
| --- | --- | --- | --- |
| `xml` | `@lumis-sh/wasm-xml@0.26.4` | tree-sitter-xml 0.7.0 | 15 |
| `graphql` | `@lumis-sh/wasm-graphql@0.26.3` | tree-sitter-graphql 0.2.1 | 15 |

`provenance.json` records upstream revisions and packaged WASM SHA-256 hashes.
The dedicated tests load the actual installed assets, verify their hashes against
the package manifests, compile their queries, and exercise the embedded parsers.
ABI 15 is compatible with the supported runtime ABI range 13–15.

Both external packages and upstream grammars are MIT licensed. The adjacent
LICENSE files preserve the upstream grammar notices from their pinned revisions.
The dependencies carry the Lumis distribution's own MIT LICENSE files. The
package lock pins their registry integrity hashes. WASM binaries are not copied
into this directory: keep each production dependency's `package.json`,
`lumis.json`, `tree-sitter-<language>.wasm`, and `LICENSE` in the extension package.
Also include this directory so the upstream notices accompany the grammars.

## API and integration

```ts
const embedded = await EmbeddedHighlighter.create(hurlLanguage);
const spans = embedded.spans(documentText, multilineStringNode);
embedded.dispose();
```

`hurlLanguage` is the already-loaded bundled Hurl language. Each embedded parser
has its own parse state, including the additional parser that reuses this language
for JSON. `spans` is synchronous and returns absolute UTF-16 `{ start, end, capture }`
ranges for that one `multiline_string` node only. Captures can overlap; use the
highlighter's normal capture precedence rules to preserve narrower template and
escape captures. JSON uses exactly the native Hurl classifications, including
`constant.builtin` for `null`.

Only lowercase exact `json`, `xml`, and `graphql` hints opt in. Unknown, raw,
untyped, and alias hints return no embedded spans, preserving generic Hurl strings.

Only XML and GraphQL need template masking: Hurl template nodes are replaced in
those parsers' input with offset-preserving blanks and a one-code-unit placeholder.
CR/LF and surrogate-pair widths remain unchanged. Their returned captures are
clipped around templates so Hurl owns the entire interpolation, including braces.
JSON instead retains and highlights its template nodes directly. Fence markers
and hints are never embedded captures. Trees are freed after every call, including
errors. Cancellation interrupts parsing and queries and resets interrupted parsers.
Disposal frees queries and parsers, is idempotent, and later calls throw.
Initialization failure releases already-created resources.

The external queries are adapted to the agreed generic capture names; no new
parent capture types or regex language parsers are introduced. Injections from
those packages are intentionally not executed.
