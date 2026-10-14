const test = require('node:test'), assert = require('node:assert/strict');
const { Bridge } = require('../builtin/bridge.cjs');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
test('Codex discovery resolves absolute install paths and never falls back to a project-local executable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-cli-path-'));
  try {
    const find = require('../builtin/bridge.cjs').findCodex, file = path.join(root, process.platform === 'win32' ? 'codex.exe' : 'codex'); fs.writeFileSync(file, 'fixture', { mode: 0o755 });
    assert.equal(find('', { PATH: root }), file); assert.throws(() => find('', { PATH: '.' }), /未找到/); assert.throws(() => find('./codex.exe', { PATH: root }), /完整路径/); assert.equal(find(file, {}), file);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const Module = require('node:module');

function mockStartedBridge() {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new EventEmitter(); child.stdin.writable = true;
  child.stdin.write = (line, callback) => { const value = JSON.parse(line); if (value.method === 'initialize') queueMicrotask(() => child.stdout.write(JSON.stringify({ id: value.id, result: {} }) + '\n')); callback?.(); return true; };
  child.kill = () => { child.killed = true; child.emit('exit', 0); child.stdout.end(); child.stderr.end(); };
  const file = require.resolve('../builtin/bridge.cjs'), cached = require.cache[file], original = Module.prototype.require;
  let MockBridge;
  try {
    delete require.cache[file]; Module.prototype.require = function(id) { return id === 'node:child_process' ? { spawn: () => child } : original.apply(this, arguments); };
    MockBridge = require('../builtin/bridge.cjs').Bridge;
  } finally { Module.prototype.require = original; require.cache[file] = cached; }
  return { bridge: new MockBridge('unused', process.cwd()), child };
}

test('stdin errors reject pending requests once and block later writes and responses', async () => {
  const { bridge, child } = mockStartedBridge(), events = []; bridge.on('disconnected', error => events.push(error.message));
  await bridge.start(); const pending = bridge.call('fixture');
  child.stdin.emit('error', new Error('fixture pipe closed')); bridge.fail(new Error('later exit'));
  await assert.rejects(pending, /fixture pipe closed/); assert.equal(bridge.pending.size, 0); assert.deepEqual(events, ['fixture pipe closed']);
  assert.equal(child.killed, true);
  await assert.rejects(bridge.call('after close'), /fixture pipe closed/);
  bridge.on('notification', () => { throw new Error('Late notifications must be ignored'); }); bridge.receive('{"method":"late"}'); bridge.dispose();
});
test('stdout stream errors stop the bridge and report a single disconnect', async () => {
  const { bridge, child } = mockStartedBridge(); await bridge.start(); let disconnects = 0;
  bridge.on('disconnected', () => disconnects++); const pending = bridge.call('fixture');
  child.stdout.emit('error', new Error('fixture read failed'));
  await assert.rejects(pending, /fixture read failed/); assert.equal(disconnects, 1); assert.equal(child.killed, true);
});
test('write callback failures and disposal release requests without waiting for timeout', async () => {
  const first = mockStartedBridge(); await first.bridge.start();
  first.child.stdin.write = (line, callback) => { callback(new Error('fixture write failed')); return false; };
  await assert.rejects(first.bridge.call('fixture'), /fixture write failed/); assert.equal(first.bridge.pending.size, 0); first.bridge.dispose();
  const second = mockStartedBridge(); await second.bridge.start(); const pending = second.bridge.call('fixture');
  let disconnects = 0; second.bridge.on('disconnected', () => disconnects++); second.bridge.dispose(); second.bridge.dispose();
  await assert.rejects(pending, /连接已关闭/); assert.equal(second.bridge.pending.size, 0); assert.equal(disconnects, 1); assert.equal(second.child.killed, true);
});
test('bridge ignores malformed protocol lines without dropping pending requests', async () => {
  const bridge = new Bridge('unused', process.cwd()), events = []; bridge.on('notification', value => events.push(value));
  let result; bridge.pending.set(1, { resolve: value => { result = value; }, reject: error => { throw error; }, timer: setTimeout(() => {}, 1000) });
  for (const line of ['null', '[]', '1', '"string"', '{', '{"method":{}}', '{"id":100,"result":"unknown"}']) bridge.receive(line);
  assert.equal(bridge.pending.size, 1); assert.deepEqual(events, []);
  bridge.receive('{"method":"fixture","params":{}}'); bridge.receive('{"id":1,"result":{"ok":true}}');
  assert.equal(events.length, 1); assert.deepEqual(result, { ok: true }); assert.equal(bridge.pending.size, 0);
});
