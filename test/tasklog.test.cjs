const test = require('node:test'), assert = require('node:assert/strict');
const log = require('../builtin/tasklog.cjs');
test('task log streams output, records exit failures and omits tool arguments', () => {
  const tasks = [], base = { turnId: 'turn-1', item: { id: 'cmd', type: 'commandExecution', command: 'read source', commandActions: [{ type: 'read', path: 'file.js' }] } };
  assert.equal(log.update(tasks, 'item/started', base, 2, 100), true);
  assert.equal(tasks[0].kind, 'read');
  log.update(tasks, 'item/commandExecution/outputDelta', { turnId: 'turn-1', itemId: 'cmd', delta: '\x1b[31moutput\x1b[0m' });
  assert.equal(tasks[0].output, 'output');
  log.update(tasks, 'item/completed', { ...base, item: { ...base.item, exitCode: 1, status: 'completed', aggregatedOutput: 'error', durationMs: 25 } }, 2, 125);
  assert.equal(tasks.length, 1); assert.equal(tasks[0].status, 'failed'); assert.equal(tasks[0].output, 'error'); assert.equal(tasks[0].durationMs, 25);
  log.update(tasks, 'item/started', { turnId: 'turn-2', item: { id: 'tool', type: 'mcpToolCall', tool: 'lookup', arguments: { secret: 'PRIVATE' } } });
  assert.ok(!JSON.stringify(tasks).includes('PRIVATE')); log.finish(tasks, 'turn-2', 'interrupted'); assert.equal(tasks[1].status, 'interrupted');
  assert.equal(log.update(tasks, 'item/started', { item: { id: 'r', type: 'reasoning', content: ['hidden'] } }), false);
});
test('task logs bound output and number of records', () => {
  const tasks = [];
  for (let i = 0; i < log.EVENT_LIMIT + 5; i++) log.update(tasks, 'item/started', { turnId: 'turn', item: { id: 'c' + i, type: 'commandExecution', command: 'test' } });
  assert.equal(tasks.length, log.EVENT_LIMIT);
  log.update(tasks, 'item/commandExecution/outputDelta', { turnId: 'turn', itemId: tasks[0].id, delta: 'x'.repeat(log.OUTPUT_LIMIT + 10) });
  assert.equal(tasks[0].output.length, log.OUTPUT_LIMIT); assert.equal(tasks[0].truncated, true);
});
