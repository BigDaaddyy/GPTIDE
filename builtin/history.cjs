const crypto = require('node:crypto');
function entries(chats, activeId) {
  const groups = new Map();
  for (const chat of chats) {
    const messages = (chat.messages || []).filter(m => typeof m.text === 'string' && m.text.trim());
    const draft = typeof chat.draft === 'string' ? chat.draft.trim() : '';
    if (!messages.length && !draft) continue;
    const content = { messages: messages.map(m => ({ role: m.role, text: m.text, attachments: m.attachments || [] })), draft, tasks: (chat.tasks || []).map(t => ({ kind: t.kind, title: t.title, status: t.status, output: t.output, files: t.files, exitCode: t.exitCode })), changes: (chat.changes || []).map(c => ({ relative: c.relative, before: c.before, after: c.after, status: c.status })) };
    const key = crypto.createHash('sha256').update(JSON.stringify({ name: chat.name, ...content })).digest('hex');
    const existing = groups.get(key), row = { id: chat.id, name: messages.length ? chat.name : draft.slice(0, 36), source: chat.source, updatedAt: chat.updatedAt, count: messages.length, hasDraft: !!draft, duplicates: (existing?.duplicates || 0) + 1 };
    if (!existing || chat.id === activeId || (existing.id !== activeId && (chat.updatedAt || 0) > (existing.updatedAt || 0))) groups.set(key, row);
    else existing.duplicates++;
  }
  return [...groups.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
module.exports = { entries };
