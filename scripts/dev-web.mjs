// Runs the backend without idle shutdown and the Vite development server that forwards to it.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const port = process.env.WORK_TRACKER_DEV_PORT ?? '47830';
const children = [
  spawn(process.execPath, [resolve('out/cli/work-tracker.cjs'), 'start', '--no-open', '--idle-timeout', '0', '--port', port], { stdio: 'inherit' }),
  spawn(resolve('node_modules/.bin/vite'), ['--config', 'web/vite.config.ts', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, WORK_TRACKER_DEV_BACKEND: `http://127.0.0.1:${port}` } }),
];
const stop = () => { for (const child of children) child.kill('SIGTERM'); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
for (const child of children) child.once('exit', code => { stop(); process.exitCode ||= code ?? 0; });
