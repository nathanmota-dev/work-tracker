const readline = require('node:readline');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const mode = process.env.FIXTURE_MODE;
if (process.env.FIXTURE_START_LOG) fs.appendFileSync(process.env.FIXTURE_START_LOG, JSON.stringify({ pid: process.pid, argv: process.argv.slice(2) }) + '\n');
if (mode === 'exit') process.exit(7);
if (mode === 'tree' || mode === 'auth-retry') {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  fs.writeFileSync(process.env.FIXTURE_PID, String(child.pid));
}
const send = m => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
let prompts = 0;
readline.createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  if (mode === 'hang') return;
  if (m.method === 'initialize') send({ id: m.id, result: m.params.protocolVersion === 1 ? { protocolVersion: 1, agentCapabilities: {} } : { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } });
  if (m.method === 'tools/list') send({ id: m.id, result: { tools: [{ name: 'echo', description: 'Synthetic echo', inputSchema: { type: 'object' } }] } });
  if (m.method === 'tools/call') send({ id: m.id, result: { isError: m.params.name === 'fail', content: [{ type: 'text', text: JSON.stringify(m.params.arguments) }] } });
  if (m.method === 'session/new') {
    if (process.env.FIXTURE_RECORD) fs.writeFileSync(process.env.FIXTURE_RECORD, JSON.stringify({
      params: m.params, home: process.env.WORK_TRACKER_HOME, path: process.env.PATH,
      cwd: process.cwd(),
      env: Object.fromEntries(['OPENCODE_CONFIG_CONTENT', 'ANTHROPIC_MODEL', 'CLAUDECODE',
        'CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'OPENCODE_CONFIG_DIR',
        'FIXTURE_CUSTOM_ENV'].map(key => [key, process.env[key]])),
    }));
    send({ id: m.id, result: mode === 'invalid' ? {} : {
      sessionId: 'synthetic-session', models: { availableModels: JSON.parse(process.env.FIXTURE_MODELS || '[]') },
    } });
  }
  if (m.method === 'session/prompt') {
    if (mode === 'auth-retry') {
      prompts++;
      send({ method: 'session/update', params: { sessionId: 'synthetic-session', update: {
        sessionUpdate: 'tool_call', toolCallId: `profile-${prompts}`, title: 'linkedin_get_person_profile',
        status: prompts === 1 ? 'failed' : 'completed', content: [{ content: {
          type: 'text', text: prompts === 1 ? 'LinkedIn login is still in progress' : 'Retrieved profile',
        } }],
      } } });
    }
    send({ method: 'session/update', params: { sessionId: 'synthetic-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'synthetic stream' } } } });
    if (mode !== 'cancel') send({ id: m.id, result: { stopReason: 'end_turn' } });
  }
});
