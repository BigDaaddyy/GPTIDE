const OUTPUT_LIMIT = 12000, EVENT_LIMIT = 200;
const clip = (value, limit = OUTPUT_LIMIT) => String(value || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').slice(-limit);
const labels = { commandExecution: '执行命令', fileChange: '修改文件', mcpToolCall: '调用工具', dynamicToolCall: '调用工具', webSearch: '搜索网页', contextCompaction: '整理上下文' };
function describe(item) {
  if (item.type === 'commandExecution') {
    const actions = item.commandActions || [], read = actions.length && actions.every(a => a.type === 'read'), search = actions.length && actions.every(a => ['search', 'listFiles'].includes(a.type));
    return { kind: read ? 'read' : search ? 'search' : 'command', title: clip(item.command, 2000), files: actions.filter(a => a.type === 'read' && a.path).map(a => a.path) };
  }
  if (item.type === 'fileChange') return { kind: 'file', title: '修改项目文件', files: (item.changes || []).map(c => c.path) };
  return { kind: 'tool', title: clip(item.type === 'webSearch' ? item.query : item.tool || labels[item.type], 2000), files: [] };
}
function update(tasks, method, params, turn = 1, now = Date.now()) {
  if (method === 'item/commandExecution/outputDelta' || method === 'item/fileChange/outputDelta') {
    const task = tasks.find(t => t.id === params.itemId && t.turnId === params.turnId);
    if (!task) return false;
    const output = task.output + String(params.delta || ''); task.truncated ||= output.length > OUTPUT_LIMIT; task.output = clip(output); return true;
  }
  if (!['item/started', 'item/completed'].includes(method)) return false;
  const item = params.item; if (!item?.id || !labels[item.type]) return false;
  let task = tasks.find(t => t.id === item.id && t.turnId === params.turnId);
  if (!task) { task = { id: item.id, turnId: params.turnId, turn, startedAt: now, output: '', status: 'running' }; tasks.push(task); if (tasks.length > EVENT_LIMIT) tasks.splice(0, tasks.length - EVENT_LIMIT); }
  Object.assign(task, describe(item));
  if (item.aggregatedOutput !== undefined && item.aggregatedOutput !== null) { task.truncated ||= item.aggregatedOutput.length > OUTPUT_LIMIT; task.output = clip(item.aggregatedOutput); }
  if (method === 'item/completed') {
    task.status = ['failed', 'declined'].includes(item.status) || (typeof item.exitCode === 'number' && item.exitCode !== 0) || item.success === false || item.error ? 'failed' : 'completed';
    task.exitCode = item.exitCode; task.durationMs = item.durationMs ?? now - task.startedAt; task.endedAt = now;
    if (item.error) task.output = clip(typeof item.error === 'string' ? item.error : item.error.message || JSON.stringify(item.error));
  }
  return true;
}
function finish(tasks, turnId, status) { for (const task of tasks) if (task.turnId === turnId && task.status === 'running') task.status = status === 'interrupted' ? 'interrupted' : status === 'failed' ? 'failed' : 'ended'; }
module.exports = { update, finish, OUTPUT_LIMIT, EVENT_LIMIT };
