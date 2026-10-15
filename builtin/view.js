const api = acquireVsCodeApi(), el = id => document.getElementById(id);
const projectKey = document.body.dataset.projectKey, savedState = api.getState() || {};
const projectStates = savedState.projects || {}, previous = projectStates[projectKey] || {};
const legacyState = savedState.projects ? savedState.legacy : savedState;
let invalidated = false;
const drafts = previous.drafts || {}; let draftKey, submittedDraft, submittedSendId, submittedInputRevision;
const sendPrefix = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); let sendSequence = 0, inputRevision = 0;
const draftTimes = previous.draftTimes || {}; let draftTimer, draftSequence = 0, pendingFocusChat;
let pendingTabChange = false, pendingSend = false, pendingQueue = false;
let handledFocusId;
let state = { busy: false, chats: [], messages: [] }, optionsSignature = '', reviewSignature = '';
const messageRows = new Map(); let renderedChat, visibleMessages = 100, layoutKey;
const taskRows = new Map(); let taskChat;
const pendingCopies=new Map();let copySequence=0;
let showTasks=false,reviewChat;
let tabsSignature, messageAnchor = null, findPosition = 0, findHits = [], findQuery = '', findTimer, findChat, taskFilterSignature;
const findCache = new Map();
let quickRows = [], quickIndex = 0, quickSignature = '', quickDismissed;
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
function codeWidget(node,index) {
  const wrapper=make('div','code-block'),header=make('div','code-title'),title=make('span'),copy=make('button','','复制'),open=make('button','','编辑器'),expand=make('button','','展开'),pre=make('pre'),code=make('code');
  const widget={wrapper,title,copy,pre,code,expand,expanded:false};open.title='在临时只读编辑器打开';
  open.onclick=()=>post('openCode',{id:state.activeId,index:Number(node.closest('.message').dataset.messageIndex),codeIndex:index,revision:state.revision});
  copy.onclick=()=>{const id=sendPrefix+'-copy-'+(++copySequence);copy.disabled=true;copy.textContent='复制中';clearTimeout(widget.copyTimer);const timer=setTimeout(()=>{pendingCopies.delete(id);copy.disabled=false;copy.textContent='复制';copy.title='复制未确认，可重试';},5000);pendingCopies.set(id,{widget,timer});post('copy',{text:widget.block.text,copyId:id});};
  expand.onclick=()=>{widget.expanded=!widget.expanded;updateCode(widget,widget.block);};
  header.append(title,make('span','spacer',''),open,copy,expand);pre.append(code);wrapper.append(header,pre);return widget;
}
function updateCode(widget,block) {
  if(widget.block?.text!==block.text||widget.block?.language!==block.language){widget.code.replaceChildren();for(const token of codeTokens(block.text,block.language))widget.code.append(token.kind==='plain'?document.createTextNode(token.text):make('span','code-'+token.kind,token.text));}
  widget.block=block;widget.title.textContent=block.language||'code';const long=block.text.split('\n').length>24;widget.pre.classList.toggle('code-folded',long&&!widget.expanded);widget.expand.hidden=!long;widget.expand.textContent=widget.expanded?'折叠':'展开';widget.expand.setAttribute('aria-expanded',String(widget.expanded));
}
function content(node,text) {
  const widgets=node.codeWidgets||(node.codeWidgets=new Map()),children=[];let codeIndex=0;
  for(const block of parseMarkdown(text)) {
    if(block.type==='code'){const index=codeIndex++;let widget=widgets.get(index);if(!widget){widget=codeWidget(node,index);widgets.set(index,widget);}updateCode(widget,block);children.push(widget.wrapper);}
    else if(block.type==='list'){const list=make(block.ordered?'ol':'ul');for(const value of block.items){const li=make('li');inline(li,value);list.append(li);}children.push(list);}
    else if(block.type==='table'){const wrapper=make('div','table-wrap'),table=make('table'),head=make('tr');for(const cell of block.header){const th=make('th');inline(th,cell);head.append(th);}table.append(head);for(const values of block.rows){const row=make('tr');for(const cell of values){const td=make('td');inline(td,cell);row.append(td);}table.append(row);}wrapper.append(table);children.push(wrapper);}
    else{const element=make(block.type==='heading'?'h'+block.level:block.type==='quote'?'blockquote':block.type==='rule'?'hr':'p');if(block.text)inline(element,block.text);children.push(element);}
  }
  for(const index of widgets.keys())if(index>=codeIndex)widgets.delete(index);
  const keep=new Set(children);for(const child of [...node.childNodes])if(!keep.has(child))child.remove();
  for(let i=children.length-1,next=null;i>=0;i--){const child=children[i];if(child.parentNode!==node||child.nextSibling!==next)node.insertBefore(child,next);next=child;}
}
function historyIcon(button,type){const paths={pin:'M16 3H8v2l2 2v5l-3 3v1h10v-1l-3-3V7l2-2ZM12 16v5',archive:'M3 3h18v4H3zM5 7v14h14V7M9 11h6',restore:'M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12'};const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),shape=document.createElementNS('http://www.w3.org/2000/svg','path');for(const [key,value] of Object.entries({width:'14',height:'14',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.5','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);shape.setAttribute('d',paths[type]);svg.append(shape);button.replaceChildren(svg);}
let historyArchived=false;
function renderHistory() {
  const search=el('history-search').value.toLowerCase(),list=el('history-list'),focused=document.activeElement,focusedId=focused.closest?.('.history-row')?.dataset.chatId,focusedAction=focused.dataset.historyAction;list.replaceChildren();
  const chats=[...(state.history||[])].filter(c=>!!c.archived===historyArchived&&c.name.toLowerCase().includes(search)).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||(b.updatedAt||0)-(a.updatedAt||0));
  el('history-archived').setAttribute('aria-pressed',String(historyArchived));el('history-archived').textContent=historyArchived?'返回对话':'Archived';
  if(!chats.length)list.append(make('div','history-empty',search?'没有匹配的对话':historyArchived?'没有归档对话':'这个项目还没有聊天记录'));
  for(const chat of chats){
    const row=make('div','history-row'+(state.activeId===chat.id?' active':'')),open=make('button','history-open'),name=make('span','name',(chat.pinned?'⌖ ':'')+chat.name),meta=make('span','meta',(chat.hasDraft?'草稿':chat.source==='cursor'?'Cursor':'GptIDE')+' · '+chat.count+' 条消息'),actions=make('div','history-actions'),menu=make('div','history-item-menu');menu.hidden=true;open.append(name,meta);
    row.dataset.chatId=chat.id;open.dataset.historyAction='open';const locked=!!(state.operationLocked||state.busy||state.storageBlocked);open.disabled=locked;
    open.onclick=()=>{flushDraft();if(chat.id!==state.activeId)beginTabChange();post('select',{id:chat.id});closeHistory();};
    const action=(label,title,type,value)=>{const button=make('button','history-action',label);button.dataset.historyAction=type||'options';button.title=title;button.setAttribute('aria-label',title);button.disabled=locked;button.onclick=()=>{flushDraft();post(type,{id:chat.id,value});};actions.append(button);return button;};
    const pin=action('',''+(chat.pinned?'取消置顶':'Pin'),'pinChat',!chat.pinned);pin.setAttribute('aria-pressed',String(!!chat.pinned));historyIcon(pin,'pin');
    historyIcon(action('',chat.archived?'恢复对话':'Archive','archiveChat',!chat.archived),chat.archived?'restore':'archive');
    const more=action('⋯','More options','');more.onclick=()=>{const show=menu.hidden;for(const other of list.querySelectorAll('.history-item-menu'))other.hidden=true;for(const button of list.querySelectorAll('.history-actions button[aria-expanded]'))button.setAttribute('aria-expanded','false');menu.hidden=!show;more.setAttribute('aria-expanded',String(show));if(show)menu.querySelector('button').focus();};more.setAttribute('aria-expanded','false');
    for(const [label,type] of [['Rename','rename'],['Delete','delete']]){const button=make('button',type==='delete'?'danger':'',label);button.dataset.historyAction=type;button.disabled=locked;button.onclick=()=>{flushDraft();post(type,{id:chat.id});menu.hidden=true;more.setAttribute('aria-expanded','false');};menu.append(button);}
    menu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();menu.hidden=true;more.setAttribute('aria-expanded','false');more.focus();}if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const buttons=[...menu.querySelectorAll('button')];buttons[(buttons.indexOf(document.activeElement)+1)%buttons.length].focus();}});
    row.append(open,actions,menu);list.append(row);
  }
  if(focusedId){const row=[...list.children].find(node=>node.dataset.chatId===focusedId),action=['rename','delete'].includes(focusedAction)?'options':focusedAction,target=[...(row?.querySelectorAll('[data-history-action]')||[])].find(node=>node.dataset.historyAction===action);if(target&&!target.disabled)target.focus();else el('history-search').focus();}
}

function renderQueue(s) {
  const queue = s.queue || []; el('queue-panel').hidden = !queue.length; el('queue-count').textContent = queue.length;
  el('queue-status').textContent = s.queuePaused ? '已暂停' : '本轮完成后继续'; el('queue-pause').textContent = s.queuePaused ? '继续队列' : '暂停队列'; el('queue-pause').disabled = !!s.loginPending || !!s.inlineBusy || !!s.reviewBusy || !!s.storageBlocked;
  el('queue-list').replaceChildren();
  for (const [index, item] of queue.entries()) {
    const row = make('div', 'queue-row'), text = make('span', 'queue-text', item.text.slice(0, 160)); text.title = item.text.slice(0, 1000); row.append(make('span', 'badge', item.mode), text);
    if (item.status !== 'pending') { const status = make('span', 'queue-item-status', item.status === 'starting' ? '发送中' : '未确认'); status.title = item.error || ''; row.append(status); }
    const actions = [['编辑','queueEdit'],['↑','queueMove',-1],['↓','queueMove',1],['×','queueRemove']]; if (item.status === 'failed') actions.unshift(['重试','queueRetry']);
    for (const [label, type, direction] of actions) { const button = make('button', 'text-button', label); button.title = type === 'queueRetry' ? '检查对话后重试，避免重复执行' : label; button.disabled = s.loginPending || s.inlineBusy || s.reviewBusy || s.storageBlocked || item.status === 'starting' || direction === -1 && !index || direction === 1 && index === queue.length - 1; button.onclick = () => post(type, { id: item.id, direction }); row.append(button); }
    el('queue-list').append(row);
  }
}
function renderMessages(s) {
  const chatKey = s.activeId || '__new__', switched = renderedChat !== chatKey;
  if (switched) { renderedChat = chatKey; visibleMessages = 100; messageAnchor = null; }
  const box = el('messages'), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 100, oldTop = box.scrollTop;
  const nextLayout = JSON.stringify([chatKey, s.source, s.branch, !s.messages.length]);
  if (nextLayout !== layoutKey) { box.replaceChildren(); messageRows.clear(); layoutKey = nextLayout; }
  if (!s.messages.length) {
    el('scroll-bottom').hidden = true; return;
  }
  if (s.source === 'cursor' && !box.querySelector('.source')) box.append(make('div', 'source', 'Cursor · 导入记录'));
  if (s.branch && !box.querySelector('.branch-source')) box.append(make('div', 'branch-source', `分支自 ${s.branch.name} · 第 ${s.branch.messageIndex + 1} 条消息`));
  const start = messageAnchor === null ? Math.max(0, s.messages.length - visibleMessages) : Math.max(0, messageAnchor - 40);
  const end = messageAnchor === null ? s.messages.length : Math.min(s.messages.length, start + 100);
  let more = box.querySelector('.load-older');
  if (start && !more) { more = make('button', 'load-older text-button'); box.prepend(more); }
  if (more) { more.hidden = !start; more.textContent = `加载更早的消息（还有 ${start} 条）`; more.onclick = () => { const height = box.scrollHeight, top = box.scrollTop; if (messageAnchor === null) visibleMessages += 100; else messageAnchor = Math.max(0, start - 100) + 40; renderMessages(state); box.scrollTop = Math.max(0, top + box.scrollHeight - height); updateFind(false); }; }
  let newer = box.querySelector('.return-latest');
  if (end < s.messages.length && !newer) newer = make('button', 'return-latest text-button', '返回最新消息');
  if (newer) { newer.hidden = end === s.messages.length; newer.onclick = () => { messageAnchor = null; visibleMessages = 100; renderMessages(state); updateFind(false); box.scrollTop = box.scrollHeight; }; }
  const visible = new Set();
  for (let index = start; index < end; index++) {
    const message = s.messages[index], key = message.itemId || 'message-' + index; visible.add(key);
    const signature = JSON.stringify(message); let row = messageRows.get(key);
    if (row) { row.item.dataset.messageIndex = String(index); row.branch.disabled = s.operationLocked || s.busy || s.reviewBusy || s.storageBlocked; }
    if (row && row.signature === signature) continue;
    if (row) {
      content(row.body, message.text); row.signature = signature; row.message = message; continue;
    }
    const item = make('article', 'message ' + message.role), role = make('div', 'role', message.role === 'user' ? '你' : s.source === 'cursor' ? 'Cursor' : 'GptIDE');
    item.dataset.messageIndex = String(index);
    if (message.mode) role.append(make('span', 'badge', message.mode));
    const copy = make('button', 'copy-message', '复制'); copy.onclick = () => post('copy', { text: messageRows.get(key).message.text }); role.append(copy);
    const branch = make('button', 'branch-message', '⑂'); branch.title = '从这里创建会话分支'; branch.setAttribute('aria-label', '从这里创建会话分支'); branch.disabled = s.operationLocked || s.busy || s.reviewBusy || s.storageBlocked;
    branch.onclick = () => { flushDraft(); beginTabChange(); post('branch', { id: state.activeId, index: Number(item.dataset.messageIndex), revision: state.revision }); }; role.append(branch);
    const body = make('div', 'content'); content(body, message.text); item.append(role, body);
    if (message.attachments?.length) { const files = make('div', 'message-files'); for (const label of message.attachments) files.append(make('span', 'file-chip', label)); item.append(files); }
    row = { item, body, signature, message, branch }; messageRows.set(key, row);
  }
  for (const [key, row] of messageRows) if (!visible.has(key)) { row.item.remove(); messageRows.delete(key); }
  // Reconcile order without detaching stable rows during token streaming.
  const ordered = [...visible].map(key => messageRows.get(key).item); if (newer) ordered.push(newer);
  for (let i = ordered.length - 1, next = null; i >= 0; i--) { const item = ordered[i]; if (item.parentNode !== box || item.nextSibling !== next) box.insertBefore(item, next); next = item; }
  if ((atBottom && messageAnchor === null) || switched) box.scrollTop = box.scrollHeight; else box.scrollTop = oldTop;
  el('scroll-bottom').hidden = box.scrollHeight - box.scrollTop - box.clientHeight < 100;
}
function highlightFind() {
  document.querySelectorAll('.find-current').forEach(e => e.classList.remove('find-current')); globalThis.CSS?.highlights?.delete('gptide-find');
  const index = findHits[findPosition], row = [...el('messages').querySelectorAll('.message')].find(e => Number(e.dataset.messageIndex) === index);
  if (!row || !findQuery || el('find-bar').hidden) return;
  row.classList.add('find-current');
  if (!globalThis.CSS?.highlights || typeof Highlight === 'undefined') return;
  const ranges = [], walker = document.createTreeWalker(row.querySelector('.content'), NodeFilter.SHOW_TEXT), pattern = new RegExp(escapeFindQuery(findQuery), 'giu'); let node;
  while (ranges.length < 500 && (node = walker.nextNode())) for (const match of node.textContent.matchAll(pattern)) { const range = document.createRange(); range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length); ranges.push(range); if (ranges.length >= 500) break; }
  CSS.highlights.set('gptide-find', new Highlight(...ranges));
}
function jumpFind() {
  const index = findHits[findPosition]; if (index === undefined) { highlightFind(); return; }
  const existing = [...el('messages').querySelectorAll('.message')].find(e => Number(e.dataset.messageIndex) === index);
  if (!existing) { messageAnchor = index; renderMessages(state); }
  highlightFind(); const row = [...el('messages').querySelectorAll('.message')].find(e => Number(e.dataset.messageIndex) === index); row?.scrollIntoView({ block: 'center' });
}
function updateFind(jump = false) {
  if (el('find-bar').hidden) return;
  const query = el('find-query').value, changed = query !== findQuery || findChat !== state.activeId, previousIndex = findHits[findPosition];
  if (changed) { findCache.clear(); findPosition = 0; findChat = state.activeId; }
  findQuery = query; findHits = findMessageMatches(state.messages || [], query, findCache);
  if (!changed && findHits.includes(previousIndex)) findPosition = findHits.indexOf(previousIndex);
  findPosition = Math.min(findPosition, Math.max(0, findHits.length - 1));
  el('find-count').textContent = `${findHits.length ? findPosition + 1 : 0}/${findHits.length}`; el('find-count').title = `${findHits.length} 条匹配消息`;
  el('find-prev').disabled = el('find-next').disabled = !findHits.length;
  if (jump || (changed && query)) jumpFind(); else highlightFind();
}
function showFind() { if (state.loadingScope) return; el('find-bar').hidden = false; el('find-query').focus(); el('find-query').select(); updateFind(false); }
function closeFind() { clearTimeout(findTimer); el('find-bar').hidden = true; document.querySelectorAll('.find-current').forEach(e => e.classList.remove('find-current')); globalThis.CSS?.highlights?.delete('gptide-find'); el('input').focus(); }
function moveFind(delta) { if (!findHits.length) return; findPosition = (findPosition + delta + findHits.length) % findHits.length; updateFind(false); jumpFind(); }
function renderTasks(s) {
  const tasks = s.tasks || [], key = s.activeId || '__new__';
  if(key!==taskChat){showTasks=false;el('task-panel').open=false;}
  el('task-panel').hidden = !tasks.length || !showTasks && !s.busy && !tasks.some(t=>t.status==='failed');
  el('task-toggle').disabled=!tasks.length;
  if (key !== taskChat) { taskChat = key; taskRows.clear(); el('task-list').replaceChildren(); el('task-filter').value = 'all'; el('task-failures').setAttribute('aria-pressed', 'false'); taskFilterSignature = undefined; }
  const turns = [...new Set(tasks.map(t => t.turn || 1))].sort((a, b) => b - a), signature = JSON.stringify(turns);
  if (signature !== taskFilterSignature) { const selected = el('task-filter').value; el('task-filter').replaceChildren(new Option('所有轮次', 'all'), ...turns.map(t => new Option(`第 ${t} 轮`, String(t)))); el('task-filter').value = turns.some(t => String(t) === selected) ? selected : 'all'; taskFilterSignature = signature; }
  const visibleTask = t => (el('task-filter').value === 'all' || String(t.turn || 1) === el('task-filter').value) && (el('task-failures').getAttribute('aria-pressed') !== 'true' || t.status === 'failed');
  const count = tasks.filter(visibleTask).length; el('task-count').textContent = count === tasks.length ? `${count} 个步骤` : `${count}/${tasks.length} 个步骤`;
  el('task-empty').hidden = !!count; el('task-copy').disabled = !count;
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
    row.node.hidden = !visibleTask(task);
    row.status.textContent = statuses[task.status] || task.status; row.status.className = 'task-state ' + task.status;
    row.meta.textContent = [typeof task.exitCode === 'number' ? `退出码 ${task.exitCode}` : '', typeof task.durationMs === 'number' ? `${(task.durationMs / 1000).toFixed(1)} 秒` : '', task.truncated ? '输出仅保留最后 12000 字符' : ''].filter(Boolean).join(' · ');
    if (row.output.textContent !== (task.output || '')) row.output.textContent = task.output || ''; row.output.hidden = !task.output; row.copy.disabled = !task.output;
    const files = JSON.stringify(task.files || []);
    if (files !== row.filesSignature) { row.filesSignature = files; row.files.replaceChildren(); for (const file of task.files || []) { const button = make('button', 'link', file); button.title = '打开项目文件'; button.onclick = () => post('openFile', { path: file }); row.files.append(button); } }
  }
  for (const [id, row] of taskRows) if (!keys.has(id)) { row.node.remove(); taskRows.delete(id); }
}
function render(s) {
  if (s.busy && !s.loadingScope && !pendingQueue) pendingSend = false;
  const tabs = JSON.stringify([s.openChatIds, s.activeId, s.operationLocked, s.busy, s.reviewBusy, s.chats.map(c => [c.id, c.name])]);
  if (tabs !== tabsSignature) {
    tabsSignature = tabs; el('chat-tabs').replaceChildren();
    for (const id of s.openChatIds || []) {
      const chat = s.chats.find(c => c.id === id); if (!chat) continue;
      const tab = make('div', 'chat-tab' + (s.activeId === id ? ' active' : ''));
      const button = make('button', 'chat-tab-name', chat.name); button.dataset.chatId = id; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(s.activeId === id)); button.disabled = s.busy; button.title = chat.name; button.onclick = () => post('select', { id });
      button.disabled = s.operationLocked || s.busy || s.reviewBusy; button.tabIndex = s.activeId === id ? 0 : -1; button.onclick = () => { flushDraft(); if (id !== state.activeId) beginTabChange(); post('select', { id }); };
      const close = make('button', 'chat-tab-close', '×'); close.title = '关闭 Tab'; close.setAttribute('aria-label', '关闭 ' + chat.name); close.disabled = s.operationLocked || s.busy || s.reviewBusy; close.tabIndex = -1; close.onclick = () => { flushDraft(); if (id === state.activeId) beginTabChange(); post('closeTab', { id, draft: id === draftKey ? el('input').value : drafts[id] }); }; tab.append(button, close); el('chat-tabs').append(tab);
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
  updateFind(false);
  el('input').disabled = pendingTabChange || !!s.loadingScope || !!s.storageBlocked;
  const chat = s.chats.find(c => c.id === s.activeId);
  el('project').textContent = s.project ? s.project.split(/[\\/]/).pop() : '打开文件夹'; el('project').title = s.project;
  el('chat-title').textContent = chat?.name || '新对话'; el('status').textContent = s.status; el('status').title = s.status;
  el('status').hidden=!s.storageBlocked&&!/失败|错误|未能|拒绝|已变化|已有后续修改|无法|不可用|未确认/.test(s.status||'');
  el('more').title=s.status||'更多操作';
  if(reviewChat!==s.activeId){reviewChat=s.activeId;el('review-details').hidden=true;el('review-toggle').setAttribute('aria-expanded','false');}
  el('connection').classList.toggle('connected', s.connected === true); el('connection').title = s.loginPending ? '等待 ChatGPT 登录' : s.connected ? 'ChatGPT 已连接' : '未连接'; el('plan').textContent = s.account?.plan ? s.account.plan.toUpperCase() : s.preferences?.autoConnect === false ? '离线' : '未登录';
  el('login').textContent = s.loginPending ? '等待 ChatGPT 登录…' : ['chatgpt', 'chatgptAuthTokens'].includes(s.account?.type) ? '切换 ChatGPT 账号' : 'ChatGPT 登录';
  el('login').disabled = !!s.operationLocked;
  el('login-state').hidden = !s.loginPending; el('cancel-login').disabled = !s.canCancelLogin;
  el('activity').hidden = !s.busy; el('activity-text').textContent = s.activity || '正在思考…';
  el('warning').textContent = s.warning || ''; el('warning').hidden = !s.warning;
  el('send').textContent = s.busy ? '■' : '↑'; el('send').title = s.busy ? '停止生成' : '发送消息';
  for (const id of ['new', 'refresh', 'rename', 'delete', 'model', 'effort', 'folder', 'attach', 'attachCurrent']) el(id).disabled = s.operationLocked || s.busy || s.reviewBusy;
  for (const id of ['new', 'rename', 'delete']) el(id).disabled ||= !!s.storageBlocked;
  syncSend();
  el('send').setAttribute('aria-label', s.busy ? '停止生成' : '发送消息');
  el('recovery').hidden = s.busy || s.inlineBusy || !['failed', 'interrupted', 'unknown'].includes(s.lastOutcome);
  el('recovery-label').textContent = s.lastOutcome === 'unknown' ? '上次结果未确认' : s.lastOutcome === 'interrupted' ? '任务已停止' : '任务未完成';
  el('restore-request').disabled = !s.canRestore || !!el('input').value.trim() || s.storageBlocked; el('restore-request').title = '只取回草稿，不发送；当前草稿需为空';
  el('recover-connect').disabled = !!s.operationLocked || !!s.reviewBusy || !!s.storageBlocked;
  el('mode').disabled = !!s.reviewBusy || !!s.storageBlocked || !!s.loadingScope;
  el('enqueue').hidden = !s.busy || s.loadingScope || s.source === 'cursor'; el('enqueue').disabled = pendingSend || s.reviewBusy || s.storageBlocked;
  renderQueue(s);
  const options = JSON.stringify([s.models, s.model, s.effort, s.preferences?.autoConnect]);
  if (options !== optionsSignature) {
    optionsSignature = options; el('model').replaceChildren(); if (!s.models.length) el('model').add(new Option(s.model ? '默认 ' + s.model.replace(/^gpt-/i, '').replaceAll('-', ' ') : '发送时加载模型', s.model || ''));
    for (const m of s.models) el('model').add(new Option((m.displayName || m.model).replace('GPT-', '').replaceAll('-', ' '), m.model)); el('model').value = s.model;
    el('effort').replaceChildren(); const model = s.models.find(m => m.model === s.model), names = { minimal: '最轻', low: '轻量', medium: '均衡', high: '深入', xhigh: '更深入', max: 'Max', ultra: 'Ultra' };
    for (const e of model?.supportedReasoningEfforts || []) el('effort').add(new Option(names[e.reasoningEffort] || e.reasoningEffort, e.reasoningEffort)); el('effort').value = s.effort;
    if (!el('effort').options.length) { el('effort').add(new Option(names[s.effort] || '默认', s.effort || '')); el('effort').value = s.effort || ''; }
  }
  el('model').disabled ||= !s.models.length; el('model').title = s.models.length ? '选择模型' : '默认模型；连接后确认可用性';
  el('effort').disabled = !!s.operationLocked || !!s.busy || !!s.reviewBusy || !s.models.find(m => m.model === s.model)?.supportedReasoningEfforts?.length;
  if (!s.busy && s.mode) el('mode').value = previous.mode || s.mode;
  el('attachments').replaceChildren();
  el('settings').title=s.pinnedContext?.length?'项目固定引用：'+s.pinnedContext.join('、'):'会话与 Codex 配置';
  el('settings').textContent=s.pinnedContext?.length?'设置 · '+s.pinnedContext.length+' 项固定引用':'设置';
  for (const attachment of s.attachments || []) { const chip = make('span', 'file-chip', attachment.label), remove = make('button', '', '×'); remove.disabled = s.busy; remove.title = '移除引用'; remove.onclick = () => post('removeAttachment', { id: attachment.id }); chip.append(remove); el('attachments').append(chip); }
  const checkpoints = s.checkpoints || [], reviews = JSON.stringify([s.changes, checkpoints, s.activeCheckpointId, s.busy, s.reviewBusy]); if (reviews !== reviewSignature) {
    reviewSignature = reviews; el('review').hidden = !s.changes?.length && !checkpoints.length; el('review-count').textContent = `${s.changes?.length || 0} 个文件`; el('review-files').replaceChildren();
    el('checkpoint-select').replaceChildren();
    if (!s.activeCheckpointId && s.changes?.length) el('checkpoint-select').add(new Option('当前改动', 'current'));
    for (const checkpoint of [...checkpoints].reverse()) el('checkpoint-select').add(new Option(`${checkpoint.legacy ? '旧版记录' : '第 ' + checkpoint.turn + ' 轮'} · ${checkpoint.count} 文件${checkpoint.limited ? '（部分）' : ''}`, checkpoint.id));
    el('checkpoint-select').value = s.activeCheckpointId || 'current'; el('checkpoint-select').disabled = s.operationLocked || s.busy || s.reviewBusy;
    for (const change of s.changes || []) { const row = make('div', 'review-row'), file = make('button', 'review-path', change.relative); file.title = '查看修改差异'; file.onclick = () => post('diff', { path: change.path }); row.append(file);
      const actions = change.status === 'pending' ? [['Keep', 'accept'], ['Undo', 'revert']] : change.status === 'accepted' ? [['Undo', 'revert']] : [['Redo', 'redo']];
      if (change.status !== 'pending') row.append(make('span', 'review-status', change.status === 'accepted' ? '已保留' : '已撤销'));
      for (const [label, type] of actions) { const button = make('button', 'text-button', label); button.disabled = s.operationLocked || s.busy || s.reviewBusy; button.onclick = () => post(type, { path: change.path }); row.append(button); }
      const current = make('button', 'text-button', '当前'); current.title = '此轮修改后与当前文件比较'; current.onclick = () => post('diffCurrent', { path: change.path }); row.append(current); el('review-files').append(row);
    }
  }
  const reviewLocked=s.operationLocked||s.busy||s.reviewBusy||s.storageBlocked;el('review-undo').disabled=reviewLocked||!(s.changes||[]).some(c=>['pending','accepted'].includes(c.status));el('review-keep').disabled=reviewLocked||!(s.changes||[]).some(c=>c.status==='pending');el('review-undo').title=(s.changes||[]).filter(c=>['pending','accepted'].includes(c.status)).length>1?'选择文件撤销':'撤销此文件修改';
  if (!el('history-panel').hidden) renderHistory();
  if (s.focusRequestId && s.focusRequestId !== handledFocusId && !el('input').disabled) { handledFocusId = s.focusRequestId; closeMenu(); if (!el('history-panel').hidden) closeHistory(); el('input').focus(); post('focusHandled', { id: s.focusRequestId }); }
  updateQuickActions();
}
function closeQuickActions(dismiss = false) {
  if (dismiss) quickDismissed = el('input').value + ':' + el('input').selectionStart;
  el('quick-actions').hidden = true; el('input').setAttribute('aria-expanded', 'false'); el('input').removeAttribute('aria-activedescendant');
}
function updateQuickActions() {
  const input = el('input'), query = actionQuery(input.value, input.selectionStart, input.selectionEnd), marker = input.value + ':' + input.selectionStart;
  const rows = quickDismissed === marker || document.activeElement !== input ? [] : matchingActions(query, { ...state, pendingSend });
  if (!rows.length) { closeQuickActions(); quickSignature = ''; return; }
  const signature = JSON.stringify([query, rows.map(row => row.id)]);
  if (signature !== quickSignature) { quickSignature = signature; quickRows = rows; quickIndex = 0; el('quick-actions').replaceChildren();
    for (const [index, action] of rows.entries()) {
      const button = make('button', 'quick-action'), key = make('code', '', (query.kind === 'context' ? '@' : '/') + action.id), label = make('span', '', action.label);
      button.id = 'quick-action-' + index; button.setAttribute('role', 'option'); button.tabIndex = -1; button.append(key, label);
      button.onpointerdown = event => event.preventDefault(); button.onclick = () => performQuickAction(action, undefined, actionQuery(input.value, input.selectionStart, input.selectionEnd)); el('quick-actions').append(button);
    }
  }
  el('quick-actions').hidden = false; input.setAttribute('aria-expanded', 'true'); selectQuickAction(quickIndex);
}
function selectQuickAction(index) {
  quickIndex = (index + quickRows.length) % quickRows.length;
  for (const [rowIndex, row] of [...el('quick-actions').children].entries()) { const selected = rowIndex === quickIndex; row.setAttribute('aria-selected', String(selected)); if (selected) { el('input').setAttribute('aria-activedescendant', row.id); row.scrollIntoView({ block: 'nearest' }); } }
}
function performQuickAction(action, remainder, query) {
  if (!action || remainder === undefined && !query) { closeQuickActions(); return; }
  if (!matchingActions(query || { kind: 'command', query: action.id }, { ...state, pendingSend }).some(item => item.id === action.id)) return;
  const input = el('input'); closeQuickActions(); quickSignature = ''; quickDismissed = undefined;
  input.value = remainder !== undefined ? remainder : query ? input.value.slice(0, query.start) + input.value.slice(query.end) : '';
  if (query) input.setSelectionRange(query.start, query.start);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (action.mode) { el('mode').value = action.mode; el('mode').dispatchEvent(new Event('change')); }
  else if (action.action === 'find') { showFind(); return; }
  else { flushDraft(); if (action.action === 'new') beginTabChange(); post(action.action); }
  if (!pendingTabChange) input.focus();
}
function syncSend(){el('send').disabled=!!state.loginPending||!!state.inlineBusy||!!state.reviewBusy||!!state.storageBlocked||!!state.loadingScope||pendingTabChange||(pendingSend&&!pendingQueue)||(!state.busy&&!el('input').value.trim());}
function resizeInput() { syncSend();el('restore-request').disabled = !!el('input').value.trim() || !state.canRestore || !!state.storageBlocked; el('input').style.height = 'auto'; el('input').style.height = Math.min(200, Math.max(34, el('input').scrollHeight)) + 'px'; if (draftKey !== undefined) { if (drafts[draftKey] !== el('input').value) draftTimes[draftKey] = Date.now(); drafts[draftKey] = el('input').value; } projectStates[projectKey] = { drafts, draftTimes, mode: el('mode').value }; api.setState({ projects: projectStates, legacy: legacyState }); }
function flushDraft() { clearTimeout(draftTimer); if (draftKey === undefined || draftKey === '__new__' || invalidated) return; post('draft', { id: draftKey, text: el('input').value, sequence: ++draftSequence }); }
function beginTabChange() { pendingTabChange = true; el('input').disabled = true;syncSend(); }
function scheduleDraft() { clearTimeout(draftTimer); el('draft-state').textContent = el('input').value ? '草稿…' : ''; draftTimer = setTimeout(flushDraft, 650); }
window.addEventListener('message', event => {
  const data = event.data; if (!data || data.projectKey !== projectKey || invalidated) return;
  if (data.type === 'reset') { clearTimeout(draftTimer);for(const {widget,timer} of pendingCopies.values()){clearTimeout(timer);clearTimeout(widget.copyTimer);}pendingCopies.clear(); invalidated = true; document.body.hidden = true; return; }
  if(data.type==='copied'||data.type==='copyFailed') {const pending=pendingCopies.get(data.copyId);if(!pending)return;pendingCopies.delete(data.copyId);clearTimeout(pending.timer);const widget=pending.widget;widget.copy.disabled=false;widget.copy.textContent=data.type==='copied'?'已复制':'重试复制';widget.copy.title=data.type==='copied'?'已复制完整代码':'复制失败，可重试';if(data.type==='copied')widget.copyTimer=setTimeout(()=>{widget.copy.textContent='复制';},1200);return;}
  if (data.type === 'tabChangePending') beginTabChange();
  if (data.type === 'tabChangeRejected') { pendingTabChange = false; el('input').disabled = !!state.loadingScope || !!state.storageBlocked;syncSend(); }
  if (data.type === 'state') render(data);
  if (data.type === 'draftRestored' && data.id === draftKey && data.editVersion === inputRevision && !el('input').value.trim()) { el('input').value = data.text; el('input').dispatchEvent(new Event('input', { bubbles: true })); el('input').focus(); }
  if (data.type === 'stream') {
    if (data.revision !== state.revision || data.activeId !== state.activeId) return;
    const messages = state.messages.slice(), updates = data.messages;
    const valid = Number.isSafeInteger(data.messageCount) && data.messageCount >= messages.length && Array.isArray(updates) && updates.every(update => Number.isSafeInteger(update.index) && update.index >= 0 && update.index < data.messageCount && typeof update.message?.text === 'string' && typeof update.message?.role === 'string');
    if (!valid || data.messageCount - messages.length > updates.length) { post('ready'); return; }
    for (const update of updates) messages[update.index] = update.message;
    for (let index = state.messages.length; index < data.messageCount; index++) if (!messages[index]) { post('ready'); return; }
    state = { ...state, messages, tasks: Array.isArray(data.tasks) ? data.tasks : state.tasks };
    renderMessages(state); renderTasks(state); updateFind(false);
  }
  if (data.type === 'draftSaved') {
    if (data.history) { state.history = data.history; if (!el('history-panel').hidden) renderHistory(); }
    if (data.id === draftKey && data.sequence === draftSequence) el('draft-state').textContent = data.saved ? el('input').value ? '草稿已保存' : '' : '草稿未保存';
  }
  if (['sent','queued'].includes(data.type) && (data.clientSendId === undefined || data.clientSendId === submittedSendId)) {
    if ((!data.id || data.id === draftKey) && inputRevision === submittedInputRevision && el('input').value === submittedDraft) el('input').value = '';
    pendingSend = false; pendingQueue = false; el('enqueue').disabled = !!state.loginPending || !!state.inlineBusy || !!state.reviewBusy || !!state.storageBlocked; submittedDraft = undefined; submittedSendId = undefined; submittedInputRevision = undefined; syncSend(); resizeInput(); flushDraft();
  }
  if (data.type === 'sendRejected' && data.clientSendId === submittedSendId) { pendingSend = false; pendingQueue = false; el('enqueue').disabled = !!state.loginPending || !!state.inlineBusy || !!state.reviewBusy || !!state.storageBlocked; submittedDraft = undefined; submittedSendId = undefined; submittedInputRevision = undefined; syncSend(); }
});
el('input').value = previous.draft || ''; if (previous.mode) el('mode').value = previous.mode;
el('input').addEventListener('input', () => { inputRevision++; quickDismissed = undefined; resizeInput(); scheduleDraft(); updateQuickActions(); });
el('input').addEventListener('click', updateQuickActions); el('input').addEventListener('focus', updateQuickActions);
el('input').addEventListener('blur', () => closeQuickActions());
el('input').addEventListener('keyup', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) updateQuickActions(); });
el('input').onkeydown = e => {
  if (e.isComposing || e.keyCode === 229) return;
  if (!el('quick-actions').hidden) {
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); selectQuickAction(quickIndex + (e.key === 'ArrowDown' ? 1 : -1)); return; }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); performQuickAction(quickRows[quickIndex], undefined, actionQuery(el('input').value, el('input').selectionStart, el('input').selectionEnd)); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeQuickActions(true); return; }
  }
  const sendKey = state.preferences?.submitKey === 'ctrlEnter' ? e.ctrlKey || e.metaKey : !e.ctrlKey && !e.metaKey;
  if (e.key === 'Enter' && sendKey && !e.shiftKey) { e.preventDefault(); if (state.busy) el('enqueue').click(); else el('send').click(); }
};
el('send').onclick = () => {
  if (state.busy) { post('stop'); return; } if (pendingSend) return;
  const parsed = commandAction(el('input').value);
  if (parsed && matchingActions({ kind: 'command', query: parsed.action.id }, state).some(action => action.id === parsed.action.id)) { performQuickAction(parsed.action, parsed.remainder); if (!parsed.action.mode || !el('input').value.trim()) return; }
  const text = el('input').value.trim(); if (text) { flushDraft(); closeQuickActions(); pendingSend = true; el('send').disabled = true; submittedDraft = el('input').value; submittedInputRevision = inputRevision; submittedSendId = sendPrefix + '-' + (++sendSequence); post('send', { text, mode: el('mode').value, clientSendId: submittedSendId }); }
};
el('enqueue').onclick = () => {
  if (pendingSend || !state.busy || state.loadingScope || state.storageBlocked || state.source === 'cursor') return;
  const text = el('input').value.trim(); if (!text) return;
  flushDraft(); closeQuickActions(); pendingSend = true; pendingQueue = true; el('enqueue').disabled = true; submittedDraft = el('input').value; submittedInputRevision = inputRevision; submittedSendId = sendPrefix + '-' + (++sendSequence); post('enqueue', { text, mode: el('mode').value, clientSendId: submittedSendId });
};
el('queue-pause').onclick = () => post('queuePause');
el('cancel-login').onclick = () => post('cancelLogin');
el('restore-request').onclick = () => { flushDraft(); post('restoreRequest', { id: state.activeId, revision: state.revision, editVersion: inputRevision }); };
el('recover-connect').onclick = () => post('reconnect'); el('reconnect').onclick = () => { el('menu').hidden = true; post('reconnect'); };
function closeMenu(focus = false) { el('menu').hidden = true; el('more').setAttribute('aria-expanded', 'false'); if (focus) el('more').focus(); }
function closeHistory() { el('history-panel').hidden = true; el('history').setAttribute('aria-expanded', 'false'); el('history').focus(); }
el('more').setAttribute('aria-controls', 'menu'); el('more').setAttribute('aria-expanded', 'false');
el('history').setAttribute('aria-controls', 'history-panel'); el('history').setAttribute('aria-expanded', 'false');
el('more').onclick = () => { const open = el('menu').hidden; closeHistory(); el('menu').hidden = !open; el('more').setAttribute('aria-expanded', String(open)); if (open) el('menu').querySelector('button:not(:disabled)')?.focus(); else el('more').focus(); };
el('history').onclick = () => { const open = el('history-panel').hidden; closeMenu(); el('history-panel').hidden = !open; el('history').setAttribute('aria-expanded', String(open)); renderHistory(); if (open) el('history-search').focus(); else el('history').focus(); };
el('menu').addEventListener('keydown', e => { if(e.target.tagName==='SELECT')return;if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); const buttons = [...el('menu').querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement); const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length; buttons[next]?.focus(); });
el('task-toggle').onclick=()=>{showTasks=true;renderTasks(state);el('task-panel').open=true;closeMenu();el('task-panel').querySelector('summary').focus();};
for(const [id,action] of [['review-undo','undo'],['review-keep','keep']])el(id).onclick=()=>post('reviewAction',{action,id:state.activeId,checkpointId:state.activeCheckpointId||null,revision:state.revision});
el('history-archived').onclick=()=>{historyArchived=!historyArchived;renderHistory();};
el('review-toggle').onclick=()=>{el('review-details').hidden=!el('review-details').hidden;el('review-toggle').setAttribute('aria-expanded',String(!el('review-details').hidden));};
el('find').onclick = () => { el('menu').hidden = true; showFind(); };
el('find-query').oninput = () => { clearTimeout(findTimer); findTimer = setTimeout(() => updateFind(true), 120); };
el('find-query').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); moveFind(e.shiftKey ? -1 : 1); } };
el('find-prev').onclick = () => moveFind(-1); el('find-next').onclick = () => moveFind(1); el('find-close').onclick = closeFind;
el('task-filter').onchange = () => renderTasks(state);
el('task-failures').onclick = () => { el('task-failures').setAttribute('aria-pressed', String(el('task-failures').getAttribute('aria-pressed') !== 'true')); renderTasks(state); };
el('task-copy').onclick = () => post('copyTasks', { ids: [...taskRows.entries()].filter(([, row]) => !row.node.hidden).map(([id]) => id) });
el('checkpoint-select').onchange = () => { if (el('checkpoint-select').value !== 'current') post('checkpoint', { id: el('checkpoint-select').value }); };
el('close-history').onclick = closeHistory; el('history-search').oninput = renderHistory;
for (const id of ['new', 'refresh', 'login', 'folder', 'changes', 'terminal', 'rename', 'delete', 'attach', 'attachCurrent', 'settings', 'usage', 'attachDiagnostics', 'attachGitDiff', 'attachFolder', 'export']) el(id).onclick = () => { flushDraft(); if (id === 'new') beginTabChange(); post(id); el('menu').hidden = true; };
el('model').onchange = () => post('model', { value: el('model').value }); el('effort').onchange = () => post('effort', { value: el('effort').value }); el('mode').onchange = () => { previous.mode = el('mode').value; resizeInput(); };
el('messages').onscroll = () => { const b = el('messages'); el('scroll-bottom').hidden = b.scrollHeight - b.scrollTop - b.clientHeight < 100; };
el('scroll-bottom').onclick = () => { if (messageAnchor !== null) { messageAnchor = null; visibleMessages = 100; renderMessages(state); updateFind(false); } el('messages').scrollTop = el('messages').scrollHeight; };
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); showFind(); } if (e.key === 'Escape') { if (!el('menu').hidden) closeMenu(true); if (!el('history-panel').hidden) closeHistory(); if (!el('find-bar').hidden) closeFind(); } });
document.addEventListener('click', e => { if (!el('menu').contains(e.target) && e.target !== el('more')) el('menu').hidden = true; if (!el('quick-actions').contains(e.target) && e.target !== el('input')) closeQuickActions(); });
el('chat-tabs').addEventListener('keydown', e => {
  if (state.operationLocked || state.busy || state.reviewBusy || e.target.getAttribute('role') !== 'tab') return;
  const ids = state.openChatIds || [], index = ids.indexOf(e.target.dataset.chatId); let next;
  if (e.key === 'ArrowRight') next = ids[(index + 1) % ids.length];
  if (e.key === 'ArrowLeft') next = ids[(index + ids.length - 1) % ids.length];
  if (e.key === 'Home') next = ids[0]; if (e.key === 'End') next = ids.at(-1);
  if (e.key === 'Delete') { e.preventDefault(); flushDraft(); beginTabChange(); post('closeTab', { id: ids[index], draft: ids[index] === draftKey ? el('input').value : drafts[ids[index]] }); }
  if (next && next !== state.activeId) { e.preventDefault(); flushDraft(); beginTabChange(); pendingFocusChat = next; post('select', { id: next }); }
});
window.addEventListener('pagehide', flushDraft);
const scrollObserver = new ResizeObserver(() => { const rect = el('messages').getBoundingClientRect(); el('scroll-bottom').style.bottom = Math.max(8, innerHeight - rect.bottom + 8) + 'px'; }); scrollObserver.observe(el('messages'));
resizeInput(); post('ready');
