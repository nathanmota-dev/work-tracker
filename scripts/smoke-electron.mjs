import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const command = process.argv[2] ?? resolve('node_modules/.bin/electron');
const args = process.argv.slice(3);
if (process.argv.length < 3) args.push('.', '--no-sandbox');
const home = mkdtempSync(join(tmpdir(), 'work tracker electron '));
const child = spawn(command, args, { env: { ...process.env, WORK_TRACKER_HOME: home, WORK_TRACKER_SMOKE: '1', APPIMAGE_EXTRACT_AND_RUN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; });
const timer = setTimeout(() => { child.kill('SIGKILL'); }, 20000);
try {
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  if (code !== 0 || !output.includes('"type":"ready"') || !output.includes('"type":"stopped"')) throw Error(`Electron smoke failed (${code})\n${output}`);
  if (existsSync(join(home, 'backend.lock'))) throw Error('Backend lock was not removed');
  const db = new DatabaseSync(join(home, 'work-tracker.db'));
  if (db.prepare('SELECT count(*) AS n FROM jobs').get().n !== 0) throw Error('Database was not empty');
  db.close();
  console.log(`PASS: Electron ready → shutdown → stopped, empty SQLite, no lock (${command})`);
} finally { clearTimeout(timer); rmSync(home, { recursive: true, force: true }); }
