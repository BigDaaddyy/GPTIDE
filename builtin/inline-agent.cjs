const { Bridge } = require('./bridge.cjs');
const core = require('./inline-core.cjs');
async function generate({ executable, cwd, model, effort, snapshot, instruction, token }) {
  const bridge = new Bridge(executable, cwd), messages = new Map(); let threadId, cancel, timer, finish;
  const completion = new Promise((resolve, reject) => { finish = { resolve, reject }; }); completion.catch(() => {});
  const abort = () => { finish.reject(new Error('已取消代码改写。')); bridge.dispose(); };
  try {
    cancel = token?.onCancellationRequested(abort);
    if (token?.isCancellationRequested) throw new Error('已取消代码改写。');
    await bridge.start();
    if (token?.isCancellationRequested) throw new Error('已取消代码改写。');
    const { account } = await bridge.call('account/read', { refreshToken: false });
    if (!account || !['chatgpt', 'chatgptAuthTokens'].includes(account.type)) throw new Error('Ctrl+K 需要 ChatGPT 会员登录。');
    bridge.on('disconnected', error => finish.reject(error));
    bridge.on('request', request => bridge.send({ id: request.id, error: { code: -32601, message: 'Inline editing does not authorize tools' } }));
    bridge.on('notification', ({ method, params: p }) => {
      if (!p || (p.threadId && p.threadId !== threadId)) return;
      if (method === 'item/agentMessage/delta') messages.set(p.itemId, (messages.get(p.itemId) || '') + p.delta);
      if (method === 'item/completed' && p.item?.type === 'agentMessage') messages.set(p.item.id, p.item.text || messages.get(p.item.id) || '');
      if (method === 'turn/completed') {
        if (p.turn.status !== 'completed') finish.reject(new Error(p.turn.error?.message || '代码改写未完成。'));
        else { try { finish.resolve(core.parse([...messages.values()].at(-1) || '')); } catch (error) { finish.reject(error); } }
      }
      if (method === 'error' && !p.willRetry) finish.reject(new Error(p.error?.message || '代码改写失败。'));
    });
    const thread = await bridge.call('thread/start', { cwd, model, sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true }); threadId = thread.thread.id;
    timer = setTimeout(() => { finish.reject(new Error('代码改写超时，请重试或使用聊天。')); bridge.dispose(); }, 120000);
    await bridge.call('turn/start', { threadId, model, effort, sandboxPolicy: { type: 'readOnly' }, outputSchema: core.schema, input: [{ type: 'text', text: core.prompt(snapshot, instruction) }] });
    return await completion;
  } finally { clearTimeout(timer); cancel?.dispose(); bridge.removeAllListeners(); bridge.dispose(); }
}
module.exports = { generate };
