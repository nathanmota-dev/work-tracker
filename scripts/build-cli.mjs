import { build } from 'esbuild';
import { chmodSync } from 'node:fs';
await build({ entryPoints: ['src/cli/index.ts'], outfile: 'out/cli/work-tracker.cjs', bundle: true, platform: 'node', target: 'node24', format: 'cjs' });
chmodSync('out/cli/work-tracker.cjs', 0o755);
