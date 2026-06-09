import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Only production sources under src/. Excluded:
      //   - type-only files (`types.ts`, ambient `.d.ts`) — no runtime code,
      //     always report 0% of 0 lines which skews the overall numbers;
      //   - the index barrels (pure re-exports, nothing to cover);
      //   - the CLI entrypoint (just commander registrations — the real
      //     code paths are the `runX` functions, which ARE covered).
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/types.ts',
        'src/**/index.ts',
        'src/cli/index.ts',
      ],
    },
  },
});

