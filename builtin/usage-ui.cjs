const usage = require('./usage.cjs');
function install(vscode, context, root) {
  const bar = vscode.window.createStatusBarItem('gptide.usage', vscode.StatusBarAlignment.Right, 48);
  bar.name = 'ChatGPT 用量'; bar.command = 'gptide.usage'; bar.text = '$(dashboard) 用量'; bar.tooltip = '快速查看 ChatGPT 用量（本机缓存）';
  let cached, pending;
  const refresh = () => pending ||= usage.read(root).then(value => { cached = value; const w = value?.primary; bar.text = w ? `$(dashboard) ${w.remainingPercent}%` : '$(dashboard) 用量'; bar.tooltip = value ? `${usage.label(w)}剩余 ${w?.remainingPercent ?? '未知'}% · ${value.source} · ${new Date(value.timestamp).toLocaleString()}\n点击查看全部窗口` : '暂无用量缓存；点击重新读取本机记录'; }).finally(() => { pending = null; });
  const show = async () => {
    await refresh();
    const values = [cached?.primary, cached?.secondary].filter(Boolean);
    const items = values.map(w => ({ label: `${usage.label(w)} · 剩余 ${w.remainingPercent}%`, description: `已用 ${w.usedPercent}%`, detail: w.resetsAt ? `重置时间：${new Date(w.resetsAt * 1000).toLocaleString()}` : '重置时间未知' }));
    if (!items.length) items.push({ label: '暂无本机用量记录', detail: '显示账户缓存，不发起模型请求。' });
    items.push({ label: '$(refresh) 重新读取本机缓存', refresh: true });
    const selected = await vscode.window.showQuickPick(items, { title: 'ChatGPT 用量', placeHolder: cached ? `${cached.source} · ${new Date(cached.timestamp).toLocaleString()} · 非实时` : '本机缓存' });
    if (selected?.refresh) await show();
  };
  context.subscriptions.push(bar, vscode.commands.registerCommand('gptide.usage', show));
  if (vscode.workspace.getConfiguration('gptide').get('usage.showStatusBar', true)) bar.show();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('gptide.usage.showStatusBar')) vscode.workspace.getConfiguration('gptide').get('usage.showStatusBar', true) ? bar.show() : bar.hide(); }));
  refresh().catch(() => {});
}
module.exports = { install };
