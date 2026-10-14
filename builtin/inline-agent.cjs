const { Bridge } = require('./bridge.cjs');
const core = require('./inline-core.cjs');
async function generate({ executable, cwd, model, effort, snapshot, instruction, token, task }) {
  const bridge = new Bridge(executable, cwd); let threadId, cancel, timer, finish;
  const label=task?'提交信息生成':'代码改写';
  const completion = new Promise((resolve, reject) => { finish = { resolve, reject }; }); completion.catch(() => {});
  const abort = () => { finish.reject(new Error('已取消'+label+'。')); bridge.dispose(); };
  try {
    cancel = token?.onCancellationRequested(abort);
    if (token?.isCancellationRequested) throw new Error('已取消'+label+'。');
    await bridge.start();
    if (token?.isCancellationRequested) throw new Error('已取消'+label+'。');
    const { account } = await bridge.call('account/read', { refreshToken: false });
    if (!account || !['chatgpt', 'chatgptAuthTokens'].includes(account.type)) throw new Error(task ? '请先使用 ChatGPT 账户登录。' : 'Ctrl+K 需要 ChatGPT 会员登录。');
    if(task){const catalog=require('./model-catalog.cjs'),models=await catalog.read(bridge);const selected=models.find(value=>value.model===model)||models.find(value=>value.isDefault)||models[0];if(!selected)throw new Error('账户没有可用模型，请重新连接');model=selected.model;effort=catalog.effort(selected,effort);}
    bridge.on('disconnected', error => finish.reject(error));
    bridge.on('request', request => { try { bridge.send({ id: request.id, error: { code: -32601, message: 'Inline editing does not authorize tools' } }); } catch (error) { finish.reject(error); bridge.dispose(); } });
    const thread = await bridge.call('thread/start', { cwd, model, sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true }); threadId = thread.thread.id;
    const stream = require('./inline-stream.cjs').create(threadId, finish, () => bridge.dispose(), task?.parse); bridge.on('notification', stream.receive);
    timer = setTimeout(() => { finish.reject(new Error(label+'超时，请重试。')); bridge.dispose(); }, 120000);
    const started = bridge.call('turn/start', { threadId, model, effort, sandboxPolicy: { type: 'readOnly' }, outputSchema: task?.schema || core.schema, input: [{ type: 'text', text: task ? task.prompt : core.prompt(snapshot, instruction) }] }).catch(error => {
      if (!bridge.closed && stream.started && /^turn\/start 超时/.test(error.message)) return completion;
      throw error;
    });
    await Promise.race([started, completion]);
    return await completion;
  } finally { clearTimeout(timer); cancel?.dispose(); bridge.removeAllListeners(); bridge.dispose(); }
}
module.exports = { generate };
