const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
function invalid(message) { const error = new Error('历史结构无效：' + message); error.code = 'GPTIDE_INVALID'; throw error; }
function optional(value, key, predicate) { if (value[key] !== undefined && value[key] !== null && !predicate(value[key])) invalid(key); }
const string = value => typeof value === 'string';
const strings = value => Array.isArray(value) && value.every(string);
function chats(value) {
  if (!Array.isArray(value)) invalid('chats'); const seen = new Set();
  for (const chat of value) {
    if (!object(chat) || !string(chat.id) || !chat.id || seen.has(chat.id)) invalid('对话标识'); seen.add(chat.id);
    for (const field of ['projectKey', 'threadId', 'name', 'draft', 'source', 'activeCheckpointId']) optional(chat, field, string);
    optional(chat, 'draftVersion', value => Number.isSafeInteger(value) && value >= 0);
    optional(chat, 'backgroundPending', value => typeof value === 'boolean');
    optional(chat, 'backgroundCount', value => Number.isSafeInteger(value) && value >= 0 && value <= (chat.messages?.length || 0));
    if (chat.backgroundPending && !Number.isSafeInteger(chat.backgroundCount)) invalid('背景消息数量');
    optional(chat, 'branch', value => object(value) && string(value.id) && string(value.name) && Number.isSafeInteger(value.messageIndex) && value.messageIndex >= 0 && value.messageIndex < (chat.messages?.length || 0));
    if (chat.branch && chat.backgroundCount !== chat.branch.messageIndex + 1) invalid('分支背景范围');
    optional(chat, 'queuePaused', value => typeof value === 'boolean');
    optional(chat, 'lastRequest', value => string(value) && value.length <= 100000);
    optional(chat, 'lastOutcome', value => ['preparing', 'running', 'completed', 'failed', 'interrupted', 'unknown'].includes(value));
    optional(chat, 'queue', value => require('./message-queue.cjs').validate(value, chat.id, chat.projectKey));
    optional(chat, 'messages', list => Array.isArray(list) && list.every(message => object(message) && (message.text === undefined || string(message.text)) && (message.role === undefined || string(message.role)) && (message.attachments === undefined || strings(message.attachments))));
    optional(chat, 'tasks', list => Array.isArray(list) && list.every(task => object(task) && (task.files === undefined || strings(task.files)) && ['id', 'turnId', 'kind', 'title', 'status', 'output'].every(field => task[field] === undefined || string(task[field]))));
    optional(chat, 'changes', list => Array.isArray(list) && list.every(change => object(change) && ['path', 'relative', 'status'].every(field => change[field] === undefined || string(change[field])) && ['before', 'after'].every(field => change[field] === undefined || change[field] === null || string(change[field]))));
    optional(chat, 'checkpoints', list => Array.isArray(list) && list.every(record => object(record) && string(record.id) && string(record.projectKey) && Array.isArray(record.changes) && record.changes.every(object)));
  }
}
function validate(state) {
  if (!object(state)) invalid('根记录'); chats(state.chats);
  optional(state, 'quarantinedChats', chatsValid => { chats(chatsValid); return true; });
  for (const field of ['openChatIds', 'hiddenCursorIds']) optional(state, field, strings);
  for (const field of ['projectKey', 'projectPath', 'activeId', 'model', 'effort', 'mode']) optional(state, field, string);
  return state;
}
function normalize(records) { return records.map(chat => ({ ...chat, messages: (chat.messages || []).map(message => ({ ...message, text: message.text ?? '' })), tasks: chat.tasks || [], changes: chat.changes || [], checkpoints: chat.checkpoints || [] })); }
module.exports = { validate, normalize };
