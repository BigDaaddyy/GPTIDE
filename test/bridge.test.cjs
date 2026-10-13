const test = require('node:test'), assert = require('node:assert/strict');
const { Bridge } = require('../builtin/bridge.cjs');
test('bridge ignores malformed protocol lines without dropping pending requests', async () => {
  const bridge = new Bridge('unused', process.cwd()), events = []; bridge.on('notification', value => events.push(value));
  let result; bridge.pending.set(1, { resolve: value => { result = value; }, reject: error => { throw error; }, timer: setTimeout(() => {}, 1000) });
  for (const line of ['null', '[]', '1', '"string"', '{', '{"method":{}}', '{"id":100,"result":"unknown"}']) bridge.receive(line);
  assert.equal(bridge.pending.size, 1); assert.deepEqual(events, []);
  bridge.receive('{"method":"fixture","params":{}}'); bridge.receive('{"id":1,"result":{"ok":true}}');
  assert.equal(events.length, 1); assert.deepEqual(result, { ok: true }); assert.equal(bridge.pending.size, 0);
});
