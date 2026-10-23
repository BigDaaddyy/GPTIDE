const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { load } = require('../builtin/codex-history.cjs');
const meta = (id, cwd, extra = {}) => ({ type: 'session_meta', payload: { id, cwd, ...extra } });
const event = (type, extra = {}) => ({ type: 'event_msg', timestamp: '2026-01-01T00:00:00Z', payload: { type, ...extra } });
const response = (role, text, extra = {}) => ({ type: 'response_item', timestamp: '2026-01-01T00:00:00Z', payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }], ...extra } });
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-codex-history-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const project = path.join(home, 'project');
  function write(name, rows, directory = 'sessions/2026/01/01') {
    const file = path.join(home, directory, name + '.jsonl'); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n'); return file;
  }
  return { home, project, write, read: () => load({ project, codexHome: home }) };
}
test('Codex import is project scoped and excludes child projects and subagents', async t => {
  const f = fixture(t);
  for (const [id, cwd, extra] of [['own', f.project, {}], ['foreign', path.join(f.home, 'other'), {}], ['child', path.join(f.project, 'child'), {}], ['agent', f.project, { source: { subagent: { other: 'guardian' } } }]]) f.write(id, [meta(id, cwd, extra), response('user', id)]);
  const result = await f.read(); assert.deepEqual(result.chats.map(chat => chat.id), ['codex:own']);
  assert.equal(result.chats[0].source, 'codex'); assert.equal(result.chats[0].threadId, undefined);
  assert.deepEqual(await load({ project: null, codexHome: f.home }), { chats: [], warnings: [] });
});
test('Codex public events avoid duplicate replies, injected context and private reasoning', async t => {
  const f = fixture(t);
  f.write('events', [meta('events', f.project), event('task_started'), response('developer', 'private instruction'), response('user', 'context and request'), event('user_message', { message: 'Fix the bug' }), response('assistant', 'secret reasoning', { channel: 'analysis' }), response('assistant', 'Fixed'), event('agent_message', { message: 'Fixed' }), event('task_complete')]);
  const result = await f.read(); assert.deepEqual(result.chats[0].messages.map(m => m.text), ['Fix the bug', 'Fixed']);
});
test('Codex desktop completed items and response-only histories are supported', async t => {
  const f = fixture(t);
  f.write('desktop', [meta('desktop', f.project), event('task_started'), event('item_completed', { item: { type: 'UserMessage', id: 'user', content: [{ type: 'text', text: '<environment_context>injected</environment_context>' }, { type: 'text', text: 'Implement it' }] } }), event('item_completed', { item: { type: 'AgentMessage', id: 'agent', content: [{ type: 'Text', text: '**Done**\n```js\n1\n```' }] } }), event('task_complete')]);
  f.write('legacy', [meta('legacy', f.project), response('user', 'Old request'), response('assistant', 'Old answer')]);
  const chats = (await f.read()).chats;
  assert.deepEqual(chats.find(c => c.id === 'codex:desktop').messages.map(m => m.text), ['Implement it', '**Done**\n```js\n1\n```']);
  assert.equal(chats.find(c => c.id === 'codex:legacy').messages.length, 2);
});
test('Codex project changes filter individual turns instead of leaking other projects', async t => {
  const f = fixture(t), foreign = path.join(f.home, 'other');
  f.write('changed', [meta('changed', foreign), event('task_started'), event('user_message', { message: 'own request' }), { type: 'turn_context', payload: { cwd: f.project } }, event('agent_message', { message: 'own answer' }), event('task_complete'), event('task_started'), event('user_message', { message: 'foreign request' }), { type: 'turn_context', payload: { cwd: foreign } }, event('agent_message', { message: 'foreign answer' }), event('task_complete')]);
  assert.deepEqual((await f.read()).chats[0].messages.map(m => m.text), ['own request', 'own answer']);
});
test('Codex context windows merge with stable IDs and preserve repeated user instructions', async t => {
  const f = fixture(t), item = (id, text) => event('item_completed', { item: { id, type: 'UserMessage', content: [{ type: 'text', text }] } });
  f.write('window-one', [meta('shared', f.project), item('first', 'Continue'), item('second', 'Continue')]);
  f.write('window-two', [meta('shared', f.project), item('second', 'Continue'), item('third', 'New request')]);
  const result = await f.read(); assert.equal(result.chats.length, 1); assert.deepEqual(result.chats[0].messages.map(m => m.text), ['Continue', 'Continue', 'New request']);
});
test('Codex reads optional titles and archives without changing original files, and refreshes live logs', async t => {
  const f = fixture(t), file = f.write('live', [meta('live', f.project), response('user', 'First')]);
  f.write('old', [meta('old', f.project), response('user', 'Archived')], 'archived_sessions');
  fs.writeFileSync(path.join(f.home, 'session_index.jsonl'), JSON.stringify({ id: 'live', thread_name: 'My title' }) + '\n{partial');
  const before = fs.readFileSync(file, 'utf8'); let result = await f.read();
  assert.equal(result.chats.find(c => c.id === 'codex:live').name, 'My title'); assert.equal(result.chats.find(c => c.id === 'codex:old').archived, true);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  fs.appendFileSync(file, JSON.stringify(response('assistant', 'Second')) + '\n{partial');
  result = await f.read(); assert.equal(result.chats.find(c => c.id === 'codex:live').messages.length, 2);
  assert.equal(result.warnings.length, 0);
});
test('Codex absent directories and partially written sessions do not block startup', async t => {
  const f = fixture(t); assert.deepEqual(await f.read(), { chats: [], warnings: [] });
  const file = f.write('partial', [meta('partial', f.project), response('user', 'Visible')]);
  fs.appendFileSync(file, '{incomplete'); assert.equal((await f.read()).chats[0].messages[0].text, 'Visible');
});
