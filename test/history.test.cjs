const test = require('node:test'), assert = require('node:assert/strict');
const { entries } = require('../builtin/history.cjs');
test('history excludes empty tabs and groups identical conversations without deleting originals', () => {
  const a = { id: 'a', name: 'Same', updatedAt: 1, messages: [{ role: 'user', text: 'hello', itemId: 'old' }, { role: 'assistant', text: 'answer' }] };
  const b = { ...a, id: 'b', updatedAt: 2, messages: a.messages.map(m => ({ ...m, itemId: 'new' })) };
  const chats = [{ id: 'empty', name: '新对话', messages: [] }, a, b];
  assert.equal(entries(chats).length, 1); assert.equal(entries(chats)[0].id, 'b'); assert.equal(entries(chats)[0].duplicates, 2);
  assert.equal(entries(chats, 'a')[0].id, 'a'); assert.equal(chats.length, 3);
  assert.equal(entries([{ id: 'draft', messages: [], draft: 'unfinished code task' }])[0].hasDraft, true);
  assert.equal(entries([a, { ...b, tasks: [{ kind: 'command', output: 'different result' }] }]).length, 2);
});
