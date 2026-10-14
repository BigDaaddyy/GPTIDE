const { Bridge } = require('./bridge.cjs');
const core = require('./inline-core.cjs');
async function generate({ executable, cwd, model, effort, snapshot, instruction, token }) {
  const bridge = new Bridge(executable, cwd); let threadId, cancel, timer, finish;
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
    bridge.on('request', request => { try { bridge.send({ id: request.id, error: { code: -32601, message: 'Inline editing does not authorize tools' } }); } catch (error) { finish.reject(error); bridge.dispose(); } });
    const thread = await bridge.call('thread/start', { cwd, model, sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true }); threadId = thread.thread.id;
    const stream = require('./inline-stream.cjs').create(threadId, finish, () => bridge.dispose()); bridge.on('notification', stream.receive);
    timer = setTimeout(() => { finish.reject(new Error('代码改写超时，请重试或使用聊天。')); bridge.dispose(); }, 120000);
    const started = bridge.call('turn/start', { threadId, model, effort, sandboxPolicy: { type: 'readOnly' }, outputSchema: core.schema, input: [{ type: 'text', text: core.prompt(snapshot, instruction) }] }).catch(error => {
      if (!bridge.closed && stream.started && /^turn\/start 超时/.test(error.message)) return completion;
      throw error;
    });
    await Promise.race([started, completion]);
    return await completion;
  } finally { clearTimeout(timer); cancel?.dispose(); bridge.removeAllListeners(); bridge.dispose(); }
}
module.exports = { generate };
