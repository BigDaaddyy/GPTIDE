const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { Bridge, findCodex } = require('./bridge.cjs');
const activeLogins = new WeakMap();
function localInfo(home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8'));
    if ((!auth.tokens?.id_token && !auth.tokens?.access_token) || auth.auth_mode === 'apikey') return { label: 'GPT 账户 · 未登录 ChatGPT' };
    let claims = {}; try { claims = JSON.parse(Buffer.from(auth.tokens.id_token.split('.')[1], 'base64url').toString()); } catch {}
    const plan = claims['https://api.openai.com/auth']?.chatgpt_plan_type;
    return { label: 'GPT 账户 · ' + (typeof plan === 'string' ? plan.toUpperCase() + ' · ' : '') + '本机已登录' };
  } catch { return { label: 'GPT 账户 · 未登录 ChatGPT' }; }
}
async function login(vscode, context, chat) {
  if (chat) return chat.login();
  if (activeLogins.has(context)) { vscode.window.showInformationMessage('请完成已有的 ChatGPT 登录'); return; }
  const bridge = new Bridge(findCodex(vscode.workspace.getConfiguration('gptide').get('codexPath')), os.homedir());
  const record = { disposed: false }; activeLogins.set(context, record);
  let timer; const dispose = () => { if (record.disposed) return; record.disposed = true; clearTimeout(timer); if (activeLogins.get(context) === record) activeLogins.delete(context); bridge.dispose(); };
  context.subscriptions.push({ dispose });
  bridge.on('notification', notification => {
    if (notification.method === 'account/login/completed') {
      if (record.disposed) return;
      vscode.window.showInformationMessage(notification.params?.success ? 'ChatGPT 账户已登录' : 'ChatGPT 登录未完成'); dispose();
    }
  });
  try {
    bridge.on('disconnected', dispose);
    await bridge.start(); if (record.disposed) return; const result = await bridge.call('account/login/start', { type: 'chatgpt' }); if (record.disposed) return;
    if (!result.authUrl) throw new Error('登录服务没有返回浏览器地址');
    if (!await vscode.env.openExternal(vscode.Uri.parse(result.authUrl))) throw new Error('无法打开登录页面'); if (record.disposed) return;
    vscode.window.showInformationMessage('请在浏览器完成 ChatGPT 登录');
    timer = setTimeout(dispose, 300000);
  } catch (error) { dispose(); throw error; }
}
module.exports = { localInfo, login };
