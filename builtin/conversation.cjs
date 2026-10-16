const path = require('node:path');
const title = value => String(value || '').replace(/[\r\n]+/g, ' ').trim();
function filename(name) { return 'GPTIDE-' + (Array.from(title(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '')).slice(0, 80).join('') || 'conversation') + '.md'; }
function fence(text, language = 'text') {
  text = String(text || ''); let longest = 2;
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const line = '`'.repeat(longest + 1); return line + language + '\n' + text + '\n' + line;
}
function snapshot(chat) {
  return { name: chat.name, source: chat.source, draft: chat.draft || '', messages: (chat.messages || []).map(m => ({ role: m.role, text: String(m.text || ''), attachments: (m.attachments || []).map(String), model: m.model, mode: m.mode })), tasks: (chat.tasks || []).map(t => ({ turn: t.turn, kind: t.kind, title: t.title, status: t.status, output: t.output || '', exitCode: t.exitCode, durationMs: t.durationMs, truncated: t.truncated })) };
}
function markdown(chat, project, options = {}) {
  const lines = [`# ${title(chat.name) || '对话'}`, '', `项目：${path.basename(project)}`, `来源：${chat.source === 'cursor' ? 'Cursor' : 'GPTIDE'}`];
  if (options.streaming) lines.push('状态：生成中的对话快照');
  lines.push('');
  for (const [i, message] of (chat.messages || []).entries()) {
    lines.push(`## ${i + 1}. ${message.role === 'user' ? '你' : chat.source === 'cursor' ? 'Cursor' : 'GPTIDE'}`, '');
    if (message.mode || message.model) lines.push([message.mode, message.model].filter(Boolean).map(title).join(' · '), '');
    if (message.attachments?.length) lines.push('引用：' + message.attachments.map(title).join('、'), '');
    lines.push(String(message.text || ''), '');
  }
  if (options.draft && chat.draft) lines.push('## 未发送草稿', '', fence(chat.draft), '');
  if (options.tasks && chat.tasks?.length) lines.push('## 任务过程', '', taskReport(chat.tasks), '');
  return lines.join('\n');
}
function taskReport(tasks) {
  const labels = { completed: '完成', failed: '失败', interrupted: '已停止', ended: '已结束，未确认结果', running: '运行中，未确认结果' };
  return tasks.map(task => [`### #${task.turn || 1} · ${title(task.title)}`, '', `${labels[task.status] || title(task.status)}${typeof task.exitCode === 'number' ? ` · 退出码 ${task.exitCode}` : ''}${typeof task.durationMs === 'number' ? ` · ${(task.durationMs / 1000).toFixed(1)} 秒` : ''}${task.truncated ? ' · 输出已截断' : ''}`, ...(task.output ? ['', fence(task.output)] : [])].join('\n')).join('\n\n');
}
function selectTasks(tasks, turn = 'all', failedOnly = false) { return tasks.filter(t => (turn === 'all' || Number(t.turn || 1) === Number(turn)) && (!failedOnly || t.status === 'failed')); }
module.exports = { filename, fence, snapshot, markdown, taskReport, selectTasks };
