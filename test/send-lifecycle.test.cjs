const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const config = { get: (key, fallback) => fallback };
const vscode = { workspace: { isTrusted: true, getConfiguration: () => config }, window: {} };
const originalRequire = Module.prototype.require;
let Chat;
try { Module.prototype.require = function(id) { return id === 'vscode' ? vscode : originalRequire.apply(this, arguments); }; Chat = require('../builtin/extension.cjs').Chat; }
finally { Module.prototype.require = originalRequire; }
function fixture() {
  const chat = Object.create(Chat.prototype), record = { id: 'one', projectKey: 'project', source: 'gptide', name: 'existing', messages: [], draft: 'submitted' };
  Object.assign(chat, { ready: Promise.resolve(), project: process.cwd(), projectKey: 'project', activeId: 'one', chats: [record], openChatIds: ['one'], messages: record.messages, attachments: [], threadId: 'thread', resumed: true, account: { type: 'chatgpt' }, model: 'fixture', effort: 'medium', busy: false, post: () => {}, save: () => true, view: { webview: { postMessage: () => {} } }, drafts: { set: () => {} } });
  return chat;
}
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
