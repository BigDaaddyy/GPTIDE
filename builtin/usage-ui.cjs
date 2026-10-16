const { EventEmitter } = require('node:events');
const path = require('node:path'), usage = require('./usage.cjs');
function install(vscode, context, root, clock = { now: Date.now, setInterval, clearInterval }) {
  const events = new EventEmitter();
  const snapshot = () => ({ timestamp: cached?.timestamp, source: cached?.source, windows: [cached?.primary, cached?.secondary].filter(Boolean).map(w => ({ ...w, label: usage.label(w), state: usage.status(cached, w, clock.now(), staleMinutes()) })) });
  const bar = vscode.window.createStatusBarItem('gptide.usage', vscode.StatusBarAlignment.Right, 48);
  bar.name = 'ChatGPT 用量'; bar.command = 'gptide.usage'; bar.text = '$(dashboard) 用量';
  let cached, pending, dirty = false, disposed = false, timer;
  const config = () => vscode.workspace.getConfiguration('gptide');
  const staleMinutes = () => { const value = config().get('usage.staleAfterMinutes', 15); return typeof value === 'number' && Number.isFinite(value) ? Math.min(240, Math.max(1, value)) : 15; };
  const render = () => {
    if (disposed) return;
    events.emit('change');
    const w = cached?.primary || cached?.secondary, state = usage.status(cached, w, clock.now(), staleMinutes());
    bar.text = state === 'cached' ? `$(dashboard) ${w.remainingPercent}%` : state === 'unknown' ? '$(dashboard) 用量' : '$(history) 用量';
    const summary = state === 'expired' ? '该窗口已过期，当前剩余未知' : state === 'stale' ? '缓存需更新，当前剩余未知' : w ? `记录中剩余 ${w.remainingPercent}%` : '当前窗口未知';
    bar.tooltip = cached ? `${usage.label(w)} · ${summary}\n${cached.source} · ${new Date(cached.timestamp).toLocaleString()} · 非实时\n点击查看全部窗口` : '暂无本机用量记录；点击重新读取，不发起模型请求';
  };
  const refresh = () => {
    if (disposed) return Promise.resolve();
    if (pending) { dirty = true; return pending; }
    pending = (async () => { do { dirty = false; const value = await usage.read(root); if (!disposed) { cached = value; render(); } } while (dirty && !disposed); })().finally(() => { pending = null; });
    return pending;
  };
  const show = async () => {
    do {
      await refresh(); if (disposed) return;
      const items = [cached?.primary, cached?.secondary].filter(Boolean).map(w => {
        const state = usage.status(cached, w, clock.now(), staleMinutes()), old = state === 'expired' || state === 'stale';
        return { label: `${usage.label(w)} · ${old ? '记录中' : ''}剩余 ${w.remainingPercent}%`, description: state === 'expired' ? '窗口已过期 · 当前未知' : state === 'stale' ? '旧缓存 · 当前未知' : `记录中已用 ${w.usedPercent}%`, detail: w.resetsAt ? `记录重置时间：${new Date(w.resetsAt * 1000).toLocaleString()}` : '重置时间未知' };
      });
      if (!items.length) items.push({ label: '暂无本机用量记录', detail: '不发起模型请求。' });
      items.push({ label: '$(refresh) 重新读取本机缓存', refresh: true });
      const selected = await vscode.window.showQuickPick(items, { title: 'ChatGPT 用量', placeHolder: cached ? `${cached.source} · ${new Date(cached.timestamp).toLocaleString()} · 非实时` : '本机缓存' });
      if (!selected?.refresh) return;
    } while (!disposed);
  };
  const schedule = () => {
    if (disposed) return;
    if (timer !== undefined) clock.clearInterval(timer); timer = undefined;
    const seconds = config().get('usage.autoRefreshSeconds', 60); if (seconds === 0) return;
    const interval = typeof seconds === 'number' && Number.isFinite(seconds) ? Math.min(600, Math.max(30, seconds)) : 60;
    timer = clock.setInterval(() => { render(); refresh().catch(() => {}); }, interval * 1000); timer?.unref?.();
  };
  context.subscriptions.push(bar, vscode.commands.registerCommand('gptide.usage', show));
  context.subscriptions.push(usage.onChange(changedRoot => { if (path.resolve(root) === changedRoot) refresh().catch(() => {}); }));
  context.subscriptions.push({ dispose: () => { disposed = true; events.removeAllListeners(); if (timer !== undefined) clock.clearInterval(timer); } });
  if (config().get('usage.showStatusBar', true)) bar.show();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('gptide.usage.showStatusBar')) config().get('usage.showStatusBar', true) ? bar.show() : bar.hide();
    if (e.affectsConfiguration('gptide.usage.autoRefreshSeconds')) schedule();
    if (e.affectsConfiguration('gptide.usage.staleAfterMinutes')) render();
  }));
  schedule(); refresh().catch(() => {});
  return { snapshot, onChange(listener) { events.on('change', listener); return { dispose: () => events.off('change', listener) }; } };
}
module.exports = { install };
