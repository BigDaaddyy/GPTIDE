const test = require('node:test'), assert = require('node:assert/strict');
const find = require('../builtin/find.cjs'), conversation = require('../builtin/conversation.cjs');
test('conversation find treats code punctuation literally and updates changing messages', () => {
  const messages = [{ text: 'find a.+[b] here' }, { text: 'A.+[B] too' }, { text: '函数位置' }], cache = new Map();
  assert.deepEqual(find.findMessageMatches(messages, 'a.+[b]', cache), [0, 1]);
  assert.deepEqual(find.findMessageMatches(messages, '函数', cache), [2]);
  messages[0].text += ' 函数'; assert.deepEqual(find.findMessageMatches(messages, '函数', cache), [0, 2]);
  messages.pop(); assert.deepEqual(find.findMessageMatches(messages, '函数', cache), [0]); assert.equal(cache.size, 2);
  assert.deepEqual(find.findMessageMatches(messages, '', cache), []); assert.equal(cache.size, 0);
});
test('Markdown export contains all public messages and only selected extras', () => {
  const chat = { name: 'Example', source: 'gptide', draft: 'unsent', messages: Array.from({ length: 250 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `message-${i}`, attachments: ['app.js'], privateToken: 'do not export' })), tasks: [{ turn: 2, title: 'test', status: 'failed', exitCode: 1, output: 'output\n```\nkeep fenced', hiddenReasoning: 'do not export' }], credentials: 'do not export' };
  const snapshot = conversation.snapshot(chat), basic = conversation.markdown(snapshot, '/private/project');
  assert.ok(basic.includes('message-0')); assert.ok(basic.includes('message-249')); assert.ok(!basic.includes('unsent')); assert.ok(!basic.includes('do not export')); assert.ok(!basic.includes('/private'));
  const full = conversation.markdown(snapshot, '/private/project', { tasks: true, draft: true, streaming: true });
  assert.ok(full.includes('未发送草稿')); assert.ok(full.includes('退出码 1')); assert.ok(full.includes('````text')); assert.ok(full.includes('生成中的对话快照'));
  chat.messages[0].text = 'changed'; assert.equal(snapshot.messages[0].text, 'message-0');
  assert.ok(!/[<>:"/\\|?*]/.test(conversation.filename('../CON:*?'))); assert.ok(conversation.filename('😀'.repeat(100)).length < 180);
});
test('task filters preserve only requested turns and failed status without inventing success', () => {
  const tasks = [{ turn: 1, status: 'failed', title: 'one' }, { turn: 2, status: 'completed', title: 'two' }, { turn: 2, status: 'ended', title: 'unconfirmed' }];
  assert.deepEqual(conversation.selectTasks(tasks, 'all', true).map(t => t.title), ['one']);
  assert.deepEqual(conversation.selectTasks(tasks, '2', false).map(t => t.title), ['two', 'unconfirmed']);
  assert.ok(conversation.taskReport(tasks).includes('未确认结果'));
});
