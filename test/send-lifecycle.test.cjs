const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');
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
