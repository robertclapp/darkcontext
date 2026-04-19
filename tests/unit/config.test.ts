import { describe, it, expect } from 'vitest';

import { loadConfig } from '../../src/core/config.js';
import { ConfigError } from '../../src/core/errors.js';

describe('loadConfig', () => {
  it('returns sensible defaults with an empty env', () => {
    const c = loadConfig({}, {});
    expect(c.embeddings).toBe('stub');
    expect(c.ollama.url).toBe('http://localhost:11434');
    expect(c.ollama.model).toBe('nomic-embed-text');
    expect(c.onnx.model).toBe('Xenova/all-MiniLM-L6-v2');
    expect(c.token).toBeUndefined();
    expect(c.encryptionKey).toBeUndefined();
    expect(c.dbPath.endsWith('/store.db')).toBe(true);
  });

  it('reads every known env var', () => {
    const c = loadConfig({}, {
      DARKCONTEXT_HOME: '/tmp/dcx',
      DARKCONTEXT_EMBEDDINGS: 'ollama',
      DARKCONTEXT_TOKEN: 'dcx_secret',
      DARKCONTEXT_ENCRYPTION_KEY: 'rosebud',
      OLLAMA_URL: 'http://ollama.local:11434/',
      OLLAMA_EMBED_MODEL: 'mxbai-embed-large',
      DARKCONTEXT_ONNX_MODEL: 'Xenova/gte-small',
    });
    expect(c.home).toBe('/tmp/dcx');
    expect(c.dbPath).toBe('/tmp/dcx/store.db');
    expect(c.embeddings).toBe('ollama');
    expect(c.token).toBe('dcx_secret');
    expect(c.encryptionKey).toBe('rosebud');
    expect(c.ollama.url).toBe('http://ollama.local:11434'); // trailing slash stripped
    expect(c.ollama.model).toBe('mxbai-embed-large');
    expect(c.onnx.model).toBe('Xenova/gte-small');
  });

  it('overrides beat env', () => {
    const c = loadConfig(
      { dbPath: '/override/db.sqlite', embeddings: 'onnx' },
      { DARKCONTEXT_EMBEDDINGS: 'ollama' }
    );
    expect(c.dbPath).toBe('/override/db.sqlite');
    expect(c.embeddings).toBe('onnx');
  });

  it('rejects an unknown provider kind with ConfigError', () => {
    expect(() => loadConfig({}, { DARKCONTEXT_EMBEDDINGS: 'mystery-engine' })).toThrow(ConfigError);
  });

  it('defaults llm to stub + llama3.2 and reads DARKCONTEXT_LLM / DARKCONTEXT_LLM_MODEL', () => {
    const def = loadConfig({}, {});
    expect(def.llm).toEqual({ kind: 'stub', model: 'llama3.2' });

    const ollama = loadConfig({}, { DARKCONTEXT_LLM: 'ollama', DARKCONTEXT_LLM_MODEL: 'qwen2.5' });
    expect(ollama.llm).toEqual({ kind: 'ollama', model: 'qwen2.5' });
  });

  it('rejects an unknown DARKCONTEXT_LLM provider with ConfigError', () => {
    expect(() => loadConfig({}, { DARKCONTEXT_LLM: 'magic' })).toThrow(ConfigError);
  });
});
