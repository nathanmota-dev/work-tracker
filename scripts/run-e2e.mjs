import { createRequire } from 'node:module';
import { ensureTestDisplay, runCommand } from './test-display.mjs';

const args = process.argv.slice(2);
try {
  await ensureTestDisplay(args);
  const require = createRequire(import.meta.url);
  process.exitCode = await runCommand(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...args]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
