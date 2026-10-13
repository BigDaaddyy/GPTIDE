const api = acquireVsCodeApi(), el = id => document.getElementById(id);
const projectKey = document.body.dataset.projectKey, savedState = api.getState() || {};
const projectStates = savedState.projects || {}, previous = projectStates[projectKey] || {};
const legacyState = savedState.projects ? savedState.legacy : savedState;
let invalidated = false;
const drafts = previous.drafts || {}; let draftKey, submittedDraft;
const draftTimes = previous.draftTimes || {}; let draftTimer, draftSequence = 0, pendingFocusChat;
let pendingTabChange = false;
let state = { busy: false, chats: [], messages: [] }, optionsSignature = '', reviewSignature = '';
const messageRows = new Map(); let renderedChat, visibleMessages = 100, layoutKey;
const taskRows = new Map(); let taskChat;
let tabsSignature;
const post = (type, data = {}) => { if (!invalidated) api.postMessage({ type, projectKey, ...data }); };
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
  const chats = [...(state.history || [])].filter(c => c.name.toLowerCase().includes(search)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!chats.length) el('history-list').append(make('div', 'history-empty', search ? '没有匹配的对话' : '这个项目还没有聊天记录'));
  for (const chat of chats) {
    const row = make('button', 'history-row' + (state.activeId === chat.id ? ' active' : '')); row.disabled = state.busy;
    row.append(make('span', 'name', chat.name), make('span', 'meta', (chat.hasDraft ? '草稿' : chat.source === 'cursor' ? 'Cursor' : 'GptIDE') + ` · ${chat.count} 条消息` + (chat.duplicates > 1 ? ` · ${chat.duplicates} 份合并` : '')));
    row.onclick = () => { flushDraft(); if (chat.id !== state.activeId) beginTabChange(); post('select', { id: chat.id }); el('history-panel').hidden = true; }; el('history-list').append(row);
  }
}
function renderMessages(s) {
  const chatKey = s.activeId || '__new__', switched = renderedChat !== chatKey;
  if (switched) { renderedChat = chatKey; visibleMessages = 100; }
  const box = el('messages'), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 100, oldTop = box.scrollTop;
  const nextLayout = JSON.stringify([chatKey, s.source, !s.messages.length]);
  if (nextLayout !== layoutKey) { box.replaceChildren(); messageRows.clear(); layoutKey = nextLayout; }
  if (!s.messages.length) {
    el('scroll-bottom').hidden = true; return;
  }
  if (s.source === 'cursor' && !box.querySelector('.source')) box.append(make('div', 'source', 'Cursor · 导入记录'));
  const start = Math.max(0, s.messages.length - visibleMessages);
  let more = box.querySelector('.load-older');
  if (start && !more) { more = make('button', 'load-older text-button'); box.prepend(more); }
  if (more) { more.hidden = !start; more.textContent = `加载更早的消息（还有 ${start} 条）`; more.onclick = () => { const height = box.scrollHeight, top = box.scrollTop; visibleMessages += 100; renderMessages(state); box.scrollTop = top + box.scrollHeight - height; }; }
  const visible = new Set();
  for (let index = start; index < s.messages.length; index++) {
    const message = s.messages[index], key = message.itemId || 'message-' + index; visible.add(key);
    const signature = JSON.stringify(message); let row = messageRows.get(key);
    if (row && row.signature === signature) continue;
    if (row) {
      row.body.replaceChildren(); content(row.body, message.text); row.signature = signature; row.message = message; continue;
    }
    const item = make('article', 'message ' + message.role), role = make('div', 'role', message.role === 'user' ? '你' : s.source === 'cursor' ? 'Cursor' : 'GptIDE');
    if (message.mode) role.append(make('span', 'badge', message.mode));
    const copy = make('button', 'copy-message', '复制'); copy.onclick = () => post('copy', { text: messageRows.get(key).message.text }); role.append(copy);
    const body = make('div', 'content'); content(body, message.text); item.append(role, body);
    if (message.attachments?.length) { const files = make('div', 'message-files'); for (const label of message.attachments) files.append(make('span', 'file-chip', label)); item.append(files); }
    row = { item, body, signature, message }; messageRows.set(key, row);
  }
  for (const [key, row] of messageRows) if (!visible.has(key)) { row.item.remove(); messageRows.delete(key); }
  // Reconcile order without detaching stable rows during token streaming.
  const ordered = [...visible].map(key => messageRows.get(key).item);
  for (let i = ordered.length - 1, next = null; i >= 0; i--) { const item = ordered[i]; if (item.parentNode !== box || item.nextSibling !== next) box.insertBefore(item, next); next = item; }
  if (atBottom || switched) box.scrollTop = box.scrollHeight; else box.scrollTop = oldTop;
  el('scroll-bottom').hidden = box.scrollHeight - box.scrollTop - box.clientHeight < 100;
}
function renderTasks(s) {
  const tasks = s.tasks || [], key = s.activeId || '__new__';
  el('task-panel').hidden = !tasks.length; el('task-count').textContent = `${tasks.length} 个步骤`;
  if (key !== taskChat) { taskChat = key; taskRows.clear(); el('task-list').replaceChildren(); }
  const keys = new Set();
  const kinds = { read: '读取', search: '查找', command: '命令', file: '文件', tool: '工具' };
  const statuses = { running: s.busy ? '运行中' : '未确认结果', completed: '完成', failed: '失败', interrupted: '已停止', ended: '已结束' };
  for (const task of tasks) {
    const id = task.turnId + ':' + task.id; keys.add(id); let row = taskRows.get(id);
    if (!row) {
      const node = make('details', 'task-row'), summary = make('summary'), label = make('span', 'task-name'), status = make('span', 'task-state'); summary.append(label, status);
      const body = make('div', 'task-body'), meta = make('div', 'task-meta'), files = make('div', 'task-files'), output = make('pre', 'task-output'), copy = make('button', 'text-button', '复制输出');
      copy.onclick = () => post('copy', { text: row.task.output || '' }); body.append(meta, files, output, copy); node.append(summary, body); el('task-list').append(node);
      row = { node, label, status, meta, files, output, copy }; taskRows.set(id, row);
    }
    row.task = task; row.label.textContent = `#${task.turn || 1} · ${kinds[task.kind] || '步骤'} · ${task.title}`; row.label.title = task.title;
    row.status.textContent = statuses[task.status] || task.status; row.status.className = 'task-state ' + task.status;
    row.meta.textContent = [typeof task.exitCode === 'number' ? `退出码 ${task.exitCode}` : '', typeof task.durationMs === 'number' ? `${(task.durationMs / 1000).toFixed(1)} 秒` : '', task.truncated ? '输出仅保留最后 12000 字符' : ''].filter(Boolean).join(' · ');
    if (row.output.textContent !== (task.output || '')) row.output.textContent = task.output || ''; row.output.hidden = !task.output; row.copy.disabled = !task.output;
    const files = JSON.stringify(task.files || []);
    if (files !== row.filesSignature) { row.filesSignature = files; row.files.replaceChildren(); for (const file of task.files || []) { const button = make('button', 'link', file); button.title = '打开项目文件'; button.onclick = () => post('openFile', { path: file }); row.files.append(button); } }
  }
  for (const [id, row] of taskRows) if (!keys.has(id)) { row.node.remove(); taskRows.delete(id); }
}
function render(s) {
  const tabs = JSON.stringify([s.openChatIds, s.activeId, s.busy, s.chats.map(c => [c.id, c.name])]);
  if (tabs !== tabsSignature) {
    tabsSignature = tabs; el('chat-tabs').replaceChildren();
    for (const id of s.openChatIds || []) {
      const chat = s.chats.find(c => c.id === id); if (!chat) continue;
      const tab = make('div', 'chat-tab' + (s.activeId === id ? ' active' : ''));
      const button = make('button', 'chat-tab-name', chat.name); button.dataset.chatId = id; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(s.activeId === id)); button.disabled = s.busy; button.title = chat.name; button.onclick = () => post('select', { id });
      button.tabIndex = s.activeId === id ? 0 : -1; button.onclick = () => { flushDraft(); if (id !== state.activeId) beginTabChange(); post('select', { id }); };
      const close = make('button', 'chat-tab-close', '×'); close.title = '关闭 Tab'; close.setAttribute('aria-label', '关闭 ' + chat.name); close.disabled = s.busy; close.tabIndex = -1; close.onclick = () => { flushDraft(); if (id === state.activeId) beginTabChange(); post('closeTab', { id, draft: id === draftKey ? el('input').value : drafts[id] }); }; tab.append(button, close); el('chat-tabs').append(tab);
    }
  }
  const nextKey = s.activeId || '__new__';
  if (pendingTabChange && (nextKey !== draftKey || s.busy)) { pendingTabChange = false; el('input').disabled = false; if (!pendingFocusChat) el('input').focus(); }
  if (nextKey !== draftKey) {
    flushDraft();
    if (draftKey !== undefined) drafts[draftKey] = el('input').value;
    const transferring = s.busy && submittedDraft !== undefined;
    const localNewer = draftTimes[nextKey] === undefined || draftTimes[nextKey] > (s.draftUpdatedAt || 0);
    const nextDraft = transferring ? el('input').value : localNewer ? drafts[nextKey] ?? s.draft ?? '' : s.draft ?? '';
    if (transferring) drafts[draftKey] = '';
    el('input').value = nextDraft;
    draftKey = nextKey; el('draft-state').textContent = ''; resizeInput();
    if (transferring) scheduleDraft();
  }
  if (pendingFocusChat) { const target = [...el('chat-tabs').querySelectorAll('[role="tab"]')].find(b => b.dataset.chatId === pendingFocusChat); target?.focus(); pendingFocusChat = undefined; }
  renderMessages(s); renderTasks(s); state = s;
  el('input').disabled = pendingTabChange || !!s.loadingScope;
  const chat = s.chats.find(c => c.id === s.activeId);
  el('project').textContent = s.project ? s.project.split(/[\\/]/).pop() : '打开文件夹'; el('project').title = s.project;
  el('chat-title').textContent = chat?.name || '新对话'; el('status').textContent = s.status; el('status').title = s.status;
  el('connection').classList.toggle('connected', ['chatgpt', 'chatgptAuthTokens'].includes(s.account?.type)); el('plan').textContent = s.account?.plan ? s.account.plan.toUpperCase() : s.preferences?.autoConnect === false ? '离线' : '未登录';
  el('login').textContent = s.account?.type === 'chatgpt' ? '切换 ChatGPT 账号' : 'ChatGPT 登录';
  el('activity').hidden = !s.busy; el('activity-text').textContent = s.activity || '正在思考…';
  el('warning').textContent = s.warning || ''; el('warning').hidden = !s.warning;
  el('send').textContent = s.busy ? '■' : '↑'; el('send').title = s.busy ? '停止生成' : '发送消息';
  for (const id of ['new', 'refresh', 'rename', 'delete', 'model', 'effort', 'mode', 'folder', 'attach', 'attachCurrent']) el(id).disabled = s.busy;
  const options = JSON.stringify([s.models, s.model, s.effort, s.preferences?.autoConnect]);
  if (options !== optionsSignature) {
    optionsSignature = options; el('model').replaceChildren(); if (!s.models.length) el('model').add(new Option(s.preferences?.autoConnect === false ? '发送时加载模型' : '登录后加载模型', ''));
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
function resizeInput() { el('input').style.height = 'auto'; el('input').style.height = Math.min(200, Math.max(34, el('input').scrollHeight)) + 'px'; if (draftKey !== undefined) { if (drafts[draftKey] !== el('input').value) draftTimes[draftKey] = Date.now(); drafts[draftKey] = el('input').value; } projectStates[projectKey] = { drafts, draftTimes, mode: el('mode').value }; api.setState({ projects: projectStates, legacy: legacyState }); }
function flushDraft() { clearTimeout(draftTimer); if (draftKey === undefined || draftKey === '__new__' || invalidated) return; post('draft', { id: draftKey, text: el('input').value, sequence: ++draftSequence }); }
function beginTabChange() { pendingTabChange = true; el('input').disabled = true; }
function scheduleDraft() { clearTimeout(draftTimer); el('draft-state').textContent = el('input').value ? '草稿…' : ''; draftTimer = setTimeout(flushDraft, 650); }
window.addEventListener('message', event => { const data = event.data; if (data.projectKey !== projectKey || invalidated) return; if (data.type === 'reset') { clearTimeout(draftTimer); invalidated = true; document.body.hidden = true; return; } if (data.type === 'tabChangePending') beginTabChange(); if (data.type === 'tabChangeRejected') { pendingTabChange = false; el('input').disabled = !!state.loadingScope; } if (data.type === 'state') render(data); if (data.type === 'draftSaved') { if (data.history) { state.history = data.history; if (!el('history-panel').hidden) renderHistory(); } if (data.id === draftKey && data.sequence === draftSequence) el('draft-state').textContent = data.saved ? el('input').value ? '草稿已保存' : '' : '草稿未保存'; } if (data.type === 'sent') { if (el('input').value === submittedDraft) el('input').value = ''; submittedDraft = undefined; resizeInput(); flushDraft(); } });
el('input').value = previous.draft || ''; if (previous.mode) el('mode').value = previous.mode;
el('input').addEventListener('input', () => { resizeInput(); scheduleDraft(); if (el('input').value.endsWith('@') && !state.busy) post('attach'); });
el('input').onkeydown = e => { const sendKey = state.preferences?.submitKey === 'ctrlEnter' ? e.ctrlKey || e.metaKey : !e.ctrlKey && !e.metaKey; if (e.key === 'Enter' && sendKey && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); if (!state.busy) el('send').click(); } };
el('send').onclick = () => { if (state.busy) { post('stop'); return; } const text = el('input').value.trim(); if (text) { flushDraft(); submittedDraft = el('input').value; post('send', { text, mode: el('mode').value }); } };
el('more').onclick = () => { el('menu').hidden = !el('menu').hidden; };
el('history').onclick = () => { el('history-panel').hidden = !el('history-panel').hidden; renderHistory(); if (!el('history-panel').hidden) el('history-search').focus(); };
el('close-history').onclick = () => el('history-panel').hidden = true; el('history-search').oninput = renderHistory;
for (const id of ['new', 'refresh', 'login', 'folder', 'changes', 'terminal', 'rename', 'delete', 'attach', 'attachCurrent', 'settings', 'usage', 'attachDiagnostics', 'attachGitDiff', 'attachFolder']) el(id).onclick = () => { flushDraft(); if (id === 'new') beginTabChange(); post(id); el('menu').hidden = true; };
el('model').onchange = () => post('model', { value: el('model').value }); el('effort').onchange = () => post('effort', { value: el('effort').value }); el('mode').onchange = () => { previous.mode = el('mode').value; resizeInput(); };
el('messages').onscroll = () => { const b = el('messages'); el('scroll-bottom').hidden = b.scrollHeight - b.scrollTop - b.clientHeight < 100; };
el('scroll-bottom').onclick = () => el('messages').scrollTop = el('messages').scrollHeight;
document.addEventListener('keydown', e => { if (e.key === 'Escape') { el('menu').hidden = true; el('history-panel').hidden = true; } });
document.addEventListener('click', e => { if (!el('menu').contains(e.target) && e.target !== el('more')) el('menu').hidden = true; });
el('chat-tabs').addEventListener('keydown', e => {
  if (state.busy || e.target.getAttribute('role') !== 'tab') return;
  const ids = state.openChatIds || [], index = ids.indexOf(e.target.dataset.chatId); let next;
  if (e.key === 'ArrowRight') next = ids[(index + 1) % ids.length];
  if (e.key === 'ArrowLeft') next = ids[(index + ids.length - 1) % ids.length];
  if (e.key === 'Home') next = ids[0]; if (e.key === 'End') next = ids.at(-1);
  if (e.key === 'Delete') { e.preventDefault(); flushDraft(); beginTabChange(); post('closeTab', { id: ids[index], draft: ids[index] === draftKey ? el('input').value : drafts[ids[index]] }); }
  if (next && next !== state.activeId) { e.preventDefault(); flushDraft(); beginTabChange(); pendingFocusChat = next; post('select', { id: next }); }
});
window.addEventListener('pagehide', flushDraft);
resizeInput(); post('ready');
