const text = value => typeof value === 'string' && value.trim() && value.length <= 200;
function normalize(value) {
  if (!value || typeof value !== 'object' || !text(value.model) || value.hidden === true) return null;
  const efforts = Array.isArray(value.supportedReasoningEfforts) ? value.supportedReasoningEfforts : [];
  const unique = new Map();
  for (const effort of efforts.slice(0, 50)) if (effort && text(effort.reasoningEffort)) unique.set(effort.reasoningEffort, { reasoningEffort: effort.reasoningEffort, description: typeof effort.description === 'string' ? effort.description.slice(0, 1000) : '' });
  return { model: value.model, displayName: text(value.displayName) ? value.displayName : value.model, isDefault: value.isDefault === true, supportedReasoningEfforts: [...unique.values()], defaultReasoningEffort: text(value.defaultReasoningEffort) ? value.defaultReasoningEffort : undefined };
}
async function read(bridge, isCurrent = () => true) {
  const models = new Map(), cursors = new Set(); let cursor;
  for (let page = 0; page < 10; page++) {
    const result = await bridge.call('model/list', { limit: 50, includeHidden: false, ...(cursor ? { cursor } : {}) });
    if (!isCurrent()) return null;
    if (!Array.isArray(result?.data) || result.data.length > 500) throw new Error('模型列表响应无效，请重新连接');
    for (const entry of result.data) { const model = normalize(entry); if (model && !models.has(model.model)) models.set(model.model, model); }
    if (models.size > 500) throw new Error('模型列表过大，请更新 Codex 后重试');
    const next = result.nextCursor;
    if (next === undefined || next === null || next === '') return [...models.values()];
    if (typeof next !== 'string' || next.length > 10000 || cursors.has(next)) throw new Error('模型列表分页异常，请重新连接');
    cursors.add(next); cursor = next;
  }
  throw new Error('模型列表分页过多，请更新 Codex 后重试');
}
function effort(model, requested) {
  const options = model?.supportedReasoningEfforts || [];
  if (options.some(option => option.reasoningEffort === requested)) return requested;
  if (!options.length || options.some(option => option.reasoningEffort === model?.defaultReasoningEffort)) return model?.defaultReasoningEffort;
  return options[0].reasoningEffort;
}
module.exports = { read, normalize, effort };
