import * as path from 'node:path';
import { Worker } from 'node:worker_threads';

import type { DocumentAnalysis, HighlightToken } from './highlighting';

export interface HighlightRequest {
  id: number;
  text: string;
  cancelled: SharedArrayBuffer;
}

export type HighlightResponse = { ready: true } | { id: number; result: DocumentAnalysis } | { id?: number; error: string };

interface Subscriber {
  cleanup: () => void;
  resolve: (result: DocumentAnalysis | undefined) => void;
  reject: (error: Error) => void;
}

interface Pending {
  key: string;
  version: number;
  text: string;
  cancel: Int32Array;
  subscribers: Set<Subscriber>;
}

/** Shared, cancellable analysis off VS Code's extension-host thread. */
export class WorkerHighlighter {
  private worker!: Worker;
  private readonly pending = new Map<number, Pending>();
  private readonly cache = new Map<string, { version: number; text: string; result: DocumentAnalysis }>();
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
        if (worker !== this.worker || this.disposed) { return; }
        if ('ready' in message) { resolve(); return; }
        if ('error' in message && message.id === undefined) {
          const error = new Error(message.error);
          reject(error);
          this.fail(error);
          return;
        }
        const pending = this.pending.get(message.id!);
        if (!pending) { return; }
        this.pending.delete(message.id!);
        if ('error' in message) {
          this.settle(pending, undefined, new Error(message.error));
        } else {
          if (this.entrySize(pending.text, message.result) <= 4_000_000) {
            this.cache.delete(pending.key);
            this.cache.set(pending.key, { version: pending.version, text: pending.text, result: message.result });
            while (this.cache.size > 8 || this.cacheSize() > 8_000_000) {
              this.cache.delete(this.cache.keys().next().value!);
            }
          }
          this.settle(pending, message.result);
        }
      });
      worker.on('error', (cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        reject(error);
        if (worker === this.worker && !this.disposed) { this.fail(error); }
      });
      worker.on('exit', code => {
        const error = new Error(this.disposed ? 'Worker highlighter has been disposed' : `Highlight worker exited unexpectedly (${code})`);
        reject(error);
        if (worker === this.worker && !this.disposed) { this.fail(error); }
      });
    });
  }

  static async create(grammarPath: string): Promise<WorkerHighlighter> {
    const client = new WorkerHighlighter(grammarPath);
    try { await client.ready; return client; }
    catch (error) { client.dispose(); throw error; }
  }

  tokenize(key: string, version: number, text: string, signal?: AbortSignal): Promise<HighlightToken[] | undefined> {
    return this.analyze(key, version, text, signal).then(result => result?.tokens);
  }

  analyze(key: string, version: number, text: string, signal?: AbortSignal): Promise<DocumentAnalysis | undefined> {
    if (this.disposed) { return Promise.reject(new Error('Worker highlighter has been disposed')); }
    if (signal?.aborted) { return Promise.resolve(undefined); }
    for (const [id, pending] of this.pending) {
      if (pending.key === key) {
        if (pending.version === version && pending.text === text) { return this.subscribe(id, pending, signal); }
        this.cancel(id);
      }
    }
    const cached = this.cache.get(key);
    if (cached?.version === version && cached.text === text) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Promise.resolve(cached.result);
    }
    this.cache.delete(key);
    const id = ++this.nextId;
    const cancelled = new SharedArrayBuffer(4);
    const pending: Pending = { key, version, text, cancel: new Int32Array(cancelled), subscribers: new Set() };
    this.pending.set(id, pending);
    const result = this.subscribe(id, pending, signal);
    void this.dispatch({ id, text, cancelled });
    return result;
  }

  private subscribe(id: number, pending: Pending, signal?: AbortSignal): Promise<DocumentAnalysis | undefined> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        pending.subscribers.delete(subscriber);
        subscriber.cleanup();
        resolve(undefined);
        if (pending.subscribers.size === 0) { this.cancel(id); }
      };
      const subscriber: Subscriber = { resolve, reject, cleanup: () => signal?.removeEventListener('abort', onAbort) };
      pending.subscribers.add(subscriber);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) { onAbort(); }
    });
  }

  private settle(pending: Pending, result?: DocumentAnalysis, error?: Error): void {
    for (const subscriber of pending.subscribers) {
      subscriber.cleanup();
      if (error) { subscriber.reject(error); } else { subscriber.resolve(result); }
    }
    pending.subscribers.clear();
  }

  private async dispatch(request: HighlightRequest): Promise<void> {
    try {
      if (this.failure || this.recovery) { await this.recover(); }
      if (this.pending.has(request.id) && !this.disposed) { this.worker.postMessage(request); }
    } catch (cause) {
      const pending = this.pending.get(request.id);
      if (pending) {
        this.pending.delete(request.id);
        this.settle(pending, undefined, cause instanceof Error ? cause : new Error(String(cause)));
      }
    }
  }

  private recover(): Promise<void> {
    if (this.recovery) { return this.recovery; }
    this.restartTimes = this.restartTimes.filter(time => Date.now() - time < 30000);
    if (this.restartTimes.length >= 2) {
      return Promise.reject(new Error('Highlight worker recovery limit reached; reload the extension to retry'));
    }
    this.restartTimes.push(Date.now());
    this.recovery = (async () => {
      await new Promise(resolve => setTimeout(resolve, this.restartTimes.length * 100));
      if (this.disposed) { throw new Error('Worker highlighter has been disposed'); }
      this.failure = undefined;
      try { this.startWorker(); await this.ready; }
      catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        this.fail(error);
        throw error;
      }
    })().finally(() => { this.recovery = undefined; });
    return this.recovery;
  }

  release(key: string): void {
    this.cache.delete(key);
    for (const [id, pending] of this.pending) { if (pending.key === key) { this.cancel(id); } }
  }

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      for (const id of this.pending.keys()) { this.cancel(id); }
      this.cache.clear();
      void this.worker.terminate();
    }
  }

  private fail(error: Error): void {
    this.failure = error;
    for (const pending of this.pending.values()) { this.settle(pending, undefined, error); }
    this.pending.clear();
    this.cache.clear();
    void this.worker.terminate();
  }

  private cancel(id: number): void {
    const pending = this.pending.get(id);
    if (pending) {
      Atomics.store(pending.cancel, 0, 1);
      this.pending.delete(id);
      this.settle(pending);
    }
  }

  private entrySize(text: string, result: DocumentAnalysis): number {
    return text.length + result.tokens.length * 32 +
      (result.folds.length + result.links.length + result.xmlRegions.length + result.protectedRanges.length +
        result.containers.length + result.issues.length) * 64 +
      result.links.reduce((size, link) => size + link.target.length, 0) +
      result.issues.reduce((size, issue) => size + issue.message.length, 0);
  }

  private cacheSize(): number {
    let size = 0;
    for (const entry of this.cache.values()) { size += this.entrySize(entry.text, entry.result); }
    return size;
  }
}
