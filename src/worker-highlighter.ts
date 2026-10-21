import * as path from 'node:path';
import { Worker } from 'node:worker_threads';

import type { HighlightToken } from './highlighting';

export interface HighlightRequest {
  id: number;
  text: string;
  cancelled: SharedArrayBuffer;
}

export type HighlightResponse = { ready: true } | { id: number; tokens: HighlightToken[] } | { id?: number; error: string };

interface Pending {
  key: string;
  version: number;
  text: string;
  cancel: Int32Array;
  cleanup: () => void;
  resolve: (tokens: HighlightToken[] | undefined) => void;
  reject: (error: Error) => void;
}

/** Keeps parsing and query execution off VS Code's shared extension-host thread. */
export class WorkerHighlighter {
  private worker!: Worker;
  private readonly pending = new Map<number, Pending>();
  private readonly cache = new Map<string, { version: number; text: string; tokens: HighlightToken[] }>();
  private nextId = 0;
  private disposed = false;
  private failure?: Error;
  private ready!: Promise<void>;
  private recovery?: Promise<void>;
  private restartTimes: number[] = [];

  private constructor(private readonly grammarPath: string) {
    this.startWorker();
  }

  private startWorker(): void {
    const worker = new Worker(path.join(__dirname, 'highlighting-worker.js'), { workerData: { grammarPath: this.grammarPath } });
    this.worker = worker;
    this.ready = new Promise<void>((resolve, reject) => {
      worker.on('message', (message: HighlightResponse) => {
        if (worker !== this.worker || this.disposed) {
          return;
        }
        if ('ready' in message) {
          resolve();
          return;
        }
        if ('error' in message && message.id === undefined) {
          const error = new Error(message.error);
          reject(error);
          this.fail(error);
          return;
        }
        const id = message.id!;
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          pending.cleanup();
          if ('error' in message) {
            pending.reject(new Error(message.error));
          } else {
            // Bound both document count and the retained token/source footprint.
            if (pending.text.length + message.tokens.length * 32 <= 4_000_000) {
              this.cache.delete(pending.key);
              this.cache.set(pending.key, { version: pending.version, text: pending.text, tokens: message.tokens });
              while (this.cache.size > 8 || this.cacheSize() > 8_000_000) {
                this.cache.delete(this.cache.keys().next().value!);
              }
            }
            pending.resolve(message.tokens);
          }
        }
      });
      worker.on('error', (cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        reject(error);
        if (worker === this.worker && !this.disposed) {
          this.fail(error);
        }
      });
      worker.on('exit', code => {
        const error = new Error(this.disposed ? 'Worker highlighter has been disposed' : `Highlight worker exited unexpectedly (${code})`);
        reject(error);
        if (worker === this.worker && !this.disposed) {
          this.fail(error);
        }
      });
    });
  }

  static async create(grammarPath: string): Promise<WorkerHighlighter> {
    const client = new WorkerHighlighter(grammarPath);
    try {
      await client.ready;
      return client;
    } catch (error) {
      client.dispose();
      throw error;
    }
  }

  tokenize(key: string, version: number, text: string, signal?: AbortSignal): Promise<HighlightToken[] | undefined> {
    if (this.disposed) {
      return Promise.reject(new Error('Worker highlighter has been disposed'));
    }

    if (signal?.aborted) {
      return Promise.resolve(undefined);
    }
    this.cancelPending(key);
    const cached = this.cache.get(key);
    if (cached?.version === version && cached.text === text) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Promise.resolve(cached.tokens);
    }
    this.cache.delete(key);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const cancelled = new SharedArrayBuffer(4);
      const cancel = new Int32Array(cancelled);
      const onAbort = () => this.cancel(id);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, { key, version, text, cancel, resolve, reject,
        cleanup: () => signal?.removeEventListener('abort', onAbort) });
      void this.dispatch({ id, text, cancelled });
    });
  }

  private async dispatch(request: HighlightRequest): Promise<void> {
    try {
      if (this.failure || this.recovery) {
        await this.recover();
      }
      if (this.pending.has(request.id) && !this.disposed) {
        this.worker.postMessage(request);
      }
    } catch (cause) {
      const pending = this.pending.get(request.id);
      if (pending) {
        this.pending.delete(request.id);
        pending.cleanup();
        pending.reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    }
  }

  private recover(): Promise<void> {
    if (this.recovery) {
      return this.recovery;
    }
    this.restartTimes = this.restartTimes.filter(time => Date.now() - time < 30000);
    if (this.restartTimes.length >= 2) {
      return Promise.reject(new Error('Highlight worker recovery limit reached; reload the extension to retry'));
    }
    this.restartTimes.push(Date.now());
    this.recovery = (async () => {
      await new Promise(resolve => setTimeout(resolve, this.restartTimes.length * 100));
      if (this.disposed) {
        throw new Error('Worker highlighter has been disposed');
      }
      this.failure = undefined;
      try {
        this.startWorker();
        await this.ready;
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        this.fail(error);
        throw error;
      }
    })().finally(() => { this.recovery = undefined; });
    return this.recovery;
  }

  release(key: string): void {
    this.cache.delete(key);
    this.cancelPending(key);
  }

  private cancelPending(key: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.key === key) {
        this.cancel(id);
      }
    }
  }

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      for (const id of this.pending.keys()) {
        this.cancel(id);
      }
      this.pending.clear();
      this.cache.clear();
      void this.worker.terminate();
    }
  }

  private fail(error: Error): void {
    this.failure = error;
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
    this.cache.clear();
    void this.worker.terminate();
  }

  private cancel(id: number): void {
    const pending = this.pending.get(id);
    if (pending) {
      Atomics.store(pending.cancel, 0, 1);
      this.pending.delete(id);
      pending.cleanup();
      pending.resolve(undefined);
    }
  }

  private cacheSize(): number {
    let size = 0;
    for (const entry of this.cache.values()) {
      size += entry.text.length + entry.tokens.length * 32;
    }
    return size;
  }
}
