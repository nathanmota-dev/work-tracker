// Synthetic ACP permission handshake. No network, browser, or personal data.
const fs = require('node:fs');
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
let promptId;
let sequence = 0;
const ask = () => send({ id: `permission-${++sequence}`, method: 'session/request_permission', params: {
  sessionId: 'permission-session',
  toolCall: { toolCallId: `call-${sequence}`, title: sequence === 3 ? 'linkedin_search_jobs' : 'linkedin_get_person_profile', kind: 'fetch', rawInput: { username: 'synthetic' } },
  options: [{ optionId: 'refuse-exact', name: 'Refuse', kind: 'reject_once' }, { optionId: 'allow-exact', name: 'Allow once', kind: 'allow_once' }],
} });
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  if (message.method === 'session/new') send({ id: message.id, result: { sessionId: 'permission-session' } });
  if (message.method === 'session/prompt') { promptId = message.id; ask(); }
  if (String(message.id).startsWith('permission-')) {
    fs.appendFileSync(process.env.PERMISSION_RECORD, JSON.stringify(message.result ?? message.error) + '\n');
    if (message.result?.outcome.optionId === 'allow-exact' && sequence < 3) ask();
    else send({ id: promptId, result: { stopReason: 'end_turn' } });
  }
});
