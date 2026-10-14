const core = require('./inline-core.cjs');
function create(threadId, finish, stop = () => {}) {
  const messages = new Map(), sizes = new Map(); let turnId, settled = false, total = 0;
  const fail = error => { if (settled) return; settled = true; finish.reject(error); stop(); };
  const put = (id, text) => {
    const size = Buffer.byteLength(text), next = total - (sizes.get(id) || 0) + size;
    if (next > 2 * 1024 * 1024 || !messages.has(id) && messages.size >= 50) { fail(new Error('代码改写输出过大，请缩小选区')); return; }
    total = next; sizes.set(id, size); messages.set(id, text);
  };
  const receive = event => {
    const method = event?.method, p = event?.params;
    if (settled || !['turn/started', 'turn/completed', 'item/agentMessage/delta', 'item/completed', 'error'].includes(method) || !p || p.threadId !== threadId) return;
    if (method.startsWith('turn/') && (typeof p.turn?.id !== 'string' || method === 'turn/completed' && typeof p.turn.status !== 'string')) return;
    if (method === 'item/agentMessage/delta' && (typeof p.itemId !== 'string' || typeof p.delta !== 'string')) return;
    if (method === 'item/completed' && (p.item?.type !== 'agentMessage' || typeof p.item.id !== 'string' || typeof p.item.text !== 'string')) return;
    const id = p.turnId || p.turn?.id;
    if (typeof id !== 'string' || !id || turnId && id !== turnId) return;
    turnId ||= id;
    if (method === 'item/agentMessage/delta' && typeof p.itemId === 'string' && typeof p.delta === 'string') put(p.itemId, (messages.get(p.itemId) || '') + p.delta);
    if (method === 'item/completed' && p.item?.type === 'agentMessage' && typeof p.item.id === 'string' && typeof p.item.text === 'string') put(p.item.id, p.item.text);
    if (method === 'turn/completed') {
      if (p.turn?.status !== 'completed') { fail(new Error(typeof p.turn?.error?.message === 'string' ? p.turn.error.message : '代码改写未完成')); return; }
      try { const result = core.parse([...messages.values()].at(-1) || ''); settled = true; finish.resolve(result); } catch (error) { fail(error); }
    }
    if (method === 'error' && !p.willRetry) fail(new Error(typeof p.error?.message === 'string' ? p.error.message : '代码改写失败'));
  };
  return { receive, get started() { return !!turnId; }, get settled() { return settled; } };
}
module.exports = { create };
