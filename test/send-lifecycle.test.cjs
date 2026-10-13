const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const config = { get: (key, fallback) => fallback };
const vscode = { workspace: { isTrusted: true, getConfiguration: () => config }, window: {} };
vscode.CancellationTokenSource = class {
  constructor() { this.listeners = new Set(); this.token = { isCancellationRequested: false, onCancellationRequested: callback => { this.listeners.add(callback); return { dispose: () => this.listeners.delete(callback) }; } }; }
  cancel() { this.token.isCancellationRequested = true; for (const callback of this.listeners) callback(); }
  dispose() { this.listeners.clear(); }
};
const originalRequire = Module.prototype.require;
let Chat;
try { Module.prototype.require = function(id) { return id === 'vscode' ? vscode : originalRequire.apply(this, arguments); }; Chat = require('../builtin/extension.cjs').Chat; }
finally { Module.prototype.require = originalRequire; }
function fixture() {
  const chat = Object.create(Chat.prototype), record = { id: 'one', projectKey: 'project', source: 'gptide', name: 'existing', messages: [], draft: 'submitted' };
  Object.assign(chat, { ready: Promise.resolve(), project: process.cwd(), projectKey: 'project', activeId: 'one', chats: [record], openChatIds: ['one'], messages: record.messages, attachments: [], threadId: 'thread', resumed: true, account: { type: 'chatgpt' }, model: 'fixture', effort: 'medium', busy: false, post: () => {}, save: () => true, view: { webview: { postMessage: () => {} } }, drafts: { set: () => {} } });
  return chat;
}
test('account refresh keeps prior state until both responses arrive and discards a disconnected result', async () => {
  const chat = fixture(); let finishModels; const calls = [];
  chat.bridge = { call: async method => { calls.push(method); if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'plus' } }; return new Promise(resolve => { finishModels = resolve; }); } };
  const pending = chat.refreshAccount(); await Promise.resolve(); await Promise.resolve();
  assert.equal(chat.account.plan, undefined); chat.bridge = null;
  finishModels({ data: [{ model: 'old', isDefault: true }] }); await pending;
  assert.equal(chat.model, 'fixture'); assert.equal(chat.account.plan, undefined); assert.deepEqual(calls, ['account/read', 'model/list']);
});
test('only the latest account refresh may publish account and model state', async () => {
  const chat = fixture(); let firstRead, calls = 0, posts = 0; chat.post = () => posts++;
  chat.bridge = { call: async method => {
    calls++;
    if (method === 'account/read' && calls === 1) return new Promise(resolve => { firstRead = resolve; });
    return method === 'account/read' ? { account: { type: 'chatgpt', planType: 'plus' } } : { data: [{ model: 'new', isDefault: true, defaultReasoningEffort: 'high' }] };
  } };
  const old = chat.refreshAccount(); await chat.refreshAccount();
  firstRead({ account: { type: 'chatgpt', planType: 'old' } }); await old;
  assert.equal(chat.account.plan, 'plus'); assert.equal(chat.model, 'new'); assert.equal(chat.effort, 'high'); assert.equal(posts, 1); assert.equal(calls, 3);
});
test('stale account refresh errors cannot overwrite a new connection', async () => {
  const chat = fixture(); let fail;
  chat.bridge = { call: () => new Promise((resolve, reject) => { fail = reject; }) };
  const old = chat.refreshAccount(); chat.bridge = { call: async () => { throw new Error('current failure'); } };
  fail(new Error('old failure')); await old;
  await assert.rejects(chat.refreshAccount(), /current failure/);
});
test('preparing a send locks its conversation and ignores duplicate send', async () => {
  const chat = fixture(); let finishConnect, calls = 0;
  chat.connect = () => new Promise(resolve => { finishConnect = resolve; });
  const pending = chat.send('submitted', 'ask', false); await Promise.resolve();
  assert.equal(chat.busy, true); chat.newChat(); assert.equal(chat.activeId, 'one');
  await chat.send('duplicate', 'ask', false);
  finishConnect({ call: async method => { calls++; assert.equal(method, 'turn/start'); return { turn: { id: 'turn' } }; } });
  await pending; assert.equal(calls, 1); assert.equal(chat.messages.length, 1); assert.equal(chat.messages[0].text, 'submitted');
});
test('canceling preparation avoids any turn and keeps the draft', async () => {
  const chat = fixture(); let finishConnect, calls = 0;
  chat.connect = () => new Promise(resolve => { finishConnect = resolve; });
  const pending = chat.send('submitted', 'ask', false); await Promise.resolve(); chat.cancelPendingSend = true;
  finishConnect({ call: async () => { calls++; } });
  await assert.rejects(pending, /已取消/); assert.equal(calls, 0); assert.equal(chat.busy, false); assert.equal(chat.chats[0].draft, 'submitted');
});
test('turn acknowledgment never clears text typed after submission', async () => {
  const chat = fixture(); let finishTurn;
  chat.connect = async () => ({ call: () => new Promise(resolve => { finishTurn = resolve; }) });
  const pending = chat.send('submitted', 'ask', false);
  await Promise.resolve(); await Promise.resolve(); chat.persistDraft('one', 'next message');
  finishTurn({ turn: { id: 'turn' } }); await pending;
  assert.equal(chat.chats[0].draft, 'next message');
});
test('loading never exposes unverified chat ids or drafts and unknown selection preserves active chat', () => {
  const chat = fixture(); let payload;
  chat.post = Chat.prototype.post; chat.view.webview.postMessage = value => { payload = value; };
  chat.loadingScope = true; chat.chats[0].projectKey = undefined; chat.chats[0].draft = 'private unverified draft';
  chat.post(); assert.equal(payload.activeId, null); assert.equal(payload.draft, ''); assert.deepEqual(payload.chats, []); assert.deepEqual(payload.messages, []);
  chat.loadingScope = false; chat.chats[0].projectKey = 'project'; chat.chatAttachments = new Map();
  assert.equal(chat.select('foreign-id'), false); assert.equal(chat.activeId, 'one');
});
test('export command writes the complete selected project conversation and rejects foreign records', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-export-'));
  try {
    const file = path.join(root, 'export.md'), chat = fixture();
    chat.chats[0].messages = Array.from({ length: 300 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'QA message ' + i }));
    chat.chats[0].tasks = [{ turn: 1, status: 'failed', title: 'QA command', output: 'QA task output' }];
    vscode.Uri = { file: file => ({ fsPath: file }) };
    vscode.window.showQuickPick = async () => [{ kind: 'tasks' }, { kind: 'draft' }];
    vscode.window.showSaveDialog = async () => ({ fsPath: file });
    vscode.workspace.fs = { writeFile: async (uri, buffer) => fs.writeFileSync(uri.fsPath, buffer) };
    vscode.workspace.openTextDocument = async uri => uri;
    vscode.window.showTextDocument = async () => {};
    await chat.exportChat(); const output = fs.readFileSync(file, 'utf8');
    assert.ok(output.includes('QA message 0')); assert.ok(output.includes('QA message 299')); assert.ok(output.includes('QA task output')); assert.ok(output.includes('未发送草稿'));
    chat.chats[0].projectKey = 'another-project'; vscode.window.showSaveDialog = async () => { throw new Error('Foreign export must never show a save dialog'); };
    await chat.exportChat(); assert.equal(fs.readFileSync(file, 'utf8'), output);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('old checkpoints restore in order, reject later edits and support explicit redo', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-restore-'));
  try {
    const file = path.join(root, 'a.txt'), chat = fixture(); chat.project = root;
    chat.checkpointStore = new (require('../builtin/checkpoints.cjs').Checkpoints)(path.join(root, 'cache'), root, 'project');
    const first = chat.checkpointStore.create([{ path: file, before: 'A\r\n', after: 'B\r\n' }], 1);
    const second = chat.checkpointStore.create([{ path: file, before: 'B\r\n', after: 'C\r\n' }], 2);
    chat.chats[0].checkpoints = [first, second]; fs.writeFileSync(file, 'C\r\n');
    vscode.workspace.textDocuments = [];
    vscode.Uri = { file: value => ({ fsPath: value, scheme: 'file' }) };
    let complete;
    vscode.workspace.fs = { writeFile: async (uri, data) => { await new Promise(resolve => { complete = resolve; }); fs.writeFileSync(uri.fsPath, data); } };
    chat.selectCheckpoint(first.id); await assert.rejects(chat.revert(file), /后续修改/);
    chat.selectCheckpoint(second.id); const restoring = chat.revert(file); await Promise.resolve();
    assert.equal(chat.reviewBusy, true); chat.selectCheckpoint(first.id); assert.equal(chat.activeCheckpointId, second.id);
    complete(); await restoring; assert.equal(fs.readFileSync(file, 'utf8'), 'B\r\n'); assert.equal(second.changes[0].status, 'reverted');
    vscode.workspace.fs.writeFile = async (uri, data) => fs.writeFileSync(uri.fsPath, data);
    chat.selectCheckpoint(first.id); await chat.revert(file); assert.equal(fs.readFileSync(file, 'utf8'), 'A\r\n');
    await chat.revert(file, true); assert.equal(fs.readFileSync(file, 'utf8'), 'B\r\n'); assert.equal(first.changes[0].status, 'pending');
    vscode.workspace.textDocuments = [{ uri: vscode.Uri.file(file), isDirty: true }];
    await assert.rejects(chat.revert(file), /未保存/); vscode.workspace.textDocuments = [];
    fs.writeFileSync(file, 'manual edit'); await assert.rejects(chat.revert(file), /后续修改/);
    assert.equal(chat.reviewBusy, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('manual cache cleanup retains backup and conflict recovery references', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-cleanup-'));
  try {
    const chat = fixture(); chat.project = root; chat.data = root; chat.stateFile = path.join(root, 'project.json');
    chat.checkpointStore = new (require('../builtin/checkpoints.cjs').Checkpoints)(path.join(root, 'cache'), root, 'project');
    const records = ['backup', 'conflict', 'unused'].map(text => chat.checkpointStore.create([{ path: path.join(root, text), before: null, after: text }]));
    for (const record of records) { const time = new Date(Date.now() - 120000); fs.utimesSync(path.join(chat.checkpointStore.blobs, record.changes[0].afterRef), time, time); }
    fs.writeFileSync(chat.stateFile, JSON.stringify({ projectKey: 'project', chats: [] }));
    fs.writeFileSync(chat.stateFile + '.bak', JSON.stringify({ projectKey: 'project', chats: [{ checkpoints: [records[0]] }] }));
    fs.writeFileSync(chat.stateFile + '.conflict-qa.json', JSON.stringify({ projectKey: 'project', chats: [{ checkpoints: [records[1]] }] }));
    vscode.window.showInformationMessage = () => {};
    chat.cleanupCheckpoints(); assert.equal(chat.checkpointStore.get(records[0].changes[0].afterRef), 'backup'); assert.equal(chat.checkpointStore.get(records[1].changes[0].afterRef), 'conflict');
    assert.throws(() => chat.checkpointStore.get(records[2].changes[0].afterRef), /缺失/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('approval rejects foreign turns and replies to original bridge after a connection changes', async () => {
  const chat = fixture(), replies = [], newReplies = []; chat.busy = true; chat.turnId = 'current'; chat.bridge = { reply: (id, result) => replies.push(result), send: () => {} };
  const request = { id: 1, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', turnId: 'current', command: 'fixture' } };
  vscode.window.showWarningMessage = () => { throw new Error('Foreign request must not open a prompt'); };
  await chat.approve({ ...request, params: { ...request.params, threadId: 'foreign' } }); await chat.approve({ ...request, params: { ...request.params, turnId: 'old' } }); assert.deepEqual(replies, [{ decision: 'decline' }, { decision: 'decline' }]);
  let resolve, prompts = 0; vscode.window.showWarningMessage = () => { prompts++; return new Promise(done => { resolve = done; }); };
  const origin = chat.bridge, pending = chat.approve(request, origin); await chat.approve(request, origin); assert.equal(prompts, 1);
  chat.bridge = { reply: (id, result) => newReplies.push(result) }; resolve('允许此次'); await pending;
  assert.deepEqual(replies.at(-1), { decision: 'decline' }); assert.deepEqual(newReplies, []);
});

test('resolved Agent questions cancel native prompt and never send duplicate answers', async () => {
  const chat = fixture(), replies = []; chat.busy = true; chat.turnId = 'current'; chat.bridge = { reply: (id, result) => replies.push(result), send: () => {} };
  const request = { id: 'input', method: 'item/tool/requestUserInput', params: { threadId: 'thread', turnId: 'current', questions: [{ id: 'a', header: 'A', question: 'Choose', options: [{ label: 'A', description: 'First' }] }] } };
  vscode.window.showQuickPick = (items, options, token) => new Promise(resolve => { token.onCancellationRequested(() => resolve(undefined)); });
  const pending = chat.approve(request); chat.onNotification({ method: 'serverRequest/resolved', params: { requestId: 'input', threadId: 'thread' } }); await pending;
  assert.deepEqual(replies, []); assert.equal(chat.pendingRequests.size, 0); assert.equal(chat.messages.length, 0);
});

test('late events cannot finish newer turns or append messages to idle conversations', () => {
  const chat = fixture(); chat.busy = true; chat.turnId = 'new'; chat.tasks = []; chat.currentTaskTurn = 2;
  chat.onNotification({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'old', status: 'completed' } } }); assert.equal(chat.busy, true);
  chat.onNotification({ method: 'item/agentMessage/delta', params: { threadId: 'foreign', turnId: 'new', itemId: 'item', delta: 'foreign' } }); assert.equal(chat.messages.length, 0);
  chat.onNotification({ method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'new', itemId: 'item', delta: 'current' } }); assert.equal(chat.messages[0].text, 'current');
  chat.onNotification({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'new', status: 'completed' } } }); assert.equal(chat.busy, false);
  chat.onNotification({ method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'new', itemId: 'item', delta: 'late' } }); assert.equal(chat.messages[0].text, 'current');
  chat.busy = true; chat.turnId = null;
  chat.onNotification({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'new' } } }); assert.equal(chat.turnId, null);
  chat.onNotification({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'next' } } }); assert.equal(chat.turnId, 'next');
});

test('terminal errors retain partial file checkpoints and mark unfinished tasks failed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-failed-turn-'));
  try {
    const file = path.join(root, 'a.txt'), chat = fixture(); chat.project = root; chat.busy = true; chat.turnId = 'turn'; chat.currentTaskTurn = 1;
    chat.checkpointStore = new (require('../builtin/checkpoints.cjs').Checkpoints)(path.join(root, 'cache'), root, 'project');
    fs.writeFileSync(file, 'before'); chat.baseline = require('../builtin/review.cjs').snapshot(root); fs.writeFileSync(file, 'partial edit'); chat.candidates = new Map([[file, 'update']]);
    chat.tasks = [{ id: 'command', turnId: 'turn', status: 'running' }];
    chat.onNotification({ method: 'error', params: { threadId: 'thread', turnId: 'turn', willRetry: false, error: { message: 'fixture disconnection' } } });
    assert.equal(chat.busy, false); assert.equal(chat.tasks[0].status, 'failed'); assert.equal(chat.chats[0].checkpoints.length, 1); assert.equal(chat.checkpointStore.materialize(chat.changes[0]).after, 'partial edit'); assert.equal(chat.baseline, null);
    chat.onNotification({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } }); assert.equal(chat.chats[0].checkpoints.length, 1); assert.equal(chat.status, 'fixture disconnection');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('same text retyped after submission and next attachments survive late acknowledgment', async () => {
  const chat = fixture(); let complete;
  chat.attachments = [{ id: 'sent', label: 'sent', text: 'fixture' }];
  chat.connect = async () => ({ call: () => new Promise(resolve => { complete = resolve; }) });
  const pending = chat.send('submitted', 'ask', false, 'client-one'); await Promise.resolve(); await Promise.resolve();
  chat.persistDraft('one', 'changed'); chat.persistDraft('one', 'submitted'); chat.attachments.push({ id: 'next', label: 'next', text: 'next fixture' });
  complete({ turn: { id: 'turn' } }); await pending;
  assert.equal(chat.chats[0].draft, 'submitted'); assert.deepEqual(chat.attachments.map(a => a.id), ['next']);
});

test('old RPC acknowledgment cannot overwrite a newer active turn', async () => {
  const chat = fixture(), complete = [], acknowledgments = []; chat.tasks = [];
  chat.view.webview.postMessage = value => { if (value.type === 'sent') acknowledgments.push(value.clientSendId); };
  chat.connect = async () => ({ call: () => new Promise(resolve => complete.push(resolve)) });
  const first = chat.send('submitted', 'ask', false, 'first'); await Promise.resolve(); await Promise.resolve();
  chat.onNotification({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'first-turn' } } }); assert.deepEqual(acknowledgments, ['first']);
  chat.onNotification({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'first-turn', status: 'completed' } } });
  chat.persistDraft('one', 'next'); const second = chat.send('next', 'ask', false, 'second'); await Promise.resolve(); await Promise.resolve();
  chat.onNotification({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'second-turn' } } }); chat.persistDraft('one', 'later draft');
  complete[0]({ turn: { id: 'first-turn' } }); await first; assert.equal(chat.turnId, 'second-turn'); assert.equal(chat.busy, true); assert.equal(chat.chats[0].draft, 'later draft');
  complete[1]({ turn: { id: 'second-turn' } }); await second; assert.deepEqual(acknowledgments, ['first', 'second']); assert.equal(chat.chats[0].draft, 'later draft');
});

test('cancel during thread lookup starts no turn and confirmation timeout preserves running task', async () => {
  const chat = fixture(); chat.resumed = false; let lookup, turnCalls = 0;
  chat.connect = async () => ({ call: method => { if (method === 'thread/read') return new Promise(resolve => { lookup = resolve; }); turnCalls++; throw new Error('No turn may start'); } });
  const canceled = chat.send('submitted', 'ask', false); await Promise.resolve(); await Promise.resolve(); chat.cancelPendingSend = true; lookup({ thread: { cwd: chat.project } });
  await assert.rejects(canceled, /已取消/); assert.equal(turnCalls, 0); assert.equal(chat.busy, false);
  chat.resumed = true; let reject;
  chat.connect = async () => ({ call: () => new Promise((resolve, failed) => { reject = failed; }) });
  const running = chat.send('submitted', 'ask', false); await Promise.resolve(); await Promise.resolve();
  chat.onNotification({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'running' } } }); reject(new Error('RPC timeout')); await running;
  assert.equal(chat.busy, true); assert.equal(chat.turnId, 'running'); assert.equal(chat.status, '任务已启动，等待后续状态');
});

test('old RPC failure leaves newer send state intact', async () => {
  const chat = fixture(); let rejectFirst, resolveSecond, calls = 0; chat.tasks = [];
  chat.connect = async () => ({ call: () => ++calls === 1 ? new Promise((resolve, reject) => { rejectFirst = reject; }) : new Promise(resolve => { resolveSecond = resolve; }) });
  const first = chat.send('submitted', 'ask', false); await Promise.resolve(); await Promise.resolve();
  chat.onNotification({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'first', status: 'completed' } } });
  chat.persistDraft('one', 'next'); const second = chat.send('next', 'ask', false); await Promise.resolve(); await Promise.resolve();
  rejectFirst(new Error('old RPC failure')); await first; assert.equal(chat.busy, true); assert.equal(chat.status, '正在思考');
  resolveSecond({ turn: { id: 'second' } }); await second; assert.equal(chat.turnId, 'second');
});

test('long Cursor import confirmation keeps conversation locked and cancellation preserves source', async () => {
  const chat = fixture(); chat.chats[0].source = 'cursor'; chat.chats[0].messages = [{ role: 'user', text: 'x'.repeat(200000) }]; let answer, calls = 0;
  chat.connect = async () => ({ call: async () => { calls++; throw new Error('No turn should start'); } });
  vscode.window.showWarningMessage = () => new Promise(resolve => { answer = resolve; });
  const pending = chat.send('submitted', 'ask', false); await Promise.resolve(); await Promise.resolve();
  assert.equal(chat.busy, true); chat.newChat(); assert.equal(chat.activeId, 'one'); answer(undefined); await pending;
  assert.equal(chat.busy, false); assert.equal(calls, 0); assert.equal(chat.chats.length, 1); assert.equal(chat.chats[0].source, 'cursor'); assert.equal(chat.chats[0].draft, 'submitted');
});

test('project login cannot connect during a running task and disposal invalidates pending prompts', async () => {
  const chat = fixture(); chat.busy = true; chat.connect = () => { throw new Error('No login connection allowed'); };
  await assert.rejects(chat.login(), /当前任务/);
  let canceled = false, disposed = 0;
  chat.pendingRequests = new Map([['request', { resolved: false, token: { cancel: () => { canceled = true; } } }]]); chat.bridge = { dispose: () => { disposed++; } };
  chat.dispose(); assert.equal(chat.invalidated, true); assert.equal(canceled, true); assert.equal(chat.pendingRequests.get('request').resolved, true); assert.equal(disposed, 1);
});

test('stream bursts coalesce state snapshots and final message flushes pending updates immediately', async () => {
  const chat = fixture(), snapshots = []; chat.post = Chat.prototype.post; chat.busy = true; chat.turnId = 'stream'; chat.tasks = [];
  chat.view.webview.postMessage = state => snapshots.push(state);
  for (let i = 0; i < 100; i++) chat.onNotification({ method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'stream', itemId: 'message', delta: 'x' } });
  assert.equal(snapshots.length, 0); await new Promise(resolve => setTimeout(resolve, 90)); assert.equal(snapshots.length, 1); assert.equal(snapshots[0].messages[0].text.length, 100);
  chat.onNotification({ method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'stream', itemId: 'message', delta: 'pending' } });
  chat.onNotification({ method: 'item/completed', params: { threadId: 'thread', turnId: 'stream', item: { id: 'message', type: 'agentMessage', text: 'final' } } });
  assert.equal(snapshots.length, 2); assert.equal(snapshots.at(-1).messages[0].text, 'final'); await new Promise(resolve => setTimeout(resolve, 90)); assert.equal(snapshots.length, 2); assert.equal(chat.postTimer, null);
});
