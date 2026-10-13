const path = require('node:path'), crypto = require('node:crypto');
function normalize(project) { const resolved = path.resolve(project); return process.platform === 'win32' ? resolved.toLowerCase() : resolved; }
function key(project) { return crypto.createHash('sha256').update(normalize(project)).digest('hex'); }
function matches(a, b) { return typeof a === 'string' && typeof b === 'string' && normalize(a) === normalize(b); }
function partition(chats, projectKey) {
  const owned = [], unverified = [];
  for (const chat of chats || []) if (chat?.id) (chat.projectKey === projectKey ? owned : unverified).push(chat);
  return { owned, unverified };
}
function validateState(state, projectKey, project) {
  if (state.projectKey && state.projectKey !== projectKey || state.projectPath && !matches(state.projectPath, project)) { const error = new Error('历史文件的项目归属不匹配，已拒绝读取。'); error.code = 'GPTIDE_FOREIGN'; throw error; }
}
module.exports = { normalize, key, matches, partition, validateState };
