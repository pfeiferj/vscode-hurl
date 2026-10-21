// Run after npm run compile. Reports timings; no machine-dependent pass/fail budget.
const assert = require('node:assert/strict');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { WorkerHighlighter } = require('../out/worker-highlighter.js');

async function main() {
  const worker = await WorkerHighlighter.create(path.resolve(__dirname, '../tree-sitter-hurl.wasm'));
  try {
    const entry = 'GET https://example.org/{{id}}\nHTTP 200\n[Asserts]\nstatus == 200\n';
    await worker.tokenize('warmup', 1, entry);
    for (const entries of [5000, 10000, 20000]) {
      const source = entry.repeat(entries);
      const key = `benchmark-${entries}`;
      let ticks = 0;
      let maximumGap = 0;
      let previous = performance.now();
      const interval = setInterval(() => {
        const now = performance.now();
        maximumGap = Math.max(maximumGap, now - previous);
        previous = now;
        ticks++;
      }, 5);
      const start = performance.now();
      let tokens;
      try {
        tokens = await worker.tokenize(key, 1, source);
      } finally {
        clearInterval(interval);
      }
      const elapsed = performance.now() - start;
      maximumGap = Math.max(maximumGap, performance.now() - previous);
      assert.ok(tokens && tokens.length > 0);
      assert.ok(ticks > 0, 'calling thread must continue servicing timers');
      const cachedAt = performance.now();
      const cached = await worker.tokenize(key, 1, source);
      const cachedMs = performance.now() - cachedAt;
      console.log(JSON.stringify({ bytes: Buffer.byteLength(source), lines: entries * 4,
        tokenCount: tokens.length, workerRoundTripMs: +elapsed.toFixed(2),
        callerTimerTicks: ticks, callerMaxGapMs: +maximumGap.toFixed(2),
        cached: cached === tokens, cachedOrUncachedMs: +cachedMs.toFixed(2) }));
      worker.release(key);
    }
  } finally {
    worker.dispose();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
