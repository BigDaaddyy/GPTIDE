const test = require('node:test'), assert = require('node:assert/strict');
const { create } = require('../builtin/conversation-branch.cjs');
test('branch copies only the selected prefix and owns no original thread, tools, checkpoints or draft', () => {
  const source = { id: 'origin', projectKey: 'owner', source: 'cursor', name: 'QA', threadId: 'old', draft: 'private draft', tasks: [{ id: 'old-tool' }], checkpoints: [{ id: 'old-checkpoint' }], messages: [{ role: 'user', text: 'first', attachments: ['a'] }, { role: 'assistant', text: 'answer', itemId: 'old-item' }, { role: 'user', text: 'later' }] };
  const branch = create(source, 1, 'owner'); assert.equal(branch.messages.length, 2); assert.equal(branch.backgroundCount, 2); assert.equal(branch.threadId, undefined); assert.equal(branch.messages[1].itemId, undefined); assert.equal(branch.draft, ''); assert.deepEqual(branch.tasks, []); assert.deepEqual(branch.checkpoints, []);
  branch.messages[0].attachments.push('new'); branch.messages[0].text = 'different'; assert.equal(source.messages[0].text, 'first'); assert.deepEqual(source.messages[0].attachments, ['a']);
  assert.throws(() => create(source, 0, 'foreign'), /当前项目/); assert.throws(() => create(source, 3, 'owner'), /消息/);
  branch.id = 'branch'; assert.doesNotThrow(() => require('../builtin/history-state.cjs').validate({ chats: [branch] })); branch.backgroundCount = 1; assert.throws(() => require('../builtin/history-state.cjs').validate({ chats: [branch] }), /分支背景范围/);
});
