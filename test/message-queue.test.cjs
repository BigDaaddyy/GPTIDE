const test = require('node:test'), assert = require('node:assert/strict'), queue = require('../builtin/message-queue.cjs');
test('queue snapshots references, enforces project ownership and bounds stored content', () => {
  const attachment = { id: 'file', label: 'a.js', path: 'QA/a.js', text: 'before' }, item = queue.create('next task', 'ask', [attachment], 'owner', 'chat');
  attachment.text = 'changed'; assert.equal(item.attachments[0].text, 'before'); assert.equal(queue.validate([item], 'chat', 'owner'), true); assert.equal(queue.validate([item], 'chat', 'foreign'), false); assert.equal(queue.validate([item, item], 'chat', 'owner'), false);
  assert.throws(() => queue.create('', 'agent', [], 'owner', 'chat')); assert.throws(() => queue.create('request', 'unknown', [], 'owner', 'chat')); assert.throws(() => queue.create('request', 'ask', [{ ...attachment, text: 'x'.repeat(260000) }], 'owner', 'chat'), /过大/);
});
