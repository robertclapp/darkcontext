import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const assets = [
  ['src/core/store/schema.sql', 'dist/core/store/schema.sql'],
];

for (const [src, dest] of assets) {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`copied ${src} -> ${dest}`);
}
