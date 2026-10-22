import { parentPort, workerData } from 'node:worker_threads';

import { Highlighter } from './highlighting';
import type { HighlightRequest, HighlightResponse } from './worker-highlighter';

async function main(): Promise<void> {
  const port = parentPort;
  if (!port) {
    throw new Error('Highlighting must run inside a worker');
  }
  const highlighter = await Highlighter.create(workerData.grammarPath);
  port.on('close', () => highlighter.dispose());
  port.on('message', ({ id, text, cancelled }: HighlightRequest) => {
    const cancel = new Int32Array(cancelled);
    if (Atomics.load(cancel, 0)) {
      return;
    }
    try {
      const result = highlighter.analyze(text, [], () => Atomics.load(cancel, 0) !== 0);
      if (!Atomics.load(cancel, 0)) {
        port.postMessage({ id, result } satisfies HighlightResponse);
      }
    } catch (error) {
      port.postMessage({ id, error: String(error) } satisfies HighlightResponse);
    }
  });
  port.postMessage({ ready: true } satisfies HighlightResponse);
}

void main().catch(error => {
  parentPort?.postMessage({ error: String(error) } satisfies HighlightResponse);
});
