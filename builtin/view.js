const api = acquireVsCodeApi(), el = id => document.getElementById(id);
const previous = api.getState() || {};
let state = { busy: false, chats: [], messages: [] }, messageSignature = '', optionsSignature = '', reviewSignature = '';
const post = (type, data = {}) => api.postMessage({ type, ...data });
const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
function inline(node, text) {
  // Model HTML always remains literal text; never use innerHTML.
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g; let end = 0;
  for (const match of text.matchAll(pattern)) {
    node.append(document.createTextNode(text.slice(end, match.index))); const value = match[0];
    if (value.startsWith('`')) node.append(make('code', '', value.slice(1, -1)));
    else if (value.startsWith('**')) node.append(make('strong', '', value.slice(2, -2)));
    else { const link = value.match(/^\[([^\]]+)\]\((.+)\)$/); const button = make('button', 'link', link[1]); button.onclick = () => post('openLink', { url: link[2] }); node.append(button); }
    end = match.index + value.length;
  }
  node.append(document.createTextNode(text.slice(end)));
}
function content(node, text) {
  for (const block of parseMarkdown(text)) {
    if (block.type === 'code') {
      const wrapper = make('div', 'code-block'), header = make('div', 'code-title'), copy = make('button', '', '复制');
      copy.onclick = () => { post('copy', { text: block.text }); copy.textContent = '已复制'; setTimeout(() => copy.textContent = '复制', 1200); };
      header.append(make('span', '', block.language || 'code'), copy); const pre = make('pre'); pre.append(make('code', '', block.text)); wrapper.append(header, pre); node.append(wrapper);
    } else if (block.type === 'list') { const list = make(block.ordered ? 'ol' : 'ul'); for (const value of block.items) { const li = make('li'); inline(li, value); list.append(li); } node.append(list); }
    else if (block.type === 'table') {
      const wrapper = make('div', 'table-wrap'), table = make('table'), head = make('tr'); for (const cell of block.header) { const th = make('th'); inline(th, cell); head.append(th); } table.append(head);
      for (const row of block.rows) { const tr = make('tr'); for (const cell of row) { const td = make('td'); inline(td, cell); tr.append(td); } table.append(tr); } wrapper.append(table); node.append(wrapper);
    } else { const element = make(block.type === 'heading' ? 'h' + block.level : block.type === 'quote' ? 'blockquote' : block.type === 'rule' ? 'hr' : 'p'); if (block.text) inline(element, block.text); node.append(element); }
  }
}
function renderHistory() {
  const search = el('history-search').value.toLowerCase(); el('history-list').replaceChildren();
  const chats = [...state.chats].filter(c => c.name.toLowerCase().includes(search)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!chats.length) el('history-list').append(make('div', 'history-empty', search ? '没有匹配的对话' : '这个项目还没有聊天记录'));
  for (const chat of chats) {
    const row = make('button', 'history-row' + (state.activeId === chat.id ? ' active' : '')); row.disabled = state.busy;
    row.append(make('span', 'name', chat.name), make('span', 'meta', (chat.source === 'cursor' ? 'Cursor 导入' : 'GptIDE') + ` · ${chat.count} 条消息`));
    row.onclick = () => { post('select', { id: chat.id }); el('history-panel').hidden = true; }; el('history-list').append(row);
  }
}
function renderMessages(s) {
  const signature = JSON.stringify([s.activeId, s.messages]); if (signature === messageSignature) return;
  const switched = state.activeId !== s.activeId; messageSignature = signature;
  const box = el('messages'), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 100, oldTop = box.scrollTop; box.replaceChildren();
  if (!s.messages.length) {
    const empty = make('section', 'empty'); empty.append(make('h2', '', '从这里继续构建'), make('p', '', s.cursorCount ? `已读取 ${s.cursorCount} 条 Cursor 对话，在历史中选择即可继续。` : '打开项目，引用文件，把想做的事情写下来。'));
    for (const [title, prompt] of [['了解这个项目', '请分析这个项目的结构、运行方式和当前进度。'], ['规划下一步', '请先阅读项目，给出下一步改进计划和验证步骤。'], ['检查代码问题', '请检查项目中的明确错误，并给出具体文件与修复建议。']]) {
      const suggestion = make('button', 'suggestion', title); suggestion.append(make('span', '', '↗')); suggestion.onclick = () => { el('input').value = prompt; el('input').focus(); resizeInput(); }; empty.append(suggestion);
    }
    box.append(empty);
  }
  if (s.source === 'cursor') box.append(make('div', 'source', 'Cursor 历史已加载。下一条消息会以此为背景创建新的 GptIDE 对话。'));
  for (const message of s.messages) {
    const item = make('article', 'message ' + message.role), role = make('div', 'role', message.role === 'user' ? '你' : s.source === 'cursor' ? 'Cursor' : 'GptIDE');
    if (message.mode) role.append(make('span', 'badge', message.mode));
    const copy = make('button', 'copy-message', '复制'); copy.onclick = () => post('copy', { text: message.text }); role.append(copy);
    const body = make('div', 'content'); content(body, message.text); item.append(role, body);
    if (message.attachments?.length) { const files = make('div', 'message-files'); for (const label of message.attachments) files.append(make('span', 'file-chip', label)); item.append(files); }
    box.append(item);
  }
  if (atBottom || switched) box.scrollTop = box.scrollHeight; else box.scrollTop = oldTop;
  el('scroll-bottom').hidden = box.scrollHeight - box.scrollTop - box.clientHeight < 100;
}
function render(s) {
  renderMessages(s); state = s;
  const chat = s.chats.find(c => c.id === s.activeId);
  el('project').textContent = s.project ? s.project.split(/[\\/]/).pop() : '打开文件夹'; el('project').title = s.project;
  el('chat-title').textContent = chat?.name || '新对话'; el('status').textContent = s.status; el('status').title = s.status;
  el('connection').classList.toggle('connected', s.account?.type === 'chatgpt'); el('plan').textContent = s.account?.plan ? s.account.plan.toUpperCase() : '未登录';
  el('login').textContent = s.account?.type === 'chatgpt' ? '切换 ChatGPT 账号' : 'ChatGPT 登录';
  el('activity').hidden = !s.busy; el('activity-text').textContent = s.activity || '正在思考…';
  el('warning').textContent = s.warning || ''; el('warning').hidden = !s.warning;
  el('send').textContent = s.busy ? '■' : '↑'; el('send').title = s.busy ? '停止生成' : '发送消息';
  for (const id of ['new', 'refresh', 'rename', 'delete', 'model', 'effort', 'mode', 'folder', 'attach', 'attachCurrent']) el(id).disabled = s.busy;
  const options = JSON.stringify([s.models, s.model, s.effort]);
  if (options !== optionsSignature) {
    optionsSignature = options; el('model').replaceChildren(); if (!s.models.length) el('model').add(new Option('登录后加载模型', ''));
    for (const m of s.models) el('model').add(new Option((m.displayName || m.model).replace('GPT-', '').replaceAll('-', ' '), m.model)); el('model').value = s.model;
    el('effort').replaceChildren(); const model = s.models.find(m => m.model === s.model), names = { minimal: '最轻', low: '轻量', medium: '均衡', high: '深入', xhigh: '更深入', max: 'Max', ultra: 'Ultra' };
    for (const e of model?.supportedReasoningEfforts || []) el('effort').add(new Option(names[e.reasoningEffort] || e.reasoningEffort, e.reasoningEffort)); el('effort').value = s.effort;
  }
  if (!s.busy && s.mode) el('mode').value = previous.mode || s.mode;
  el('attachments').replaceChildren();
  for (const attachment of s.attachments || []) { const chip = make('span', 'file-chip', attachment.label), remove = make('button', '', '×'); remove.disabled = s.busy; remove.title = '移除引用'; remove.onclick = () => post('removeAttachment', { id: attachment.id }); chip.append(remove); el('attachments').append(chip); }
  const reviews = JSON.stringify(s.changes); if (reviews !== reviewSignature) {
    reviewSignature = reviews; el('review').hidden = !s.changes?.length; el('review-count').textContent = `${s.changes?.length || 0} 个文件`; el('review-files').replaceChildren();
    for (const change of s.changes || []) { const row = make('div', 'review-row'), file = make('button', 'review-path', change.relative); file.title = '查看修改差异'; file.onclick = () => post('diff', { path: change.path }); row.append(file);
      if (change.status === 'pending') { for (const [label, type] of [['保留', 'accept'], ['撤销', 'revert']]) { const button = make('button', 'text-button', label); button.onclick = () => post(type, { path: change.path }); row.append(button); } }
      else row.append(make('span', 'review-status', change.status === 'accepted' ? '已保留' : '已撤销')); el('review-files').append(row);
    }
  }
  if (!el('history-panel').hidden) renderHistory();
}
function resizeInput() { el('input').style.height = 'auto'; el('input').style.height = Math.min(200, Math.max(64, el('input').scrollHeight)) + 'px'; api.setState({ draft: el('input').value, mode: el('mode').value }); }
window.addEventListener('message', event => { if (event.data.type === 'state') render(event.data); if (event.data.type === 'sent') { el('input').value = ''; resizeInput(); } });
el('input').value = previous.draft || ''; if (previous.mode) el('mode').value = previous.mode;
el('input').addEventListener('input', () => { resizeInput(); if (el('input').value.endsWith('@') && !state.busy) post('attach'); });
el('input').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!state.busy) el('send').click(); } };
el('send').onclick = () => { if (state.busy) { post('stop'); return; } const text = el('input').value.trim(); if (text) post('send', { text, mode: el('mode').value }); };
el('more').onclick = () => { el('menu').hidden = !el('menu').hidden; };
el('history').onclick = () => { el('history-panel').hidden = !el('history-panel').hidden; renderHistory(); if (!el('history-panel').hidden) el('history-search').focus(); };
el('close-history').onclick = () => el('history-panel').hidden = true; el('history-search').oninput = renderHistory;
for (const id of ['new', 'refresh', 'login', 'folder', 'changes', 'terminal', 'rename', 'delete', 'attach', 'attachCurrent', 'settings']) el(id).onclick = () => { post(id); el('menu').hidden = true; if (id === 'new') el('input').focus(); };
el('model').onchange = () => post('model', { value: el('model').value }); el('effort').onchange = () => post('effort', { value: el('effort').value }); el('mode').onchange = () => { previous.mode = el('mode').value; resizeInput(); };
el('messages').onscroll = () => { const b = el('messages'); el('scroll-bottom').hidden = b.scrollHeight - b.scrollTop - b.clientHeight < 100; };
el('scroll-bottom').onclick = () => el('messages').scrollTop = el('messages').scrollHeight;
document.addEventListener('keydown', e => { if (e.key === 'Escape') { el('menu').hidden = true; el('history-panel').hidden = true; } });
document.addEventListener('click', e => { if (!el('menu').contains(e.target) && e.target !== el('more')) el('menu').hidden = true; });
resizeInput(); post('ready');
