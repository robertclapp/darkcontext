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

  it('defaults dedupDistance to 0.15 and accepts an env override', () => {
    const defaultCfg = loadConfig({}, {});
    expect(defaultCfg.dedupDistance).toBe(0.15);
    const overrideCfg = loadConfig({}, { DARKCONTEXT_DEDUP_DISTANCE: '0.08' });
    expect(overrideCfg.dedupDistance).toBe(0.08);
  });

  it('rejects a negative or non-numeric dedupDistance with ConfigError', () => {
    expect(() => loadConfig({}, { DARKCONTEXT_DEDUP_DISTANCE: '-1' })).toThrow(ConfigError);
    expect(() => loadConfig({}, { DARKCONTEXT_DEDUP_DISTANCE: 'nope' })).toThrow(ConfigError);
  });
});
