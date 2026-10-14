const QUICK_ACTIONS = [
  { id: 'new', label: '新对话', action: 'new', idle: true },
  { id: 'ask', label: 'Ask', mode: 'ask', idle: true },
  { id: 'agent', label: 'Agent', mode: 'agent', idle: true },
  { id: 'plan', label: 'Plan', mode: 'plan', idle: true },
  { id: 'file', label: '项目文件', action: 'attach', context: true, idle: true },
  { id: 'selection', label: '当前文件 / 选区', action: 'attachCurrent', context: true, idle: true },
  { id: 'diagnostics', label: '项目诊断', action: 'attachDiagnostics', context: true, idle: true },
  { id: 'diff', label: 'Git 差异', action: 'attachGitDiff', context: true, idle: true },
  { id: 'folder', label: '文件夹', action: 'attachFolder', context: true, idle: true },
  { id: 'usage', label: '用量', action: 'usage' },
  { id: 'settings', label: '会话与 Codex 配置', action: 'settings' },
  { id: 'find', label: '查找对话', action: 'find' },
  { id: 'export', label: '导出对话', action: 'export' },
  { id: 'terminal', label: '终端', action: 'terminal' }
];
function actionQuery(text, caret = text.length, end = caret) {
  if (caret !== end || caret < 0 || caret > text.length) return null;
  const before = text.slice(0, caret), slash = caret === text.length && /^[ \t]*\/([a-z]*)$/i.exec(before);
  if (slash) return { kind: 'command', query: slash[1].toLowerCase(), start: 0, end: caret };
  const context = /(?:^|\s)@([a-z]*)$/i.exec(before);
  if (context && (caret === text.length || /\s/.test(text[caret]))) return { kind: 'context', query: context[1].toLowerCase(), start: caret - context[1].length - 1, end: caret };
  return null;
}
function matchingActions(query, state = {}) {
  if (!query || state.loadingScope || state.storageBlocked || state.reviewBusy) return [];
  return QUICK_ACTIONS.filter(action => (query.kind !== 'context' || action.context) && action.id.startsWith(query.query) && (!action.idle || !state.busy && !state.pendingSend && !state.operationLocked && !state.inlineBusy && !state.loginPending));
}
function commandAction(text) {
  const match = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(text.trim()); if (!match) return null;
  const action = QUICK_ACTIONS.find(action => action.id === match[1].toLowerCase()); if (!action || !action.mode && match[2]?.trim()) return null;
  return { action, remainder: match[2] || '' };
}
if (typeof module !== 'undefined') module.exports = { QUICK_ACTIONS, actionQuery, matchingActions, commandAction };
