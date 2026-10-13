const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const core = require('./vscode-import.cjs');
async function run(vscode, root) {
  let user = path.join(process.env.APPDATA || '', 'Code', 'User');
  let extensions = path.join(os.homedir(), '.vscode', 'extensions');
  const source = await vscode.window.showQuickPick(['VS Code 默认目录', '选择自定义目录'], { title: '导入 VS Code 设置和插件' }); if (!source) return;
  if (source === '选择自定义目录') {
    const a = await vscode.window.showOpenDialog({ title: '选择 VS Code User 目录', canSelectFiles: false, canSelectFolders: true, canSelectMany: false }); if (!a) return; user = a[0].fsPath;
    const b = await vscode.window.showOpenDialog({ title: '选择 VS Code extensions 目录', canSelectFiles: false, canSelectFolders: true, canSelectMany: false }); if (!b) return; extensions = b[0].fsPath;
  }
  const plan = core.scan(user, extensions);
  const choices = [{ label: '设置', description: `${Object.keys(plan.settings).length} 项`, kind: 'settings', picked: true }, { label: '快捷键', description: `${plan.keybindings.length} 项`, kind: 'keys', picked: true }, ...plan.plugins.map(p => ({ label: p.id, description: p.manifest.version, plugin: p, picked: true }))];
  const selected = await vscode.window.showQuickPick(choices, { canPickMany: true, title: '选择导入内容', placeHolder: user }); if (!selected?.length) return;
  const mode = selected.some(s => s.kind) ? await vscode.window.showQuickPick(['保留 GptIDE 已有设置', '同名设置使用 VS Code 的值'], { title: '设置冲突处理' }) : '保留 GptIDE 已有设置'; if (!mode) return;
  const backup = path.join(root, 'data', 'imports', crypto.randomUUID()); fs.mkdirSync(backup, { recursive: true });
  const failures = [...plan.warnings], installed = []; let settingCount = 0, keyCount = 0;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '导入 VS Code', cancellable: false }, async progress => {
    if (selected.some(s => s.kind === 'settings')) {
      const target = path.join(root, 'data', 'user', 'User', 'settings.json');
      const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '{}';
      const current = core.jsonc(before), merged = core.mergeSettings(current, plan.settings, mode.startsWith('同名'));
      fs.writeFileSync(path.join(backup, 'settings.json'), before);
      settingCount = Object.keys(merged).filter(k => JSON.stringify(merged[k]) !== JSON.stringify(current[k])).length;
      const temp = target + '.' + crypto.randomUUID() + '.tmp'; fs.mkdirSync(path.dirname(target), { recursive: true });
      try { fs.writeFileSync(temp, JSON.stringify(merged, null, 2)); fs.renameSync(temp, target); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    }
    if (selected.some(s => s.kind === 'keys')) {
      const target = path.join(root, 'data', 'user', 'User', 'keybindings.json');
      const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '[]', current = core.jsonc(before);
      if (!Array.isArray(current)) throw new Error('GptIDE 快捷键文件格式无效');
      const merged = core.mergeKeybindings(current, plan.keybindings, mode.startsWith('同名'));
      fs.writeFileSync(path.join(backup, 'keybindings.json'), before);
      keyCount = merged.filter(b => !current.some(c => JSON.stringify(c) === JSON.stringify(b))).length;
      const temp = target + '.' + crypto.randomUUID() + '.tmp';
      try { fs.writeFileSync(temp, JSON.stringify(merged, null, 2)); fs.renameSync(temp, target); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    }
    for (const item of selected.filter(s => s.plugin)) {
      const p = item.plugin; progress.report({ message: p.id });
      if (vscode.extensions.getExtension(p.id)) { failures.push(`${p.id}：已安装，保留现有版本`); continue; }
      const vsix = path.join(backup, crypto.randomUUID() + '.vsix');
      try { core.packagePlugin(p, vsix); await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(vsix)); installed.push(p.id); }
      catch (e) { failures.push(`${p.id}：${e.message}`); }
      finally { if (fs.existsSync(vsix)) fs.unlinkSync(vsix); }
    }
  });
  fs.writeFileSync(path.join(backup, 'result.json'), JSON.stringify({ settingCount, keyCount, installed, failures }, null, 2));
  const action = await vscode.window.showInformationMessage(`已导入 ${settingCount} 项设置、${keyCount} 个快捷键、${installed.length} 个插件；${failures.length} 项跳过或失败。`, '查看结果', '重载窗口');
  if (action === '查看结果') await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(path.join(backup, 'result.json')));
  if (action === '重载窗口') await vscode.commands.executeCommand('workbench.action.reloadWindow');
}
module.exports = { run };
