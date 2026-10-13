const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { Bridge, findCodex } = require('./bridge.cjs');
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
  const bridge = new Bridge(findCodex(vscode.workspace.getConfiguration('gptide').get('codexPath')), os.homedir());
  let timer; const dispose = () => { clearTimeout(timer); bridge.dispose(); };
  context.subscriptions.push({ dispose });
  bridge.on('notification', notification => {
    if (notification.method === 'account/login/completed') {
      vscode.window.showInformationMessage(notification.params.success ? 'ChatGPT 账户已登录' : 'ChatGPT 登录未完成'); dispose();
    }
  });
  try {
    await bridge.start(); const result = await bridge.call('account/login/start', { type: 'chatgpt' });
    if (!result.authUrl) throw new Error('登录服务没有返回浏览器地址');
    await vscode.env.openExternal(vscode.Uri.parse(result.authUrl));
    vscode.window.showInformationMessage('请在浏览器完成 ChatGPT 登录');
    timer = setTimeout(dispose, 300000);
  } catch (error) { dispose(); throw error; }
}
module.exports = { localInfo, login };
