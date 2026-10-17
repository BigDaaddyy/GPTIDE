const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { findCodex } = require('./bridge.cjs');
const labels = {
  model: '首选模型', defaultMode: '默认模式', reasoningEffort: '默认推理强度', approvalPolicy: '授权策略',
  'agent.networkAccess': 'Agent 网络访问', 'connection.autoConnect': '打开项目时连接', 'connection.timeoutSeconds': '请求超时（秒）',
  'updates.autoDownload': '启动时检查并下载增量更新',
  'chat.submitKey': '发送快捷键', 'review.maxCheckpoints': '每对话检查点数量', 'review.storageLimitMb': '检查点缓存（MiB）',
  'usage.autoRefreshSeconds': '用量读取间隔（秒）', 'usage.staleAfterMinutes': '用量缓存年龄（分钟）'
};
const schema = Object.fromEntries(Object.entries(require('./package.json').contributes.configuration.properties).map(([key, value]) => [key.replace(/^gptide\./, ''), value]));
function validateSetting(key, value) {
  const field = Object.hasOwn(labels, key) ? schema[key] : null;
  if (!field || typeof value !== field.type || field.enum && !field.enum.includes(value) || field.type === 'number' && (!Number.isFinite(value) || !Number.isInteger(value) || value < field.minimum || value > field.maximum) || field.type === 'string' && value.length > 200) throw new Error('配置值无效');
  return value;
}
function install(vscode, context, root, currentChat) {
  const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  let panel, writing = false;
  const chatNow = () => { const value = currentChat(); return value && !value.invalidated ? value : null; };
  const effective = chat => {
    const prefs = require('./preferences.cjs').values(vscode.workspace.getConfiguration('gptide'));
    return chat ? `当前会话：${chat.model || '发送时加载'} · ${chat.effort} · ${chat.mode}\n${chat.bridge ? '已连接' : '未连接'}${chat.busy ? ' · 任务进行中' : ''} · ${chat.bridge ? '当前连接' : '新连接'}超时 ${(chat.bridge?.timeout || prefs.rpcTimeout) / 1000}s\n下一任务：授权 ${prefs.approvalPolicy} · 网络 ${prefs.networkAccess ? '允许' : '关闭'}；模型默认值用于新项目。` : '无项目 · 不启动聊天后端';
  };
  const publish = status => {
    if (!panel) return;
    const chat = chatNow(), config = vscode.workspace.getConfiguration('gptide');
    const fields = Object.entries(labels).map(([key, label]) => { const field = schema[key], inspected = config.inspect(key) || {}, userValue = inspected.globalValue ?? field.default; return { key, label, applicationOnly: field.scope === 'application', type: field.type, enum: field.enum, minimum: field.minimum, maximum: field.maximum, value: config.get(key, field.default), effectiveValue: config.get(key, field.default), userValue, projectValue: inspected.workspaceValue ?? userValue, source: inspected.workspaceFolderValue !== undefined ? '项目文件夹' : inspected.workspaceValue !== undefined ? '项目' : inspected.globalValue !== undefined ? '用户' : '默认', hint: field.description }; });
    panel.webview.postMessage({ type: 'state', fields, project: chat?.project || '', projectKey: chat?.projectKey, contextAvailable: !!chat?.fixedContext, context: chat?.fixedContext?.state || {}, effective: effective(chat), ...(status !== undefined ? { status } : {}) });
  };
  context.subscriptions.push(vscode.commands.registerCommand('gptide.settings', async () => {
    if (panel) { panel.reveal(); publish(); return; }
    panel = vscode.window.createWebviewPanel('gptide.settings', 'GPTIDE 配置', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
    const own = panel, nonce = require('node:crypto').randomBytes(18).toString('hex');
    panel.webview.html = fs.readFileSync(path.join(__dirname, 'settings-panel.html'), 'utf8').replace('__SCRIPT__', () => fs.readFileSync(path.join(__dirname, 'settings-panel.js'), 'utf8')).replaceAll('__NONCE__', nonce);
    const changed = vscode.workspace.onDidChangeConfiguration(event => { if (!writing && event.affectsConfiguration('gptide')) publish(); });
    const closed = vscode.workspace.onDidChangeWorkspaceFolders(() => own.dispose());
    own.onDidDispose(() => { changed.dispose(); closed.dispose(); if (panel === own) panel = null; });
    own.webview.onDidReceiveMessage(async message => {
      if (panel !== own || !message || typeof message !== 'object') return;
      const chat = chatNow();
      try {
        if (message.type === 'refresh') { publish(); return; }
        if (message.type === 'set') {
          if (writing) throw new Error('正在保存配置，请稍后重试');
          if (!['user', 'project'].includes(message.scope) || !Object.hasOwn(labels, message.key)) throw new Error('未知配置项');
          if (message.scope === 'project' && schema[message.key].scope === 'application') throw Error('此设置只能在用户配置中修改');
          if (message.scope === 'project' && (!chat || message.projectKey !== chat.projectKey)) throw new Error('项目已切换');
          const value = message.reset ? undefined : validateSetting(message.key, message.value);
          writing = true; try { await vscode.workspace.getConfiguration('gptide').update(message.key, value, message.scope === 'project' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global); } finally { writing = false; }
          if (panel === own) { own.webview.postMessage({ type: 'settingSaved', key: message.key, scope: message.scope }); publish('已保存'); } return;
        }
        if (message.type === 'context' || message.type === 'choose') {
          if (!chat || !chat.fixedContext || message.projectKey !== chat.projectKey) throw new Error('当前项目固定上下文不可用');
          if (chat.actionLocked?.() || chat.busy || chat.reviewBusy || chat.inlineBusy || chat.inlinePromptBusy || chat.loginPending) throw new Error('请先完成当前任务或登录再修改固定上下文');
          if (message.type === 'context') {
            chat.fixedContext.save({ files: message.files, excluded: message.excluded, rules: message.rules }); chat.contextWarning = undefined; chat.post();
            own.webview.postMessage({ type: 'contextSaved', editVersion: message.editVersion }); publish('项目上下文已保存'); return;
          }
          const review = require('./review.cjs'), files = await vscode.workspace.findFiles('**/*', '**/{.git,node_modules,dist,build,.next,.venv}/**', 2000);
          if (chatNow() !== chat || panel !== own) return;
          const items = files.filter(uri => uri.scheme === 'file' && review.within(chat.project, uri.fsPath)).map(uri => ({ label: path.relative(chat.project, uri.fsPath), uri }));
          const selected = await vscode.window.showQuickPick(items, { canPickMany: true, title: '固定项目文件' });
          if (chatNow() === chat && panel === own && selected) own.webview.postMessage({ type: 'files', files: selected.map(item => item.label) }); return;
        }
        if (message.type === 'advanced') return vscode.commands.executeCommand('workbench.action.openSettings', '@ext:gptide.gptide-chat');
        if (message.type === 'usage') return vscode.commands.executeCommand('gptide.usage');
        if (message.type === 'updates') return vscode.commands.executeCommand('gptide.checkForUpdates');
        if (message.type === 'diagnostics') return vscode.commands.executeCommand('gptide.diagnostics');
        if (message.type !== 'config') return;
      const file = path.join(codexHome(), 'config.toml');
      if (!fs.existsSync(file)) return vscode.window.showInformationMessage('本机尚无 Codex config.toml，GPTIDE 会话配置可直接使用。');
      return vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(file)));
      } catch (error) { if (panel === own) own.webview.postMessage({ type: 'error', message: error.message }); }
    });
    context.subscriptions.push(own); publish();
  }));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.diagnostics', async () => {
    let executable, executableError;
    try { executable = findCodex(vscode.workspace.getConfiguration('gptide').get('codexPath')); } catch (error) { executableError = error.message; }
    const chat = currentChat();
    const data = { version: require('./package.json').version, account: require('./account.cjs').localInfo().label, executable: executable || null, executableError, executableFound: !!executable && fs.existsSync(executable), configExists: fs.existsSync(path.join(codexHome(), 'config.toml')), projectCount: vscode.workspace.workspaceFolders?.length || 0, connection: chat?.bridge ? 'connected' : 'disconnected', preferences: require('./preferences.cjs').values(vscode.workspace.getConfiguration('gptide')), historyBlocked: !!chat?.storageBlocked, historyConflict: !!chat?.conflictFile };
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(data, null, 2) }));
  }));
  return { refresh: () => panel?.webview.postMessage({ type: 'live', effective: effective(chatNow()) }) };
}
module.exports = { install, validateSetting };
