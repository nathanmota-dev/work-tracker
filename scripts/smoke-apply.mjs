import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, delimiter } from 'node:path';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from 'ws';
import { ensureTestDisplay, electronArgs, stopProcess, onTermination } from './test-display.mjs';

await ensureTestDisplay();

const home = mkdtempSync(join(tmpdir(), 'work-tracker-apply-smoke-'));
const repository = join(home, 'repository');
const env = { ...process.env, WORK_TRACKER_HOME: home, WORK_TRACKER_REPO_ROOT: repository, APPIMAGE_EXTRACT_AND_RUN: '1', WORK_TRACKER_SKIP_MCP_INSTALL: '1', PATH: [join(homedir(), '.local', 'bin'), process.env.PATH].join(delimiter) };
const command = process.argv[2] ?? resolve('node_modules/.bin/electron');
const args = process.argv.length > 2 ? process.argv.slice(3) : ['.', '--no-sandbox'];
let child, socket;
const cleanup = async () => {
  socket?.terminate();
  await stopProcess(child);
  rmSync(home, { recursive: true, force: true });
};
const removeSignals = onTermination(cleanup);
let output = '';
const pending = new Map();
let nextId = 0;
function run(bin, args, cwd) {
  const result = spawnSync(bin, args, { env, cwd, encoding: 'utf8', timeout: 90000 });
  if (result.status !== 0) throw new Error(`${bin} failed: ${result.error?.message ?? result.stderr}\n${result.stdout}`);
  return result.stdout;
}
async function waitFor(fn, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const result = await fn(); if (result) return result; } catch {} await new Promise(resolve => setTimeout(resolve, 150)); }
  throw new Error(`Apply smoke timed out.\n${output.slice(-4000)}`);
}
function rpc(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const result = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try {
  run(process.execPath, ['out/cli/work-tracker.cjs', 'init']);
  const project = join(repository, 'base', 'latex');
  const dataFile = join(repository, 'base', 'data', 'resume-data.json');
  mkdirSync(project, { recursive: true });
  mkdirSync(join(repository, 'base', 'data'), { recursive: true });
  writeFileSync(dataFile, JSON.stringify({ skills: ['React'], projects: [] }));
  copyFileSync('base/latex/resume.example.tex', join(project, 'resume.tex'));
  run('latexmk', ['-norc', '-pdf', '-interaction=nonstopmode', '-halt-on-error', 'resume.tex'], project);
  const pdf = join(home, 'artifacts', 'resume.pdf');
  mkdirSync(join(home, 'artifacts'), { recursive: true });
  copyFileSync(join(project, 'resume.pdf'), pdf);
  const text = run('pdftotext', [pdf, '-']);
  const agent = join(home, 'agent.cjs');
  writeFileSync(agent, `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='session/new'?{sessionId:'smoke',models:{availableModels:[]}}:{}})+'\\n')})`);
  writeFileSync(join(home, 'config.json'), JSON.stringify({ acp: Object.fromEntries(['opencode','claude-code'].map(name => [name, { command: process.execPath, args: [agent] }])) }));
  const db = new DatabaseSync(join(home, 'work-tracker.db'));
  db.prepare("INSERT INTO jobs (id, title, company_name, description, link) VALUES (1, 'React Engineer', 'Example Company', 'React developer role', 'https://example.com/apply')").run();
  db.prepare("INSERT INTO applications (id, job_id, status, resume_path) VALUES (1, 1, 'draft', ?)").run(pdf);
  const at = new Date().toISOString();
  db.prepare("INSERT INTO application_runs (id, job_id, application_id, status, phase, provider, report, created_at, updated_at) VALUES ('smoke-run', 1, 1, 'completed', 'review', 'opencode', 'Selected React experience.', ?, ?)").run(at, at);
  for (const kind of ['base', 'tailored']) db.prepare('INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json) VALUES (?, ?, ?, ?, 1, ?, ?)').run(`smoke-${kind}`, 'smoke-run', kind, pdf, text, '[]');
  // An imported saved resume, rendered on the Resumes page with the same bundled worker.
  db.prepare("INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json) VALUES ('smoke-variant', NULL, 'variant', ?, 1, ?, '[]')").run(pdf, text);
  db.prepare("INSERT INTO resume_variants (id, name, role, stacks_json, origin, status, pdf_artifact_id, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000001', 'Smoke imported resume', 'frontend', '[\"React\"]', 'imported', 'ready', 'smoke-variant', ?, ?)").run(at, at);
  db.close();
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const debugFlag = command.includes("electron-vite") ? `--remoteDebuggingPort=${port}` : `--remote-debugging-port=${port}`;
  child = spawn(command, electronArgs(command, args, [debugFlag]), { env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; });
  child.on('error', error => { output += error.message; });
  const page = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return list.find(item => item.type === 'page');
  });
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.on('message', data => {
    const message = JSON.parse(data.toString());
    if (message.id) { const item = pending.get(message.id); pending.delete(message.id); if (message.error) item?.reject(new Error(message.error.message)); else item?.resolve(message.result); }
  });
  await rpc('Runtime.enable');
  await waitFor(() => evaluate("!!window.desktop && document.readyState === 'complete'"));
  const sources = await evaluate("window.desktop.request('resume-sources')");
  if (sources.config.projectDir !== project || sources.config.mainFile !== 'resume.tex' || sources.config.dataFile !== dataFile) throw new Error('Repository resume sources were not detected automatically');
  await evaluate("location.hash = '/apply?jobId=1&applicationId=1'; true");
  await waitFor(() => evaluate("document.querySelectorAll('.react-pdf__Page__canvas').length === 2 && [...document.querySelectorAll('.react-pdf__Page__canvas')].every(canvas => { if (!canvas.width) return false; const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; for (let i = 0; i < pixels.length; i += 4) if (pixels[i+3] && pixels[i] + pixels[i+1] + pixels[i+2] < 700) return true; return false }) && document.querySelectorAll('.react-pdf__Page__textContent').length === 2 && [...document.querySelectorAll('.react-pdf__Page__textContent')].every(layer => layer.textContent.length > 100)"));
  const content = await evaluate("document.body.textContent.replace(/\\s+/g, ' ')");
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1600, deviceScaleFactor: 1, mobile: false });
  await evaluate("document.querySelector('h1').scrollIntoView({block:'start'}); true");
  const screenshot = await rpc('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const screenshotPath = process.env.WORK_TRACKER_QA_SCREENSHOT;
  if (screenshotPath) writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  if (!content.includes('Seu Nome Completo') || !content.includes('Base PDF') || !content.includes('Tailored PDF')) throw new Error('The two readable PDFs were not displayed: ' + content.slice(-1500));
  if (JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).resumeSources) throw new Error('Automatic detection unexpectedly saved resume settings');
  await evaluate("location.hash = '/resumes'; true");
  // The saved resume's card opens its page, which renders the PDF.
  await waitFor(() => evaluate("(() => { const card = document.querySelector('a[aria-label=\"Smoke imported resume\"]'); card?.click(); return !!card })()"));
  await waitFor(() => evaluate("location.hash.startsWith('#/resume?id=') && document.querySelector('h1')?.textContent === 'Smoke imported resume'"));
  await waitFor(() => evaluate("(() => { const canvas = document.querySelector('.react-pdf__Page__canvas'); if (!canvas?.width) return false; const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let ink = false; for (let i = 0; i < pixels.length; i += 4) if (pixels[i+3] && pixels[i] + pixels[i+1] + pixels[i+2] < 700) { ink = true; break } const layer = document.querySelector('.react-pdf__Page__textContent'); return ink && layer?.textContent.length > 100 })()"));
  console.log(`PASS: Apply detects repository sources without configuration and displays two PDF canvases with selectable text, and Resumes renders a saved resume's PDF (${command})`);
} finally {
  removeSignals();
  await cleanup();
}
