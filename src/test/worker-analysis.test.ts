import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';

const grammar = path.resolve(__dirname, '../../tree-sitter-hurl.wasm');
const source = 'POST https://example.org/path\n{\n  "items": [1, 2]\n}\nHTTP 200\n';

async function client() {
  const { WorkerHighlighter } = require('../worker-highlighter');
  return WorkerHighlighter.create(grammar);
}

test('worker analysis supplies syntax, folding and links together with semantic tokens', async () => {
  const worker = await client();
  try {
    assert.equal(typeof worker.analyze, 'function', 'editor features need shared worker analysis');
    const result = await worker.analyze('features', 1, source);
    assert.ok(result.tokens.length > 0);
    assert.ok(result.folds.length > 0);
    assert.ok(result.containers.length > 0);
    assert.deepEqual(result.issues, []);
    assert.equal(result.links[0].target, 'https://example.org/path');
    assert.strictEqual((await worker.tokenize('features', 1, source)), result.tokens);
    const invalid = await worker.analyze('features', 2, 'POST https://example.org\n{"broken": }\n');
    assert.ok(invalid.issues.length > 0);
  } finally { worker.dispose(); }
});

test('same-version consumers share work and cancellation only releases its own subscription', async () => {
  const worker = await client();
  const first = new AbortController();
  const second = new AbortController();
  try {
    assert.equal(typeof worker.analyze, 'function');
    const text = source.repeat(1000);
    const one = worker.analyze('shared', 1, text, first.signal);
    const two = worker.analyze('shared', 1, text, second.signal);
    first.abort();
    assert.equal(await one, undefined);
    const result = await two;
    assert.ok(result && result.tokens.length > 0, 'one cancelled provider must not cancel the other');
    assert.strictEqual(await worker.analyze('shared', 1, text), result);
    const outdated = worker.analyze('shared', 2, text);
    const replacement = worker.analyze('shared', 3, '# fresh\n');
    assert.equal(await outdated, undefined);
    assert.equal((await replacement).tokens.length, 1);
  } finally { worker.dispose(); }
});
