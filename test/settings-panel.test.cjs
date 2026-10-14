const test = require('node:test'), assert = require('node:assert/strict');
const { install, validateSetting } = require('../builtin/settings-ui.cjs');
test('settings values allow only known typed fields and enum/range constraints', () => {
  assert.equal(validateSetting('agent.networkAccess', false), false); assert.equal(validateSetting('connection.timeoutSeconds', 60), 60);
  for (const [key, value] of [['OPENAI_API_KEY', 'secret'], ['connection.timeoutSeconds', 1], ['connection.timeoutSeconds', NaN], ['approvalPolicy', 'accept-all'], ['agent.networkAccess', 'true'], ['usage.autoRefreshSeconds', 17]]) assert.throws(() => validateSetting(key, value), /无效/);
});
test('configuration panel reuses its tab, targets explicit scopes and never connects a model', async () => {
  const commands = new Map(), updates = [], messages = []; let receiver, dispose, count = 0, folderChanged;
  const panel = { reveal: () => {}, dispose: () => dispose(), onDidDispose: fn => { dispose = fn; }, webview: { postMessage: value => messages.push(value), onDidReceiveMessage: fn => { receiver = fn; } } };
  const config = { get: (key, fallback) => fallback, inspect: () => ({}), update: async (...args) => updates.push(args) };
  const vscode = { ViewColumn: { Active: 1 }, ConfigurationTarget: { Workspace: 2, Global: 1 }, workspace: { getConfiguration: () => config, onDidChangeConfiguration: () => ({ dispose() {} }), onDidChangeWorkspaceFolders: fn => { folderChanged = fn; return { dispose() {} }; } }, commands: { registerCommand: (key, fn) => { commands.set(key, fn); return { dispose() {} }; }, executeCommand: async () => {} }, window: { createWebviewPanel: () => { count++; return panel; } } };
  const chat = { project: 'QA project', projectKey: 'owner', model: 'fixture', effort: 'high', mode: 'ask', fixedContext: { state: { files: [], rules: '', excluded: [] } } };
  install(vscode, { subscriptions: [] }, '', () => chat); await commands.get('gptide.settings')(); await commands.get('gptide.settings')(); assert.equal(count, 1); assert.ok(panel.webview.html.includes('项目固定上下文'));
  await receiver({ type: 'set', key: 'connection.autoConnect', value: false, scope: 'user' }); assert.deepEqual(updates[0], ['connection.autoConnect', false, 1]);
  await receiver({ type: 'set', key: 'approvalPolicy', value: 'on-request', scope: 'project', projectKey: 'foreign' }); assert.equal(updates.length, 1); assert.equal(messages.at(-1).type, 'error');
  await receiver({ type: 'set', key: 'approvalPolicy', value: 'untrusted', scope: 'project', projectKey: 'owner' }); assert.equal(updates[1][2], 2);
  await receiver({ type: 'set', key: 'approvalPolicy', reset: true, scope: 'project', projectKey: 'owner' }); assert.equal(updates[2][1], undefined);
  folderChanged(); assert.ok(dispose);
});
