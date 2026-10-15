#!/usr/bin/env node
// Only the launch/DevTools handshake is simulated; no real browser or account.
const { createServer } = require('node:http');
const { writeFileSync, appendFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const home = process.env.WORK_TRACKER_HOME;
const scenario = JSON.parse(readFileSync(join(home, 'scenario.json'), 'utf8'));
appendFileSync(join(home, 'calls.jsonl'), JSON.stringify({ kind: 'chrome', args: process.argv.slice(2), pid: process.pid }) + '\n');
if (scenario.chrome === 'error') process.exit(3);
const profile = process.argv.find(arg => arg.startsWith('--user-data-dir=')).split('=').slice(1).join('=');
const path = '/devtools/browser/e2e';
const server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}${path}` })); });
server.listen(0, '127.0.0.1', () => writeFileSync(join(profile, 'DevToolsActivePort'), `${server.address().port}\n${path}\n`));
