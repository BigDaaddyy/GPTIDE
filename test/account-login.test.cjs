const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');
const { EventEmitter } = require('node:events');
const bridges = []; let delayed = false;
class FakeBridge extends EventEmitter {
  constructor() { super(); this.calls = []; this.disposals = 0; bridges.push(this); }
  start() { return delayed ? new Promise(resolve => { this.finishStart = resolve; }) : Promise.resolve(); }
  call(method, params) { this.calls.push({ method, params }); return Promise.resolve({ authUrl: 'https://example.invalid/local-fixture' }); }
  dispose() { this.disposals++; this.emit('disconnected'); }
}
const original = Module.prototype.require; let login;
try { Module.prototype.require = function(id) { return id === './bridge.cjs' ? { Bridge: FakeBridge, findCodex: () => 'unused' } : original.apply(this, arguments); }; login = require('../builtin/account.cjs').login; }
finally { Module.prototype.require = original; }
function fixture() {
  const messages = [], context = { subscriptions: [] }, opened = [];
  const vscode = { workspace: { getConfiguration: () => ({ get: () => undefined }) }, window: { showInformationMessage: message => messages.push(message) }, Uri: { parse: value => value }, env: { openExternal: async uri => { opened.push(uri); return true; } } };
  return { context, vscode, messages, opened, dispose: () => context.subscriptions.forEach(item => item.dispose()) };
}
test('standalone login keeps one pending flow and releases it after completion', async () => {
  const f = fixture(), start = bridges.length;
  try { await login(f.vscode, f.context); await login(f.vscode, f.context); assert.equal(bridges.length, start + 1); assert.equal(f.opened.length, 1); assert.ok(f.messages.includes('请完成已有的 ChatGPT 登录'));
    bridges[start].emit('notification', { method: 'account/login/completed', params: { success: true } }); assert.equal(bridges[start].disposals, 1);
    await login(f.vscode, f.context); assert.equal(bridges.length, start + 2);
  } finally { f.dispose(); }
});
test('closing context while preparing login opens no browser or auth request', async () => {
  const f = fixture(); delayed = true;
  try { const pending = login(f.vscode, f.context), bridge = bridges.at(-1); f.dispose(); bridge.finishStart(); await pending; assert.deepEqual(bridge.calls, []); assert.deepEqual(f.opened, []); assert.equal(bridge.disposals, 1); }
  finally { delayed = false; f.dispose(); }
});
test('browser open failure disposes login and allows retry without stale lock', async () => {
  const f = fixture(), start = bridges.length; f.vscode.env.openExternal = async () => false;
  try { await assert.rejects(login(f.vscode, f.context), /无法打开/); await assert.rejects(login(f.vscode, f.context), /无法打开/); assert.equal(bridges.length, start + 2); assert.equal(bridges[start].disposals, 1); }
  finally { f.dispose(); }
});
