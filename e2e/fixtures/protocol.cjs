// Deterministic ACP agent and MCP server. stdout is exclusively JSON-RPC.
const fs = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const home = process.env.WORK_TRACKER_HOME;
const log = value => fs.appendFileSync(join(home, 'calls.jsonl'), JSON.stringify({ ...value, pid: process.pid }) + '\n');
const scenario = () => JSON.parse(fs.readFileSync(join(home, 'scenario.json'), 'utf8'));
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const update = value => send({ method: 'session/update', params: { sessionId: 'e2e-session', update: value } });
const cli = args => {
  const result = spawnSync(process.env.E2E_NODE, [process.env.WORK_TRACKER_CLI, ...args], { encoding: 'utf8', env: process.env });
  log({ kind: 'cli', args, status: result.status });
  if (result.status !== 0) throw Error(result.stderr || result.stdout);
  return result.stdout;
};
const job = { id: '9001', job_id: '9001', title: 'React Engineer', company_name: 'Example Company', location: 'Remote', url: 'https://example.com/jobs/9001' };
const person = { name: 'Alex Recruiter', username: 'alex-recruiter', headline: 'Technical recruiter', location: 'Remote', profile_url: 'https://www.linkedin.com/in/alex-recruiter/' };
const tools = ['search_jobs', 'search_people', 'get_job_details', 'get_company_profile', 'get_person_profile', 'list_pages'];
log({ kind: 'start', provider: process.env.E2E_PROVIDER });
const permissionWaits = new Map();
let permissionId = 0;
const permission = () => new Promise(resolve => {
  const id = `decision-${++permissionId}`;
  permissionWaits.set(id, resolve);
  send({ id, method: 'session/request_permission', params: {
    sessionId: 'e2e-session', toolCall: { title: 'linkedin_get_person_profile', kind: 'fetch', rawInput: { username: 'synthetic' } },
    options: [{ optionId: 'deny-exact', name: 'Refuse', kind: 'reject_once' }, { optionId: 'approve-exact', name: 'Allow once', kind: 'allow_once' }],
  } });
});
require('node:readline').createInterface({ input: process.stdin }).on('line', async line => {
  const m = JSON.parse(line);
  try {
    if (permissionWaits.has(m.id)) {
      log({ kind: 'permission-result', result: m.result });
      permissionWaits.get(m.id)(m.result);
      permissionWaits.delete(m.id);
      return;
    }
    if (m.method === 'initialize') return send({ id: m.id, result: m.params.protocolVersion === 1 ? { protocolVersion: 1, agentCapabilities: {} } : { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'work-tracker-e2e', version: '1' } } });
    if (m.method === 'tools/list') return send({ id: m.id, result: { tools: tools.map(name => ({ name, description: name, inputSchema: { type: 'object' } })) } });
    if (m.method === 'tools/call') {
      log({ kind: 'mcp', ...m.params });
      const state = scenario();
      if (state.mcp === 'login' && m.params.name === 'get_person_profile') throw Error('LinkedIn login required synthetic-secret');
      if (state.mcp === 'error') throw Error('Synthetic LinkedIn failure');
      if (!tools.includes(m.params.name)) throw Error(`Unexpected MCP tool: ${m.params.name}`);
      let result;
      switch (m.params.name) {
        case 'list_pages': result = [{ url: 'https://example.com', title: 'Synthetic portal' }]; break;
        case 'search_jobs': result = state.mcp === 'empty' ? [] : state.mcp === 'mixed' ? [job,
          { ...job, id: '9002', job_id: '9002', title: 'New Engineer', url: 'https://example.com/jobs/9002' },
          { ...job, id: '9003', job_id: '9003', title: 'Write failure', url: 'https://example.com/jobs/9003' },
          { title: 'Incomplete role', url: 'https://example.com/jobs/9004' },
        ] : [job]; break;
        case 'search_people': result = m.params.arguments.network ? { references: { search_results: [{ url: person.profile_url, text: person.name }] } } : state.mcp === 'empty' ? [] : [person]; break;
        case 'get_job_details': result = { description: 'React developer with TypeScript and Node.js.' }; break;
        case 'get_company_profile': result = { references: { about: [{ kind: 'company_urn', value: '1234' }] } }; break;
        case 'get_person_profile': result = { name: 'Synthetic Candidate', headline: 'React Engineer' }; break;
      }
      if (state.mcp === 'prose') return send({ id: m.id, result: { content: [{ type: 'text', text: 'React Engineer at Example Company https://example.com/jobs/9001' }] } });
      if (state.mcp === 'structured') return send({ id: m.id, result: { content: [], structuredContent: { results: result } } });
      return send({ id: m.id, result: state.mcp === 'text' ? { content: [{ type: 'text', text: JSON.stringify(result) }] } : { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: Array.isArray(result) ? { results: result } : result } });
    }
    if (m.method === 'session/new') {
      log({ kind: 'session', params: m.params });
      return send({ id: m.id, result: { sessionId: 'e2e-session', models: { availableModels: [{ modelId: 'e2e-fast' }, { modelId: 'e2e-careful' }] } } });
    }
    if (m.method === 'session/prompt') {
      const text = m.params.prompt.map(p => p.text ?? '').join('\n');
      const state = scenario();
      log({ kind: 'prompt', text, provider: process.env.E2E_PROVIDER, model: process.env.ANTHROPIC_MODEL ?? process.env.OPENCODE_CONFIG_CONTENT });
      if (state.agent === 'error') throw Error('Synthetic agent failure');
      if (state.agent === 'permission') {
        const result = await permission();
        if (result?.outcome.optionId !== 'approve-exact') return send({ id: m.id, result: { stopReason: 'end_turn' } });
        await permission();
      }
      const pendingLogin = state.agent === 'login';
      update({ sessionUpdate: 'tool_call', toolCallId: 'tool-1', title: 'linkedin_get_person_profile', kind: 'fetch', status: pendingLogin ? 'failed' : 'in_progress', rawInput: { query: 'synthetic' }, content: [{ content: { type: 'text', text: pendingLogin ? 'LinkedIn login is still in progress' : 'Searching synthetic results' } }] });
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Synthetic agent is working. ' } });
      if (pendingLogin) return send({ id: m.id, result: { stopReason: 'end_turn' } });
      if (state.agent === 'hold') return;
      const manifestMatch = text.match(/(?:manifest at |Read )("(?:[^"\\]|\\.)*")/);
      if (manifestMatch) {
        const manifest = JSON.parse(fs.readFileSync(JSON.parse(manifestMatch[1]), 'utf8'));
        if (manifest.resultPath) {
          log({ kind: 'fill', pdfPath: manifest.pdfPath, applicationId: manifest.applicationId, url: manifest.url });
          // Like the skill, match the form labels against the saved answers and report pending fields with their reasons.
          const plan = JSON.parse(cli(['match', '--labels', JSON.stringify(['Phone', 'Gender'])]));
          const fields = { resume: manifest.pdfPath, email: 'candidate@example.com', ...Object.fromEntries(plan.matched.map(entry => [entry.key, entry.value])) };
          const unfilled = plan.unfilled.map(({ label, key, skip }) => ({ label, key, reason: skip }));
          fs.writeFileSync(manifest.resultPath, JSON.stringify({ versionId: manifest.versionId, pdfHash: manifest.pdfHash, pdfPath: manifest.pdfPath, fields, unfilled, externalUrl: manifest.url, portal: 'generic' }));
        } else {
          log({ kind: 'tailor', profile: JSON.parse(fs.readFileSync(manifest.profilePath, 'utf8')) });
          const file = join(manifest.project, manifest.mainFile);
          fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Base resume.', state.agent === 'invalid-latex' ? '\\undefinedE2ECommand' : state.agent === 'layout-hole' ? 'Tailored resume.\\par\\vspace{250pt}Detail pushed down by a gap.\\par' : 'Tailored resume.'));
          fs.writeFileSync(manifest.selectionPath, JSON.stringify({ language: 'en', selectedProjects: ['React'] }));
          fs.writeFileSync(manifest.reportPath, 'Emphasized React and TypeScript experience.');
        }
      } else if (/work-tracker-job-scout/.test(text)) {
        cli(['job', 'save', '--linkedin-id', '9001', '--title', job.title, '--company', job.company_name, '--work-type', 'remote', '--fit', 'strong', '--link', job.url]);
      } else if (/work-tracker-profile-optimizer/.test(text)) {
        cli(['metric', 'record', '--score', '88', '--profile-views', '42', '--search-appearances', '20', '--connections', '100', '--breakdown', JSON.stringify([{ label: 'Headline', value: 'Strong' }])]);
      } else if (/work-tracker-recruiter-outreach/.test(text)) {
        cli(['recruiter', 'add', '--name', person.name, '--username', person.username, '--company', 'Example Company', '--status', 'pending']);
        cli(['outreach', 'log', '--username', person.username, '--company-urn', '1234', '--company', 'Example Company', '--state', 'invited', '--channel', 'connect_note']);
      } else if (/work-tracker-followup/.test(text)) {
        // Like the skill, store a 60-120 word draft and leave sending to the user.
        const applicationId = text.match(/application #(\d+)/)[1];
        const kind = /kind thank_you/.test(text) ? 'thank_you' : 'follow_up';
        const event = text.match(/Stage event: (\d+)/)?.[1];
        const file = join(home, 'artifacts', 'followups', `${applicationId}-${kind}.md`);
        fs.mkdirSync(join(home, 'artifacts', 'followups'), { recursive: true });
        fs.writeFileSync(file, `Hello hiring team,\n\n${kind === 'thank_you' ? 'Thank you for the conversation about' : 'I remain very interested in'} the Engineer role. ${'My submitted resume shows React and TypeScript work on production interfaces used every day by customers. '.repeat(4)}Could you share when the team expects to decide on next steps?\n\nBest regards,\nSynthetic Candidate`);
        cli(['followup', 'save', '--application-id', applicationId, '--kind', kind, '--channel', 'email', '--subject', `${kind === 'thank_you' ? 'Thank you' : 'Following up'}: Engineer`, '--file', file, ...(event ? ['--stage-event', event] : [])]);
      } else if (/work-tracker-job-ranking/.test(text)) {
        // Like the skill: query the candidates, then score and save each posting right away.
        const flags = (text.match(/`work-tracker ranking candidates([^`]*)`/)?.[1] ?? '').trim().split(/\s+/).filter(Boolean);
        const { items } = JSON.parse(cli(['ranking', 'candidates', ...flags]));
        fs.mkdirSync(join(home, 'artifacts', 'rankings'), { recursive: true });
        for (const item of items) {
          const score = Number(item.description?.match(/Synthetic score (\d+)/)?.[1] ?? 70);
          const result = item.description
            ? { status: 'scored', scores: { technical: score, experience: score, career: score }, strengths: [`Posting asks for React at ${item.company}`], gaps: ['No synthetic Kubernetes experience'] }
            : { status: 'unreachable', fetch_error: '404 Not Found' };
          const file = join(home, 'artifacts', 'rankings', `${item.job_id}.json`);
          fs.writeFileSync(file, JSON.stringify(result));
          cli(['ranking', 'save', '--job-id', String(item.job_id), '--file', file]);
        }
      } else if (/work-tracker-interview-prep/.test(text)) {
        // Like the skill: read the company research cache first, research and write back only on a miss.
        const id = text.match(/application #(\d+)/)[1];
        const { company } = JSON.parse(cli(['application', 'show', '--id', id]));
        const cached = JSON.parse(cli(['company-research', 'get', '--company', company]));
        if (!cached.fresh) {
          log({ kind: 'research', company });
          const research = join(home, 'research.json');
          fs.writeFileSync(research, JSON.stringify({ sources: { website: { url: 'https://example.com/about', notes: 'Synthetic mission' } }, summary: 'Synthetic research' }));
          cli(['company-research', 'save', '--company', company, '--file', research]);
        }
        const pack = join(home, 'pack.md');
        fs.writeFileSync(pack, `# ${company}\n\n${cached.fresh ? 'Reused cached research.' : 'Fresh research.'}\n`);
        cli(['interview-prep', 'save', '--application-id', id, '--stage', text.match(/Stage: ([^.]+)\./)?.[1] ?? 'Recruiter screen', '--file', pack]);
      } else if (/work-tracker-requirements-check/.test(text)) {
        // Like the skill, quote each requirement of the saved description and store the extraction.
        const ids = text.match(/saved jobs: ([\d,]+)/)[1].split(',');
        const jobs = JSON.parse(cli(['job', 'list']));
        for (const id of ids) {
          const description = jobs.find(row => String(row.id) === id)?.description ?? '';
          const languages = [...description.matchAll(/[^.]*\bfluent (\w+)[^.]*\./gi)].map(([quote, language]) => ({ language, stated_bar: 'fluent', bar_above_declared: true, quote: quote.trim() }));
          const citizen = description.match(/[^.]*citizen[^.]*\./i)?.[0].trim();
          const file = join(home, `gate-${id}.json`);
          fs.writeFileSync(file, JSON.stringify({ languages, eligibility: { requires_citizenship_or_pr: !!citizen, requires_clearance: false, names_permit_or_sponsors: false, program_confirmed: 'unknown', ...(citizen ? { quote: citizen } : {}) } }));
          cli(['job', 'gate', '--id', id, '--file', file]);
        }
      } else if (/work-tracker-experience-bank/.test(text)) {
        fs.mkdirSync(join(home, 'experience'), { recursive: true });
        fs.writeFileSync(join(home, 'experience', 'synthetic.md'), '# Synthetic achievement\nBuilt a React app.\n');
      }
      cli(['activity', 'log', '--skill', text.match(/work-tracker-[a-z-]+/)?.[0] ?? 'synthetic', '--summary', 'Synthetic workflow completed']);
      update({ sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: 'completed', content: [{ content: { type: 'text', text: 'Synthetic tool completed' } }] });
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Synthetic workflow completed.' } });
      return send({ id: m.id, result: { stopReason: 'end_turn' } });
    }
    if (m.id !== undefined) throw Error(`Unexpected RPC method: ${m.method}`);
  } catch (error) { send({ id: m.id, error: { code: -32000, message: error.message } }); }
});
