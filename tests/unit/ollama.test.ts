import { describe, it, expect, afterEach } from 'vitest';

import { OllamaEmbeddingProvider } from '../../src/core/embeddings/ollama.js';
import { EmbeddingError } from '../../src/core/embeddings/index.js';

/**
 * The Ollama provider is a thin HTTP client; we only test the batch/fallback
 * protocol contract. `global.fetch` is replaced with a stub recorder.
 */

interface FetchCall { url: string; body: unknown }

function stubFetch(
  responder: (call: FetchCall) => Promise<Response> | Response
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = global.fetch;
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const call: FetchCall = { url: String(url), body };
    calls.push(call);
    return await responder(call);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      global.fetch = original;
    },
  };
}

describe('OllamaEmbeddingProvider', () => {
  let stub: ReturnType<typeof stubFetch>;
  afterEach(() => stub?.restore());

  it('uses /api/embed (batch) with a single HTTP call for N inputs', async () => {
    stub = stubFetch(async () => {
      const embeddings = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6], [0.7, 0.8, 0.9]];
      return new Response(JSON.stringify({ embeddings }), { status: 200 });
    });
    const p = new OllamaEmbeddingProvider({ url: 'http://fake', model: 'm' });
    const out = await p.embed(['one', 'two', 'three']);
    expect(out).toHaveLength(3);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]!.url).toMatch(/\/api\/embed$/);
    expect((stub.calls[0]!.body as { input: string[] }).input).toEqual(['one', 'two', 'three']);
    expect(p.dimension).toBe(3);
  });

  it('falls back to /api/embeddings per-prompt when the batch endpoint is unavailable', async () => {
    let callCount = 0;
    stub = stubFetch(async (call) => {
      callCount++;
      if (call.url.endsWith('/api/embed')) {
        return new Response('not supported', { status: 404 });
      }
      // Each per-prompt call returns a different vector dim=2.
      return new Response(JSON.stringify({ embedding: [callCount / 10, callCount / 5] }), { status: 200 });
    });
    const p = new OllamaEmbeddingProvider({ url: 'http://fake', model: 'm' });
    const out = await p.embed(['a', 'b']);
    // First batch attempt (fails) + two per-prompt fallbacks.
    expect(stub.calls.length).toBe(3);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(2);
  });

  it('skips the batch probe on subsequent calls once it has failed', async () => {
    let probeCalls = 0;
    stub = stubFetch(async (call) => {
      if (call.url.endsWith('/api/embed')) {
        probeCalls++;
        return new Response('down', { status: 404 });
      }
      return new Response(JSON.stringify({ embedding: [0.1, 0.2] }), { status: 200 });
    });
    const p = new OllamaEmbeddingProvider({ url: 'http://fake', model: 'm' });
    await p.embed(['a']);
    await p.embed(['b']);
    await p.embed(['c']);
    expect(probeCalls).toBe(1); // batch probed once, never retried
  });

  it('throws EmbeddingError when batch response is malformed', async () => {
    stub = stubFetch(async () => new Response(JSON.stringify({ embeddings: [[0.1]] }), { status: 200 }));
    const p = new OllamaEmbeddingProvider({ url: 'http://fake', model: 'm' });
    await expect(p.embed(['a', 'b'])).rejects.toBeInstanceOf(EmbeddingError);
  });

  it('returns [] immediately for empty input without hitting the network', async () => {
    stub = stubFetch(async () => new Response('should not be called', { status: 500 }));
    const p = new OllamaEmbeddingProvider({ url: 'http://fake', model: 'm' });
    expect(await p.embed([])).toEqual([]);
    expect(stub.calls).toHaveLength(0);
  });
});
