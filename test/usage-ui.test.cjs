const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const usage = require('../builtin/usage.cjs'), { install } = require('../builtin/usage-ui.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(root, now) {
  const values = {}, bar = { show() {}, hide() {}, dispose() {} }, context = { subscriptions: [] }, commands = new Map(); let interval, change, clears = 0;
  const clock = { now: () => now.value, setInterval: callback => { interval = callback; return 1; }, clearInterval: () => { clears++; } };
  const vscode = { StatusBarAlignment: { Right: 1 }, window: { createStatusBarItem: () => bar, showQuickPick: async () => undefined }, workspace: { getConfiguration: () => ({ get: (key, fallback) => values[key] ?? fallback }), onDidChangeConfiguration: listener => { change = listener; return { dispose() {} }; } }, commands: { registerCommand: (name, callback) => { commands.set(name, callback); return { dispose() {} }; } } };
  const controller = install(vscode, context, root, clock);
  return { controller, bar, commands, vscode, values, interval: () => interval(), change: key => change({ affectsConfiguration: name => name === key }), clears: () => clears, dispose: () => context.subscriptions.forEach(item => item.dispose?.()) };
}
test('status bar refreshes saved local data, labels expiry and respects timer settings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gptide-usage-ui-')), oldRead = usage.read; let reads = 0, value;
  usage.read = async () => { reads++; return value; };
  const now = { value: Date.now() }; value = usage.normalize({ primary: { usedPercent: 20, resetsAt: (now.value + 60000) / 1000 } }, new Date(now.value).toISOString(), 'fixture');
  const ui = setup(root, now);
  try {
    await tick(); assert.ok(ui.bar.text.includes('80%')); assert.equal(ui.controller.snapshot().windows[0].remainingPercent,80); assert.equal(ui.controller.snapshot().windows[0].state,'cached'); value = { ...value, primary: { ...value.primary, usedPercent: 40, remainingPercent: 60 } };
    await usage.save(root, { primary: { usedPercent: 40 } }); await tick(); assert.ok(ui.bar.text.includes('60%'));
    now.value += 61000; ui.interval(); await tick(); assert.equal(ui.bar.text, '$(history) 用量'); assert.equal(ui.controller.snapshot().windows[0].state,'expired'); assert.ok(ui.bar.tooltip.includes('当前剩余未知'));
    let options; ui.vscode.window.showQuickPick = async items => { options = items; }; await ui.commands.get('gptide.usage')(); assert.ok(options[0].description.includes('窗口已过期'));
    ui.values['usage.autoRefreshSeconds'] = 0; ui.change('gptide.usage.autoRefreshSeconds'); assert.equal(ui.clears(), 1);
    ui.dispose(); const before = reads; await usage.save(root, { primary: { usedPercent: 50 } }); await tick(); assert.equal(reads, before);
  } finally { ui.dispose(); usage.read = oldRead; await fs.rm(root, { recursive: true, force: true }); }
});
test('cache update during a pending read is reread, and disposal blocks late UI writes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gptide-usage-pending-')), oldRead = usage.read; let resolve, calls = 0;
  const now = { value: Date.now() }, snapshot = percent => usage.normalize({ primary: { usedPercent: percent } }, new Date(now.value).toISOString(), 'fixture');
  usage.read = () => ++calls === 1 ? new Promise(done => { resolve = done; }) : Promise.resolve(snapshot(50)); const ui = setup(root, now);
  try {
    await usage.save(root, { primary: { usedPercent: 50 } }); resolve(snapshot(10)); await tick(); assert.equal(calls, 2); assert.ok(ui.bar.text.includes('50%'));
    usage.read = () => new Promise(done => { resolve = done; }); ui.interval(); const before = ui.bar.text; ui.dispose(); resolve(snapshot(90)); await tick(); assert.equal(ui.bar.text, before);
  } finally { ui.dispose(); usage.read = oldRead; await fs.rm(root, { recursive: true, force: true }); }
});

test('weekly-only records remain visible in the status bar and shared quota snapshot', async () => {
  const oldRead = usage.read, now = { value: Date.now() };
  usage.read = async () => usage.normalize({ secondary: { usedPercent: 23, windowDurationMins: 10080 } }, new Date(now.value).toISOString(), 'fixture');
  const ui = setup(path.join(os.tmpdir(), 'gptide-weekly-only'), now);
  try {
    await tick(); assert.match(ui.bar.text, /77%/); assert.match(ui.bar.tooltip, /每周/);
    assert.equal(ui.controller.snapshot().windows.length, 1);
    assert.equal(ui.controller.snapshot().windows[0].label, '每周');
  } finally { ui.dispose(); usage.read = oldRead; }
});
