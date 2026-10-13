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
