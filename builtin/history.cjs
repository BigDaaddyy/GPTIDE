const crypto = require('node:crypto');
function entries(chats, activeId) {
  const groups = new Map();
  for (const chat of chats) {
    const messages = (chat.messages || []).filter(m => typeof m.text === 'string' && m.text.trim());
    const draft = typeof chat.draft === 'string' ? chat.draft.trim() : '';
    if (!messages.length && !draft && !chat.queue?.length && !chat.lastRequest && !chat.pinned && !chat.archived) continue;
    const content = { messages: messages.map(m => ({ role: m.role, text: m.text, attachments: m.attachments || [] })), draft, tasks: (chat.tasks || []).map(t => ({ kind: t.kind, title: t.title, status: t.status, output: t.output, files: t.files, exitCode: t.exitCode })), changes: (chat.changes || []).map(c => ({ relative: c.relative, before: c.before, after: c.after, status: c.status })) };
    const checkpoints = (chat.checkpoints || []).map(c => ({ turn: c.turn, changes: (c.changes || []).map(f => ({ relative: f.relative, beforeRef: f.beforeRef, afterRef: f.afterRef, status: f.status })) }));
    const key = crypto.createHash('sha256').update(JSON.stringify({ name: chat.name, managedIdentity: chat.pinned || chat.archived ? chat.id : undefined, ...content, checkpoints, branchIdentity: chat.branch ? chat.id : undefined, queueIdentity: chat.queue?.length ? chat.id : undefined, attemptIdentity: !messages.length && chat.lastRequest ? chat.id : undefined })).digest('hex');
    const existing = groups.get(key), row = { id: chat.id, name: messages.length ? chat.name : draft ? draft.slice(0, 36) : chat.lastRequest ? chat.lastRequest.slice(0, 36) : chat.name || '待处理对话', source: chat.source, branch: !!chat.branch, updatedAt: chat.updatedAt, count: messages.length, hasDraft: !!draft, queueCount: chat.queue?.length || 0, duplicates: (existing?.duplicates || 0) + 1 };
    row.pinned=chat.pinned===true;row.archived=chat.archived===true;
    if(!messages.length&&chat.name&&chat.name!=='新对话')row.name=chat.name;
    if (!existing || chat.id === activeId || (existing.id !== activeId && (chat.updatedAt || 0) > (existing.updatedAt || 0))) groups.set(key, row);
    else existing.duplicates++;
  }
  return [...groups.values()].sort((a, b) => Number(b.pinned)-Number(a.pinned) || (b.updatedAt || 0) - (a.updatedAt || 0));
}
module.exports = { entries };
