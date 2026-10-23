const os = require('node:os');
const fs = require('node:fs'), path = require('node:path');
function install(vscode, context) {
  const version = require('./package.json').version;
  context.subscriptions.push(vscode.commands.registerCommand('gptide.about', async () => {
    const title = 'GPTIDE ' + version;
    let engine = vscode.version;
    try { const metadata = JSON.parse(fs.readFileSync(path.join(vscode.env.appRoot, 'package.json'), 'utf8')); if (typeof metadata.version === 'string') engine = metadata.version; } catch {}
    const detail = [`VSCodium: ${engine}`, `Node.js: ${process.versions.node}`, `OS: ${os.type()} ${os.arch()} ${os.release()}`].join('\n');
    const choice = await vscode.window.showInformationMessage(title, { modal: true, detail }, '检查更新', '复制');
    if (choice === '检查更新') return vscode.commands.executeCommand('gptide.checkForUpdates');
    if (choice === '复制') return vscode.env.clipboard.writeText(title + '\n' + detail);
  }));
}
module.exports = { install };
