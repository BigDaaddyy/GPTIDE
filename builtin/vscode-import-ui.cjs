const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const core = require('./vscode-import.cjs');
const configurations = require('./import-config.cjs'), running = new Set();
async function run(vscode, root, globalStorageUri, preset) {
  const target = globalStorageUri?.fsPath ? path.dirname(path.dirname(globalStorageUri.fsPath)) : path.join(root, 'data', 'user', 'User');
  if (running.has(target)) return vscode.window.showInformationMessage('配置导入正在运行');
  running.add(target); try { return await runImport(vscode, root, target, preset); } finally { running.delete(target); }
}
async function runImport(vscode, root, targetDirectory, preset) {
  let user = preset?.user || path.join(process.env.APPDATA || '', 'Code', 'User');
  let extensions = preset?.extensions || path.join(os.homedir(), '.vscode', 'extensions');
  const source = preset ? preset.label : await vscode.window.showQuickPick(['VS Code 默认目录', '选择自定义目录'], { title: '导入 VS Code 设置和插件' }); if (!source) return;
  if (source === '选择自定义目录') {
    const a = await vscode.window.showOpenDialog({ title: '选择 VS Code User 目录', canSelectFiles: false, canSelectFolders: true, canSelectMany: false }); if (!a) return; user = a[0].fsPath;
    const b = await vscode.window.showOpenDialog({ title: '选择 VS Code extensions 目录', canSelectFiles: false, canSelectFolders: true, canSelectMany: false }); if (!b) return; extensions = b[0].fsPath;
  }
  const plan = core.scan(user, extensions);
  const snippets=path.join(user,'snippets');
  const choices = [{ label: '设置', description: `${Object.keys(plan.settings).length} 项`, kind: 'settings', picked: true }, { label: '快捷键', description: `${plan.keybindings.length} 项`, kind: 'keys', picked: true }, ...(fs.existsSync(snippets)?[{label:'代码片段',kind:'snippets',picked:true}]:[]), ...plan.plugins.map(p => ({ label: p.id, description: p.manifest.version, plugin: p, picked: true }))];
  const selected = await vscode.window.showQuickPick(choices, { canPickMany: true, title: '选择导入内容', placeHolder: user }); if (!selected?.length) return;
  const mode = selected.some(s => s.kind) ? await vscode.window.showQuickPick(['保留 GPTIDE 已有设置', '同名设置使用来源的值'], { title: '设置冲突处理' }) : '保留 GPTIDE 已有设置'; if (!mode) return;
  const backup = path.join(require('./data-paths.cjs').dataRoot(root), 'imports', crypto.randomUUID()); fs.mkdirSync(backup, { recursive: true });
  const failures = [...plan.warnings], installed = []; let settingCount = 0, keyCount = 0;
  let canceled = false;
  try { await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '导入 '+(preset?.label||'VS Code'), cancellable: true }, async (progress, token) => {
    const controller = new AbortController(), cancel = token.onCancellationRequested(() => controller.abort());
    if (token.isCancellationRequested) controller.abort();
    try {
    controller.signal.throwIfAborted();
    const counts = configurations.withLock(targetDirectory, path.dirname(backup), () => {
      const records = configurations.prepare(targetDirectory, plan, selected.map(s => s.kind), mode.startsWith('同名'));
      return configurations.apply(records, backup);
    }); settingCount = counts.settingCount; keyCount = counts.keyCount;
    if(selected.some(item=>item.kind==='snippets'))require('./data-paths.cjs').copyMissing(snippets,path.join(targetDirectory,'snippets'));
    for (const item of selected.filter(s => s.plugin)) {
      if (controller.signal.aborted) { canceled = true; break; }
      const p = item.plugin; progress.report({ message: p.id });
      if (vscode.extensions.getExtension(p.id)) { failures.push(`${p.id}：已安装，保留现有版本`); continue; }
      const vsix = path.join(backup, crypto.randomUUID() + '.vsix');
      try { await core.packagePlugin(p, vsix, { signal: controller.signal }); controller.signal.throwIfAborted(); await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(vsix)); installed.push(p.id); }
      catch (e) { if (controller.signal.aborted) { canceled = true; break; } failures.push(`${p.id}：${e.message}`); }
      finally { if (fs.existsSync(vsix)) fs.unlinkSync(vsix); }
    }
    } finally { canceled ||= controller.signal.aborted; cancel.dispose(); }
  }); } catch (error) { if (error.name === 'AbortError') canceled = true; else failures.push(error.message); }
  fs.writeFileSync(path.join(backup, 'result.json'), JSON.stringify({ settingCount, keyCount, installed, failures, canceled, targetDirectory }, null, 2));
  const action = await vscode.window.showInformationMessage(`${canceled ? '已停止后续导入。' : ''}已导入 ${settingCount} 项设置、${keyCount} 个快捷键、${installed.length} 个插件；${failures.length} 项跳过或失败。`, '查看结果', '重载窗口');
  if (action === '查看结果') await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(path.join(backup, 'result.json')));
  if (action === '重载窗口') await vscode.commands.executeCommand('workbench.action.reloadWindow');
}
module.exports = { run };
