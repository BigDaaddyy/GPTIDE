const crypto = require('node:crypto');
function create(text, mode, attachments, projectKey, chatId) {
  if (typeof text !== 'string' || !text.trim() || text.length > 100000 || !['agent', 'ask', 'plan'].includes(mode)) throw new Error('排队消息无效');
  const snapshot = (attachments || []).map(value => ({ id: value.id, label: value.label, path: value.path, text: value.text, kind: value.kind, truncated: value.truncated }));
  const item = { id: crypto.randomUUID(), projectKey, chatId, text, mode, attachments: snapshot, status: 'pending', createdAt: Date.now() };
  if (JSON.stringify(item).length > 250000) throw new Error('排队上下文过大，请减少引用');
  return item;
}
function validate(items, chatId, projectKey) {
  if (!Array.isArray(items) || items.length > 10 || JSON.stringify(items).length > 1000000) return false;
  const ids = new Set();
  return items.every(item => {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) || typeof item.projectKey !== 'string' || item.chatId !== chatId || item.projectKey !== projectKey || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 100000 || !['agent', 'ask', 'plan'].includes(item.mode) || !['pending', 'starting', 'failed'].includes(item.status)) return false;
    ids.add(item.id);
    return Array.isArray(item.attachments) && item.attachments.length <= 20 && item.attachments.every(value => value && typeof value.id === 'string' && typeof value.label === 'string' && typeof value.text === 'string' && (value.path === undefined || typeof value.path === 'string') && (value.kind === undefined || typeof value.kind === 'string'));
  });
}
module.exports = { create, validate };
