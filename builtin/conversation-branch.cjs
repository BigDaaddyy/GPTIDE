function create(source, index, projectKey) {
  if (!source || source.projectKey !== projectKey || !Array.isArray(source.messages) || !Number.isSafeInteger(index) || index < 0 || index >= source.messages.length) throw new Error('分支消息不属于当前项目对话');
  const messages = source.messages.slice(0, index + 1).map(message => ({ role: message.role || 'assistant', text: message.text || '', ...(message.attachments ? { attachments: [...message.attachments] } : {}), ...(typeof message.model === 'string' ? { model: message.model } : {}), ...(typeof message.mode === 'string' ? { mode: message.mode } : {}) }));
  return { projectKey, source: 'gptide', name: (source.name || '对话').slice(0, 60) + ' · 分支', messages, tasks: [], changes: [], checkpoints: [], draft: '', backgroundPending: true, backgroundCount: messages.length, branch: { id: source.id, name: source.name || '对话', messageIndex: index }, updatedAt: Date.now() };
}
module.exports = { create };
