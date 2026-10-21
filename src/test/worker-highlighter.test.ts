import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import type { Worker } from 'node:worker_threads';

import { Highlighter, HighlightToken } from '../highlighting';

interface WorkerClient {
  tokenize(key: string, version: number, text: string, signal?: AbortSignal): Promise<HighlightToken[] | undefined>;
  release(key: string): void;
  dispose(): void;
}

async function create(grammar = path.resolve(__dirname, '../../tree-sitter-hurl.wasm')): Promise<WorkerClient> {
  const { WorkerHighlighter } = require('../worker-highlighter');
  return WorkerHighlighter.create(grammar);
}

const source = 'GET https://example.org/{{name}}\nHTTP 200\n[Asserts]\nstatus == 200\n';

test('cancelling an active parse unblocks the replacement request', { timeout: 10000 }, async () => {
  const client = await create();
  const abort = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const obsolete = client.tokenize('active', 1, source.repeat(100000), abort.signal);
    await new Promise(resolve => setTimeout(resolve, 40));
    abort.abort();
    assert.ok((await obsolete) === undefined);
    const latest = await Promise.race([
      client.tokenize('active', 2, '# latest\n'),
      new Promise<undefined>(resolve => { timeout = setTimeout(() => resolve(undefined), 1500); }),
    ]);
    assert.ok(latest && latest.length === 1, 'cancelled active work must not block newer requests');
  } finally {
    clearTimeout(timeout);
    client.dispose();
  }
});

test('a fresh request recovers after an unexpected worker exit', async () => {
  const client = await create();
  try {
    // Fault injection: terminate the real worker, not the service, while it has a request.
    const failed = client.tokenize('failed', 1, source.repeat(10000));
    const rejection = assert.rejects(failed, /exited unexpectedly/);
    await (client as unknown as { worker: Worker }).worker.terminate();
    await rejection;
    const recovered = await client.tokenize('recovered', 1, '# recovered\n');
    assert.ok(recovered && recovered.length === 1, 'subsequent requests should restart the worker');
  } finally {
    client.dispose();
  }
});

test('cancelled and superseded jobs return no tokens; only current versions are cached', async () => {
  const client = await create();
  try {
    const abort = new AbortController();
    const cancelled = client.tokenize('cancelled', 1, source.repeat(10000), abort.signal);
    abort.abort();
    assert.ok((await cancelled) === undefined, 'cancellation must discard the result');
    assert.equal(await client.tokenize('cancelled', 2, source, abort.signal), undefined);
    const outdated = client.tokenize('edited', 1, source.repeat(10000));
    const current = client.tokenize('edited', 2, '# latest\n');
    assert.equal(await outdated, undefined);
    const latest = await current;
    assert.ok(latest && latest.length === 1);
    assert.strictEqual(await client.tokenize('edited', 2, '# latest\n'), latest);
    const closed = client.tokenize('closed', 1, source.repeat(10000));
    client.release('closed');
    assert.equal(await closed, undefined);
  } finally {
    client.dispose();
  }
});

test('recovery retries are bounded and requests waiting for recovery can be cancelled', async () => {
  const client = await create();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const failed = client.tokenize('crash', attempt, source.repeat(10000));
      const rejected = assert.rejects(failed, /exited unexpectedly/);
      await (client as unknown as { worker: Worker }).worker.terminate();
      await rejected;
      if (attempt < 2) {
        const abort = new AbortController();
        const cancelled = client.tokenize('cancel-during-restart', attempt, source, abort.signal);
        abort.abort();
        assert.equal(await cancelled, undefined);
        const recovered = await client.tokenize('recovered', attempt, source);
        assert.ok(recovered && recovered.length > 0);
      }
    }
    await assert.rejects(client.tokenize('limited', 1, source), /recovery limit/);
  } finally {
    client.dispose();
  }
});

test('worker initialization errors reject and disposal settles outstanding requests', async () => {
  await assert.rejects(create(path.resolve(__dirname, 'missing.wasm')));
  const client = await create();
  const pending = client.tokenize('disposed', 1, source.repeat(10000));
  client.dispose();
  client.dispose();
  assert.equal(await pending, undefined);
  await assert.rejects(client.tokenize('disposed', 2, source), /disposed/);
});

test('worker returns real grammar tokens without parsing on the calling thread', async () => {
  const client = await create();
  const local = await Highlighter.create(path.resolve(__dirname, '../../tree-sitter-hurl.wasm'));
  try {
    assert.deepEqual(await client.tokenize('doc', 1, source), local.tokenize(source));
    let eventLoopRan = false;
    const timer = setTimeout(() => { eventLoopRan = true; }, 0);
    const result = await client.tokenize('large', 1, source.repeat(10000));
    clearTimeout(timer);
    assert.ok(eventLoopRan, 'extension-host event loop must stay responsive during parsing');
    assert.ok(result && result.length > 0);
  } finally {
    local.dispose();
    client.dispose();
  }
});

test('unchanged versions reuse cached tokens; edits and release invalidate them', async () => {
  const client = await create();
  try {
    const first = await client.tokenize('doc', 1, source);
    assert.strictEqual(await client.tokenize('doc', 1, source), first);
    assert.notDeepEqual(await client.tokenize('doc', 2, '# changed\n'), first);
    const changed = await client.tokenize('doc', 2, '# changed\n');
    assert.notDeepEqual(await client.tokenize('doc', 2, 'GET https://other.org\n'), changed);
    const current = await client.tokenize('doc', 3, source);
    client.release('doc');
    const reloaded = await client.tokenize('doc', 3, source);
    assert.notStrictEqual(reloaded, current);
    for (let index = 0; index < 9; index++) {
      await client.tokenize(`other-${index}`, 1, source);
    }
    assert.notStrictEqual(await client.tokenize('doc', 3, source), reloaded);
  } finally {
    client.dispose();
  }
});
