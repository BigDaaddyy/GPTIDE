const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { findCodex } = require('./bridge.cjs');
function install(vscode, context, root, currentChat) {
  const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  context.subscriptions.push(vscode.commands.registerCommand('gptide.settings', async () => {
    const items = [{ label: '$(settings-gear) GptIDE 会话配置', action: 'settings' }, { label: '$(file-code) Codex config.toml', action: 'config' }, { label: '$(dashboard) 用量', action: 'usage' }, { label: '$(tools) 本机诊断', action: 'diagnostics' }];
    const item = await vscode.window.showQuickPick(items, { title: 'GptIDE / Codex 配置' }); if (!item) return;
    if (item.action === 'settings') return vscode.commands.executeCommand('workbench.action.openSettings', '@ext:gptide.gptide-chat');
    if (item.action === 'usage') return vscode.commands.executeCommand('gptide.usage');
    if (item.action === 'config') {
      const file = path.join(codexHome(), 'config.toml');
      if (!fs.existsSync(file)) return vscode.window.showInformationMessage('本机尚无 Codex config.toml，GptIDE 会话配置可直接使用。');
      return vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(file)));
    }
    return vscode.commands.executeCommand('gptide.diagnostics');
  }));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.diagnostics', async () => {
    const executable = findCodex(vscode.workspace.getConfiguration('gptide').get('codexPath'));
    const chat = currentChat();
    const data = { version: require('./package.json').version, account: require('./account.cjs').localInfo().label, executable, executableFound: path.isAbsolute(executable) ? fs.existsSync(executable) : 'PATH', configExists: fs.existsSync(path.join(codexHome(), 'config.toml')), projectCount: vscode.workspace.workspaceFolders?.length || 0, connection: chat?.bridge ? 'connected' : 'disconnected', preferences: require('./preferences.cjs').values(vscode.workspace.getConfiguration('gptide')), historyBlocked: !!chat?.storageBlocked, historyConflict: !!chat?.conflictFile };
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(data, null, 2) }));
  }));
}
module.exports = { install };
