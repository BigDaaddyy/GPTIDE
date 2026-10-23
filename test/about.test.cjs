const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { install } = require('../builtin/about.cjs'), { aboutUpdates } = require('../tools/workbench-patch.cjs');
test('About offers updates and copies the actual GPTIDE version without requiring a project', async () => {
  const commands = new Map(), context = { subscriptions: [] }; let answer, shown, copied, executed;
  install({ version: '1.135.0', commands: { registerCommand: (id, run) => { commands.set(id, run); return {}; }, executeCommand: async id => { executed = id; } }, window: { showInformationMessage: async (...args) => { shown = args; return answer; } }, env: { clipboard: { writeText: async text => { copied = text; } } } }, context);
  answer = '复制'; await commands.get('gptide.about')();
  assert.equal(shown[0], 'GPTIDE ' + require('../package.json').version); assert.deepEqual(shown.slice(2), ['检查更新', '复制']);
  assert.ok(copied.includes('VSCodium: 1.135.0')); assert.ok(!copied.includes('undefined')); assert.equal(executed, undefined);
  answer = '检查更新'; await commands.get('gptide.about')(); assert.equal(executed, 'gptide.checkForUpdates');
  executed = undefined; answer = undefined; await commands.get('gptide.about')(); assert.equal(executed, undefined);
});
test('native Help About routes to the shared about command, with safe fallback and idempotent patching', async () => {
  const source = 'class About{run(i){return i.get(Ft).about()}}', patched = aboutUpdates(source); let command, fallback = 0;
  const action = vm.runInNewContext(patched + ';new About()', { Ie: 'commands', Ft: 'dialogs' });
  await action.run({ get: key => key === 'commands' ? { executeCommand: async id => { command = id; } } : { about: async () => { fallback++; } } });
  assert.equal(command, 'gptide.about'); assert.equal(fallback, 0);
  await action.run({ get: key => key === 'commands' ? { executeCommand: async () => { throw Error('unavailable'); } } : { about: async () => { fallback++; } } });
  assert.equal(fallback, 1); assert.equal(aboutUpdates(patched), patched); assert.throws(() => aboutUpdates('changed'), /结构已变化/);
});
