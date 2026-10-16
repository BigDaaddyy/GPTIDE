const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Bridge, findCodex } = require('./bridge.cjs');
const review = require('./review.cjs');
const storage = require('./storage.cjs');
const inlineCore = require('./inline-core.cjs');
const inlineAgent = require('./inline-agent.cjs');
const tasklog = require('./tasklog.cjs');
const projectScope = require('./project-scope.cjs');
const history = require('./history.cjs');
const preferences = require('./preferences.cjs');
const exec = promisify(execFile);

class Chat {
  async copyText(text,copyId) {
    const view=this.view,owner=this.projectKey;
    const reply=type=>{if(!this.invalidated&&this.projectKey===owner&&this.view===view)view?.webview.postMessage({type,projectKey:owner,copyId});};
    try{await vscode.env.clipboard.writeText(text);reply('copied');}
    catch(error){reply('copyFailed');throw error;}
  }
  actionLocked() { return !!(this.busy || this.reviewBusy || this.inlineBusy || this.inlinePromptBusy || this.queueDispatchToken || this.loginPending); }
  async focusInput() {
    await this.ready; if (this.invalidated) return;
    this.focusRequestId = crypto.randomUUID(); await vscode.commands.executeCommand('gptide.chat.focus');
    if (!this.invalidated) this.post();
  }
  codeContent(uri) { const [,owner,id]=uri.path.split('/');if(this.invalidated||owner!==this.projectKey||!this.codePreviews?.has(id))throw new Error('临时代码片段已过期，请重新打开');return this.codePreviews.get(id); }
  async showCode(id,index,codeIndex,revision) {
    if(this.invalidated||this.loadingScope||id!==this.activeId||revision!==this.streamRevision)throw new Error('对话已更新，请重新打开代码片段');
    const chat=this.chats.find(value=>value.id===id&&value.projectKey===this.projectKey);
    if(!chat||!Number.isSafeInteger(index)||index<0||!Number.isSafeInteger(codeIndex)||codeIndex<0||!chat.messages[index])throw new Error('代码片段不存在');
    const block=require('./markdown.cjs').parseMarkdown(chat.messages[index].text||'').filter(value=>value.type==='code')[codeIndex];
    if(!block)throw new Error('代码片段不存在');if(Buffer.byteLength(block.text)>512*1024)throw new Error('代码片段过大，请复制到编辑器查看');
    const current=()=>!this.invalidated&&this.activeId===id&&this.streamRevision===revision;
    const languages=await vscode.languages.getLanguages();if(!current())return;
    const candidate=require('./code.cjs').codeLanguage(block.language),language=languages.includes(candidate)?candidate:'plaintext',key=crypto.randomUUID();
    this.codePreviews||=new Map();this.codePreviews.set(key,block.text);while(this.codePreviews.size>20)this.codePreviews.delete(this.codePreviews.keys().next().value);
    const uri=vscode.Uri.from({scheme:'gptide-code',path:`/${this.projectKey}/${key}/snippet`});
    const document=await vscode.workspace.openTextDocument(uri);if(!current())return;
    const formatted=await vscode.languages.setTextDocumentLanguage(document,language);if(current())await vscode.window.showTextDocument(formatted,{preview:true});
  }
  constructor(context) {
    this.context = context; this.serviceTier = "default"; this.messages = []; this.chats = []; this.model = vscode.workspace.getConfiguration('gptide').get('model');
    this.preferences = preferences.values(vscode.workspace.getConfiguration('gptide'));
    this.status = '正在读取项目进度'; this.busy = false; this.attachments = []; this.effort = this.preferences.defaultEffort; this.mode = this.preferences.defaultMode; this.hiddenCursorIds = []; this.project = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.output = vscode.window.createOutputChannel('GPTIDE'); context.subscriptions.push(this.output);
    const root = path.resolve(context.extensionPath, '../../../../..');
    this.root = root; this.data = path.join(require('./data-paths.cjs').dataRoot(root), 'projects'); fs.mkdirSync(this.data, { recursive: true });
    this.projectKey = this.project ? projectScope.key(this.project) : null;
    this.stateFile = this.projectKey ? path.join(this.data, this.projectKey + '.json') : null;
    try { this.drafts = new (require('./drafts.cjs').Drafts)(path.join(this.data, this.projectKey + '.drafts.json'), this.projectKey); if (this.drafts.recovered) this.draftWarning = '草稿已从备份恢复'; }
    catch (error) { this.draftWarning = '草稿保存不可用：' + error.message; }
    try { this.fixedContext = new (require('./project-context.cjs').ProjectContext)(path.join(this.data, this.projectKey + '.context.json'), this.project, this.projectKey); }
    catch (error) { this.contextWarning = '固定上下文不可用：' + error.message; }
    if (this.fixedContext?.recovered) this.contextWarning = '固定上下文已从备份恢复';
    try { this.checkpointStore = new (require('./checkpoints.cjs').Checkpoints)(path.join(this.data, this.projectKey + '-checkpoints'), this.project, this.projectKey, this.preferences.reviewStorageLimitMb * 1024 * 1024); }
    catch (error) { this.reviewWarning = '检查点存储不可用：' + error.message; }
    this.loadingScope = true; this.quarantinedChats = []; this.openChatIds = []; this.chatAttachments = new Map(); this.retiredTurnIds = new Set(); this.pendingRequests = new Map();
    this.ready = this.load();
  }
  async load() {
    if (this.stateFile) {
      try {
        const result = storage.read(this.stateFile, state => projectScope.validateState(state, this.projectKey, this.project)), state = result.state || {}, normalize = require('./history-state.cjs').normalize;
        this.quarantinedChats = normalize(state.quarantinedChats || []); this.storageRevision = result.revision; this.chats = normalize(state.chats || []);
        this.cursorChatMetadata = state.cursorChatMetadata || {}; this.activeId = state.activeId; this.openChatIds = state.openChatIds || []; this.model = state.model || this.model; this.serviceTier=state.serviceTier||"default"; this.approvalMode=state.approvalMode;
        this.effort = state.effort || this.preferences.defaultEffort; this.mode = state.mode || this.preferences.defaultMode; this.hiddenCursorIds = state.hiddenCursorIds || [];
        if (result.recovered) this.historyWarning = '主历史不可用，已恢复上一份本地备份。';
      } catch (e) { this.historyWarning = e.message; this.storageBlocked = true; this.output.appendLine('本地历史读取失败：' + e.message); }
    }
    await this.importCursor();
    if (this.invalidated) return;
    try {
      const bridge = this.preferences.autoConnect ? await this.connect() : null;
      const candidates = [...this.chats.filter(c => c.source !== 'cursor'), ...this.quarantinedChats]; this.quarantinedChats = [];
      const unique = new Map(candidates.map(c => [c.id, c])); const native = [];
      for (const chat of unique.values()) {
        if (chat.projectKey === this.projectKey) { native.push(chat); continue; }
        if (bridge && !chat.projectKey && chat.threadId) {
          try { const result = await bridge.call('thread/read', { threadId: chat.threadId, includeTurns: false }); if (projectScope.matches(result.thread?.cwd, this.project)) { chat.projectKey = this.projectKey; native.push(chat); continue; } } catch {}
        }
        this.quarantinedChats.push(chat);
      }
      this.chats = [...native, ...this.chats.filter(c => c.source === 'cursor' && c.projectKey === this.projectKey)];
    } catch (error) {
      const native = projectScope.partition(this.chats.filter(c => c.source !== 'cursor'), this.projectKey); this.quarantinedChats.push(...native.unverified); this.chats = [...native.owned, ...this.chats.filter(c => c.source === 'cursor' && c.projectKey === this.projectKey)];
      this.status = '连接失败：' + error.message;
    }
    this.loadingScope = false;
    for (const chat of this.chats) if (['preparing', 'running'].includes(chat.lastOutcome)) chat.lastOutcome = 'unknown';
    for (const chat of this.chats) if (chat.queue?.length) { chat.queuePaused = true; for (const item of chat.queue) if (item.status === 'starting') { item.status = 'failed'; item.error = '上次发送状态未确认，请检查对话后重试'; } }
    if (this.quarantinedChats.length) this.scopeWarning = `已隐藏 ${this.quarantinedChats.length} 条无法确认当前项目归属的记录。`;
    if (!this.activeId || !this.chats.some(c => c.id === this.activeId)) this.activeId = this.chats.find(c=>!c.archived)?.id;
    this.openChatIds = this.openChatIds.filter(id => this.chats.some(c => c.id === id && c.projectKey === this.projectKey));
    if(this.chats.find(c=>c.id===this.activeId)?.archived)this.activeId=this.chats.find(c=>!c.archived)?.id;this.openChatIds=this.openChatIds.filter(id=>!this.chats.find(c=>c.id===id)?.archived);if (this.activeId) this.select(this.activeId); else this.newChat();
    if (this.bridge) this.status = '项目进度已加载'; else if (!this.preferences.autoConnect) this.status = '未连接 · 发送时连接'; this.post();
  }
  async importCursor(force = false) {
    if (!this.project) return;
    try {
      const userRoot = vscode.workspace.getConfiguration('gptide').get('cursorUserPath') || path.join(process.env.APPDATA || '', 'Cursor', 'User');
      const result = await require('./cursor-cache.cjs').cachedImport({project:this.project,userRoot,file:path.join(this.data,this.projectKey+'.cursor-cache.json'),force,load:async()=>{
        const { stdout } = await exec(path.join(this.root, 'runtime', 'node.exe'), ['--disable-warning=ExperimentalWarning', path.join(this.root, 'tools', 'cursor-import.cjs'), this.project, userRoot], { windowsHide: true, maxBuffer: 100 * 1024 * 1024, timeout: 60000 });
        return JSON.parse(stdout);
      }}); this.cursorCount = result.chats.length;
      if (this.invalidated) return;
      const native = this.chats.filter(c => c.source !== 'cursor'); this.chats = [...native, ...result.chats.filter(c => !this.hiddenCursorIds.includes(c.id)).map(c => ({ ...c, ...this.cursorChatMetadata?.[c.id], projectKey: this.projectKey }))];
      this.drafts?.apply(this.chats);
      this.importWarning = result.warnings.join('；');
    } catch (e) { this.importWarning = 'Cursor 历史未能读取：' + e.message; }
  }
  select(id) {
    if (this.actionLocked() || this.invalidated) return false;
    const chat = this.chats.find(c => c.id === id && c.projectKey === this.projectKey);
    if (!chat) return false;
    if (this.activeId) this.chatAttachments.set(this.activeId, this.attachments);
    this.activeId = chat?.id || null;
    if (chat && !this.openChatIds.includes(chat.id)) this.openChatIds.push(chat.id);
    this.messages = chat?.messages || []; this.changes = chat?.changes || []; this.tasks = chat?.tasks || []; this.attachments = this.chatAttachments.get(this.activeId) || []; this.currentTaskTurn = chat?.taskTurn || 0; this.threadId = chat?.threadId; this.resumed = false;
    this.prepareReview(chat); this.post();
    return true;
  }
  prepareReview(chat, persist = true) {
    this.activeCheckpointId = null;
    if (!chat || !this.checkpointStore) return;
    try {
      if (chat.changes?.length && !this.storageBlocked) {
        const settings = preferences.values(vscode.workspace.getConfiguration('gptide')); this.checkpointStore.maximumBytes = settings.reviewStorageLimitMb * 1024 * 1024;
        const record = this.checkpointStore.create(chat.changes, chat.pendingCheckpointTurn || chat.taskTurn || 1, !!chat.changes.limited);
        if (record.changes.length) { record.legacy = !chat.pendingCheckpointTurn; const old = chat.checkpoints || [], foreign = old.filter(c => c.projectKey !== this.projectKey), own = old.filter(c => c.projectKey === this.projectKey); chat.checkpoints = [...foreign, ...own, record]; const keep = settings.reviewMaxCheckpoints; chat.checkpoints = [...foreign, ...chat.checkpoints.filter(c => c.projectKey === this.projectKey).slice(-keep)]; chat.activeCheckpointId = record.id; }
        chat.changes = []; delete chat.pendingCheckpointTurn; if (persist) this.save();
      }
      const records = (chat.checkpoints || []).filter(c => c.projectKey === this.projectKey), record = records.at(-1);
      if (record) { this.changes = this.checkpointStore.load(record); this.activeCheckpointId = record.id; chat.activeCheckpointId = record.id; }
      this.reviewWarning = undefined;
    } catch (error) { this.reviewWarning = '检查点未能读取或保存：' + error.message; }
  }
  selectCheckpoint(id) {
    if (this.actionLocked() || this.invalidated) return;
    const chat = this.chats.find(c => c.id === this.activeId && c.projectKey === this.projectKey), record = chat?.checkpoints?.find(c => c.id === id && c.projectKey === this.projectKey);
    if (!record || !this.checkpointStore) return;
    try { this.changes = this.checkpointStore.load(record); this.activeCheckpointId = id; chat.activeCheckpointId = id; this.reviewWarning = undefined; this.save(); }
    catch (error) { this.reviewWarning = error.message; }
    this.post();
  }
  changeStatus(change, status) {
    change.status = status;
    const chat = this.chats.find(c => c.id === this.activeId && c.projectKey === this.projectKey), record = chat?.checkpoints?.find(c => c.id === this.activeCheckpointId && c.projectKey === this.projectKey), saved = record?.changes.find(c => c.relative === change.relative);
    if (saved) saved.status = status;
  }
  rememberCursorMetadata(chat){
    if(chat.source==='cursor'){this.cursorChatMetadata||={};Object.defineProperty(this.cursorChatMetadata,chat.id,{value:{name:chat.name,pinned:!!chat.pinned,archived:!!chat.archived},enumerable:true,writable:true,configurable:true});}
  }
  setHistoryFlag(id,field,value){
    if(!['pinned','archived'].includes(field)||typeof value!=='boolean'||this.invalidated||this.storageBlocked||this.actionLocked())return;
    const chat=this.chats.find(c=>c.id===id&&c.projectKey===this.projectKey);if(!chat)return;
    const before=chat[field],paused=chat.queuePaused,metadata=this.cursorChatMetadata?.[chat.id];chat[field]=value;
    if(field==='archived'&&value&&chat.queue?.length)chat.queuePaused=true;this.rememberCursorMetadata(chat);
    if(!this.save()){chat[field]=before;chat.queuePaused=paused;if(chat.source==='cursor'){if(metadata)this.cursorChatMetadata[chat.id]=metadata;else delete this.cursorChatMetadata[chat.id];}this.post();return;}
    if(field==='archived'&&value)this.closeTab(chat.id);this.post();
  }
  chooseModel(value){
    if(this.invalidated||this.storageBlocked||this.actionLocked())return;
    const catalog=require('./model-catalog.cjs'),model=catalog.choices(this.models||[]).find(m=>m.model===value);if(!model)return;
    const old={model:this.model,effort:this.effort,serviceTier:this.serviceTier};this.model=value;
    if(!model.unverified)this.effort=catalog.effort(model,this.effort);
    this.serviceTier=catalog.tier(model,this.serviceTier);
    if(!this.save())Object.assign(this,old);this.post();
  }
  approvalSettings(){return{approvalPolicy:this.approvalMode?'on-request':preferences.values(vscode.workspace.getConfiguration('gptide')).approvalPolicy,approvalsReviewer:this.approvalMode||'user'};}
  chooseApprovalMode(value){
    if(this.invalidated||this.storageBlocked||this.actionLocked()||!['user','auto_review'].includes(value))return;
    const old=this.approvalMode;this.approvalMode=value;if(!this.save())this.approvalMode=old;this.post();
  }
  chooseServiceTier(value){
    if(this.invalidated||this.storageBlocked||this.actionLocked()||!['default','fast','priority'].includes(value))return;
    const catalog=require('./model-catalog.cjs');if(value!=='default'&&catalog.tier(this.models?.find(m=>m.model===this.model),value)!==value)return;
    const old=this.serviceTier;this.serviceTier=value;if(!this.save())this.serviceTier=old;this.post();
  }
  async reviewAction(action,id,checkpointId,revision){
    const valid=()=>!this.invalidated&&!this.storageBlocked&&!this.actionLocked()&&id===this.activeId&&checkpointId===(this.activeCheckpointId||null)&&revision===this.streamRevision;
    if(!valid())return;
    const changes=(this.changes||[]).filter(c=>c.status==='pending');
    if(action==='keep'){
      for(const change of changes)this.changeStatus(change,'accepted');if(!this.save())for(const change of changes)this.changeStatus(change,'pending');else this.status='已保留修改';this.post();
    }else if(action==='undo'&&changes.length){
      const restores=changes.map(change=>this.prepareRestore(change));
      this.reviewBusy=true;this.post();
      try{
        for(const restore of restores){
          if(this.invalidated||this.storageBlocked)throw new Error('项目或存储状态已改变，已停止撤销');
          await this.applyRestore(restore);
        }
        this.status='已撤销修改';
      }finally{this.reviewBusy=false;this.post();}
    }
  }
  async reviewDecision(msg){
    if(this.invalidated||this.storageBlocked||this.actionLocked()||msg.id!==this.activeId||msg.checkpointId!==(this.activeCheckpointId||null)||msg.revision!==this.streamRevision)return;
    const change=this.changes?.find(c=>c.path===msg.path&&c.status==='pending');if(!change)return;
    if(msg.action==='reject'){await this.revert(change.path);if(!this.invalidated&&change.status==='reverted'){this.status='已撤销修改';this.post();}}
    if(msg.action==='accept'){this.changeStatus(change,'accepted');if(!this.save())this.changeStatus(change,'pending');else this.status='已保留修改';this.post();}
  }
  cleanupCheckpoints() {
    if (this.actionLocked() || this.storageBlocked || !this.checkpointStore) return;
    const current = storage.read(this.stateFile).state;
    if (current?.projectKey !== this.projectKey) throw new Error('项目记录归属无法核对');
    const states = [current];
    for (const name of fs.readdirSync(this.data)) {
      if (name !== this.projectKey + '.json.bak' && !(name.startsWith(this.projectKey + '.json.conflict-') && name.endsWith('.json'))) continue;
      const saved = JSON.parse(fs.readFileSync(path.join(this.data, name), 'utf8'));
      if (saved.projectKey !== this.projectKey) throw new Error('备份或冲突记录归属无法核对，保留缓存');
      states.push(saved);
    }
    const records = states.flatMap(state => [...(state.chats || []), ...(state.quarantinedChats || [])]).flatMap(c => c.checkpoints || []);
    const result = this.checkpointStore.gc(records); vscode.window.showInformationMessage(`清理 ${result.removed} 个未引用内容块，释放 ${(result.bytes / 1024 / 1024).toFixed(1)} MiB`);
  }
  newChat() {
    if (this.actionLocked() || this.invalidated || this.storageBlocked) return;
    this.view?.webview.postMessage({ type: 'tabChangePending', projectKey: this.projectKey });
    const chat = { id: crypto.randomUUID(), projectKey: this.projectKey, source: 'gptide', name: '新对话', messages: [], tasks: [], changes: [], updatedAt: Date.now() };
    this.chats.unshift(chat); this.select(chat.id); this.save();
  }
  branchChat(id, index, revision) {
    if (this.actionLocked() || this.invalidated || this.storageBlocked || id !== this.activeId || revision !== this.streamRevision) return false;
    const source = this.chats.find(chat => chat.id === id && chat.projectKey === this.projectKey);
    if (!source || !Number.isSafeInteger(index) || index < 0 || index >= source.messages.length) return false;
    const chat = { ...require('./conversation-branch.cjs').create(source, index, this.projectKey), id: crypto.randomUUID() };
    this.view?.webview.postMessage({ type: 'tabChangePending', projectKey: this.projectKey });
    this.chats.unshift(chat); this.select(chat.id); this.status = '已创建分支 · 首次发送时建立独立会话'; this.save(); this.post(); return true;
  }
  async enqueue(text, mode, clientSendId) {
    await this.ready;
    const chat = this.chats.find(value => value.id === this.activeId && value.projectKey === this.projectKey);
    if (!chat || chat.source === 'cursor' || this.invalidated || this.storageBlocked || this.reviewBusy) throw new Error('当前对话不能排队');
    const item = require('./message-queue.cjs').create(text, mode, this.attachments, this.projectKey, chat.id), queue = [...(chat.queue || []), item];
    if (!require('./message-queue.cjs').validate(queue, chat.id, this.projectKey)) throw new Error('队列已满或上下文过大（最多 10 条）');
    chat.queue = queue;
    if (!this.save()) { chat.queue = queue.filter(value => value.id !== item.id); throw new Error(this.historyWarning || '队列保存失败'); }
    if ((chat.draft || '').trim() === text.trim()) this.persistDraft(chat.id, '');
    const ids = new Set(item.attachments.map(value => value.id)); this.attachments = this.attachments.filter(value => !ids.has(value.id));
    this.view?.webview.postMessage({ type: 'queued', projectKey: this.projectKey, id: chat.id, clientSendId }); this.post();
    if (!this.busy && !chat.queuePaused) this.scheduleQueue(chat.id);
  }
  scheduleQueue(id) {
    clearTimeout(this.queueTimer); this.queueTimer = setTimeout(() => { this.queueTimer = null; if (this.activeId === id && !this.invalidated) this.dispatchQueue().catch(error => { if (!this.invalidated) { this.status = error.message; this.post(); } }); }, 0);
  }
  pauseQueue() { const chat = this.chats.find(value => value.id === this.activeId && value.projectKey === this.projectKey); if (chat) { chat.lastOutcome = this.cancelPendingSend ? 'interrupted' : 'failed'; if (chat.queue?.length) chat.queuePaused = true; this.save(); } }
  async dispatchQueue() {
    await this.ready;
    if (this.invalidated || this.actionLocked() || this.storageBlocked) return;
    const chat = this.chats.find(value => value.id === this.activeId && value.projectKey === this.projectKey), item = chat?.queue?.[0];
    if (!item || chat.queuePaused || item.status !== 'pending') return;
    const token = Symbol('queue'); this.queueDispatchToken = token; item.status = 'starting';
    try {
      if (!this.save()) throw new Error(this.historyWarning || '队列保存失败');
      await this.send(item.text, item.mode, false, undefined, item.id);
      if (this.queueDispatchToken !== token) return;
      if (!this.busy && chat.queue?.some(value => value.id === item.id)) throw new Error('排队发送未确认，请检查对话后重试');
    } catch (error) {
      if (!this.invalidated && this.queueDispatchToken === token && chat.queue?.some(value => value.id === item.id)) { item.status = 'failed'; item.error = error.message; chat.queuePaused = true; this.save(); this.status = error.message; this.post(); }
    } finally { if (this.queueDispatchToken === token) this.queueDispatchToken = null; }
  }
  async queueAction(type, id, direction) {
    const chat = this.chats.find(value => value.id === this.activeId && value.projectKey === this.projectKey); if (!chat || this.invalidated || this.storageBlocked) return;
    if (this.reviewBusy || this.inlineBusy || this.inlinePromptBusy || this.loginPending) throw new Error('请先完成当前文件修改或登录再操作队列');
    const queue = chat.queue || [], index = queue.findIndex(value => value.id === id), item = queue[index];
    if (type === 'queuePause') { chat.queuePaused = !chat.queuePaused; }
    else {
      if (!item || item.status === 'starting') return;
      if (type === 'queueRemove') queue.splice(index, 1);
      if (type === 'queueMove' && [-1, 1].includes(direction)) { const next = index + direction; if (next >= 0 && next < queue.length && queue[next].status !== 'starting') [queue[index], queue[next]] = [queue[next], queue[index]]; }
      if (type === 'queueRetry' && item.status === 'failed') { item.status = 'pending'; delete item.error; chat.queuePaused = false; }
      if (type === 'queueEdit') {
        const text = await vscode.window.showInputBox({ title: '编辑排队指令', value: item.text, validateInput: value => !value.trim() || value.length > 100000 ? '请输入不超过 100000 字符的指令' : null });
        if (text === undefined || this.invalidated || this.activeId !== chat.id || chat.queue !== queue || !queue.includes(item) || item.status === 'starting') return;
        const previous = item.text; item.text = text; if (!require('./message-queue.cjs').validate(queue, chat.id, this.projectKey)) { item.text = previous; throw new Error('队列内容过大'); }
        item.status = 'pending'; delete item.error;
      }
    }
    this.save(); this.post(); if (!this.busy && !chat.queuePaused) this.scheduleQueue(chat.id);
  }
  closeTab(id, draft) {
    if (this.actionLocked() || !this.openChatIds.includes(id)) return;
    const chat = this.chats.find(c => c.id === id && c.projectKey === this.projectKey); if (chat && typeof draft === 'string') this.persistDraft(id, draft);
    const index = this.openChatIds.indexOf(id); this.openChatIds.splice(index, 1);
    if (this.activeId === id) { const next = this.openChatIds[Math.max(0, index - 1)]; if (next) this.select(next); else this.newChat(); }
    this.save(); this.post();
  }
  persistDraft(id, text) {
    if (this.invalidated || typeof text !== 'string') return false;
    const chat = this.chats.find(c => c.id === id && c.projectKey === this.projectKey); if (!chat) return false;
    chat.draft = text.slice(0, 100000); chat.draftUpdatedAt = Date.now(); chat.draftVersion = (chat.draftVersion || 0) + 1;
    try { if (!this.drafts) throw new Error('草稿文件不可用'); this.drafts.set(id, chat.draft, chat.draftUpdatedAt); return true; }
    catch (error) { this.draftWarning = '草稿未保存：' + error.message; this.post(); return false; }
  }
  save() {
    if (this.invalidated || this.loadingScope) return false;
    if (!this.stateFile) return true;
    const state = { projectKey: this.projectKey, projectPath: this.project, quarantinedChats: this.quarantinedChats, openChatIds: this.openChatIds, activeId: this.activeId, model: this.model, effort: this.effort, serviceTier:this.serviceTier||"default", approvalMode:this.approvalMode, mode: this.mode, hiddenCursorIds: this.hiddenCursorIds, cursorChatMetadata:this.cursorChatMetadata||{}, chats: this.chats.filter(c => c.source !== 'cursor' && c.projectKey === this.projectKey) };
    try {
      const validateOwnership = value => projectScope.validateState(value, this.projectKey, this.project);
      if (this.storageBlocked) { if (this.conflictFile) storage.write(this.conflictFile, state, undefined, validateOwnership); return false; }
      this.storageRevision = storage.write(this.stateFile, state, this.storageRevision, validateOwnership); return true;
    } catch (error) {
      this.historyWarning = error.message; this.output.appendLine('历史保存失败：' + error.message);
      if (error.code === 'GPTIDE_CONFLICT') { this.storageBlocked = true; this.conflictFile = error.conflictFile; }
      this.post();
      return false;
    }
  }
  post() {
    if (this.invalidated) return;
    clearTimeout(this.postTimer); this.postTimer = null;
    this.streamRevision = (this.streamRevision || 0) + 1;
    this.streamBase = { activeId: this.activeId, count: this.messages.length };
    this.streamUpdates?.clear();
    this.settingsRefresh?.();
    const chat = this.loadingScope ? null : this.chats.find(c => c.id === this.activeId && c.projectKey === this.projectKey); const visible = this.loadingScope ? [] : this.chats.filter(c => c.projectKey === this.projectKey);
    this.view?.webview.postMessage({ type: 'state', usage: this.usageSnapshot?.(), revision: this.streamRevision, projectKey: this.projectKey, project: this.project || '', status: this.status, warning: [this.historyWarning, this.scopeWarning, this.importWarning, this.draftWarning, this.reviewWarning, this.contextWarning].filter(Boolean).join('；'), busy: this.busy || this.loadingScope, loadingScope: this.loadingScope, storageBlocked: !!this.storageBlocked, connected: !!this.bridge && !this.connecting && !this.loginPending && ['chatgpt', 'chatgptAuthTokens'].includes(this.account?.type), focusRequestId: this.focusRequestId, operationLocked: this.actionLocked(), loginPending: !!this.loginPending, canCancelLogin: !!this.loginSession?.id && !this.loginSession.done && !this.loginSession.completing && !this.loginSession.canceling, reviewBusy: this.reviewBusy, inlineBusy: !!(this.inlineBusy || this.inlinePromptBusy), checkpoints: this.loadingScope ? [] : (chat?.checkpoints || []).filter(c => c.projectKey === this.projectKey).map(c => ({ id: c.id, turn: c.turn, createdAt: c.createdAt, count: c.changes.length, limited: c.limited, legacy: c.legacy })), activeCheckpointId: this.activeCheckpointId, preferences: preferences.values(vscode.workspace.getConfiguration("gptide")), messages: this.loadingScope ? [] : this.messages, activeId: this.loadingScope ? null : this.activeId, source: chat?.source, branch: chat?.branch || null, queue: (chat?.queue || []).map(({id,text,mode,status,error}) => ({id,text,mode,status,error})), queuePaused: !!chat?.queuePaused, lastOutcome: chat?.lastOutcome, canRestore: !!chat?.lastRequest, draft: chat?.draft || '', draftUpdatedAt: chat?.draftUpdatedAt || 0, history: history.entries(visible, this.activeId), openChatIds: this.loadingScope ? [] : this.openChatIds, chats: visible.map(c => ({ id: c.id, name: c.name, source: c.source, updatedAt: c.updatedAt, count: c.messages.length })), models: this.models || [], modelChoices:require("./model-catalog.cjs").choices(this.models||[]), serviceTier:this.serviceTier||"default", ...this.approvalSettings(), model: this.model, effort: this.effort, mode: this.mode, tasks: this.loadingScope ? [] : this.tasks || [], pinnedContext: this.loadingScope ? [] : (this.fixedContext?.labels() || []), attachments: this.attachments.map(({ id, label }) => ({ id, label })), changes: (this.changes || []).map(c => ({ path: c.path, relative: c.relative, status: c.status, ...(c.statsVersion===1?{added:c.added,removed:c.removed,approximate:!!c.approximate}:require('./diff-stats.cjs').stats(c.before,c.after)) })), account: this.account, activity: this.activity || '', cursorCount: this.cursorCount || 0 });
  }
  postStream() {
    if (this.invalidated) return;
    const base = this.streamBase, updates = [...(this.streamUpdates || [])].sort((a, b) => a - b);
    if (!base || this.loadingScope || base.activeId !== this.activeId || this.messages.length < base.count || this.messages.slice(base.count).some((_, i) => !updates.includes(base.count + i))) { this.post(); return; }
    this.view?.webview.postMessage({ type: 'stream', projectKey: this.projectKey, revision: this.streamRevision, activeId: this.activeId, messageCount: this.messages.length, messages: updates.map(index => ({ index, message: this.messages[index] })), tasks: this.tasks || [] });
    base.count = this.messages.length; this.streamUpdates?.clear();
  }
  schedulePost() { if (!this.postTimer && !this.invalidated) this.postTimer = setTimeout(() => { this.postTimer = null; this.postStream(); }, 60); }
  async attachFiles(current = false) {
    await this.ready;
    if (!this.project || this.busy || this.invalidated) return;
    const targetId = this.activeId, project = this.project;
    const isCurrent = () => !this.invalidated && this.activeId === targetId && this.project === project;
    if (current) {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.isClosed || editor.document.uri.scheme !== 'file' || !review.within(this.project, editor.document.uri.fsPath)) throw new Error('请先打开本项目中的一个文件');
      const selected = !editor.selection.isEmpty;
      const attachment = { id: crypto.randomUUID(), path: editor.document.uri.fsPath, label: path.basename(editor.document.fileName) + (selected ? `:${editor.selection.start.line + 1}-${editor.selection.end.line + 1}` : ''), text: selected ? editor.document.getText(editor.selection) : editor.document.getText() };
      attachment.truncated = attachment.text.length > 100000; attachment.text = attachment.text.slice(0, 100000);
      this.attachments = this.attachments.filter(a => a.path !== attachment.path || a.label !== attachment.label);
      if (this.attachments.length >= 20) throw new Error('最多引用 20 项上下文');
      this.attachments.push(attachment);
    } else {
      const files = await vscode.workspace.findFiles('**/*', '**/{.git,node_modules,dist,build,.next,.venv}/**', 2000);
      if (!isCurrent()) return;
      const picked = await vscode.window.showQuickPick(files.filter(uri => uri.scheme === 'file' && review.within(project, uri.fsPath)).map(uri => ({ label: vscode.workspace.asRelativePath(uri), uri })), { canPickMany: true, placeHolder: '搜索项目文件，作为上下文附到当前消息' });
      if (!isCurrent()) return;
      for (const item of (picked || []).slice(0, 20)) {
        if (this.attachments.length >= 20) { vscode.window.showInformationMessage('最多引用 20 项上下文'); break; }
        if (item.uri.scheme !== 'file' || !review.within(project, item.uri.fsPath)) continue;
        const text = review.readText(item.uri.fsPath);
        if (text === undefined || text === null) { vscode.window.showInformationMessage(`${item.label} 不是可读取的小型文本文件`); continue; }
        if (!this.attachments.some(a => a.path === item.uri.fsPath)) this.attachments.push({ id: crypto.randomUUID(), path: item.uri.fsPath, label: item.label, text: text.slice(0, 100000), truncated: text.length > 100000 });
      }
    }
    this.post();
  }
  async attachContext(kind, folderUri) {
    await this.ready;
    if (this.busy || this.invalidated || !this.project) return;
    const core = require('./context.cjs'), targetId = this.activeId, project = this.project; let text, label;
    const isCurrent = () => !this.invalidated && this.activeId === targetId && this.project === project;
    if (kind === 'diagnostics') {
      text = core.diagnostics(this.project, vscode.languages.getDiagnostics()); label = '项目诊断';
      if (!text) return vscode.window.showInformationMessage('当前项目没有错误或警告');
    } else if (kind === 'git') {
      const selected = await vscode.window.showQuickPick(['未暂存差异', '暂存区差异'], { title: '引用 Git 差异' }); if (!selected || !isCurrent()) return;
      text = await core.gitDiff(this.project, selected === '暂存区差异'); label = selected;
      if (!isCurrent()) return;
      if (!text.trim()) return vscode.window.showInformationMessage('所选范围没有 Git 差异');
    } else if (kind === 'folder') {
      if (!folderUri) { const selected = await vscode.window.showOpenDialog({ defaultUri: vscode.Uri.file(this.project), canSelectFiles: false, canSelectFolders: true, canSelectMany: false }); folderUri = selected?.[0]; }
      if (!folderUri || !isCurrent()) return;
      if (folderUri.scheme !== 'file' || !review.within(this.project, folderUri.fsPath)) throw new Error('文件夹不属于当前项目');
      const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folderUri, '**/*'), '**/{.git,node_modules,dist,build,.next,.venv,__pycache__}/**', 200);
      if (!isCurrent()) return;
      const result = core.folderText(this.project, folderUri.fsPath, files.filter(uri => uri.scheme === 'file').map(uri => uri.fsPath));
      if (!result.count) return vscode.window.showInformationMessage('文件夹没有可引用的文本文件');
      text = result.text; label = `${path.relative(this.project, folderUri.fsPath) || path.basename(this.project)}/ · ${result.count} 文件${result.limited ? '（部分）' : ''}`;
    } else return;
    if (!isCurrent()) return;
    this.attachments = this.attachments.filter(a => a.kind !== kind || a.label !== label);
    if (this.attachments.length >= 20) throw new Error('最多引用 20 项上下文');
    this.attachments.push(core.attachment(kind, label, text, this.project)); this.post();
  }
  async showDiff(file) {
    const metadata = this.changes?.find(c => c.path === file); if (!metadata) return;
    if ('beforeRef' in metadata && this.checkpointStore) {
      const uri = ref => vscode.Uri.from({ scheme: 'gptide-checkpoint', path: `/${this.projectKey}/${ref || 'empty'}/${path.basename(file)}` });
      await vscode.commands.executeCommand('vscode.diff', uri(metadata.beforeRef), uri(metadata.afterRef), `${metadata.relative} · 此轮修改前 ↔ 修改后`); return;
    }
    const change = this.checkpointStore ? this.checkpointStore.materialize(metadata) : metadata;
    const id = crypto.randomUUID(); this.contextBefore ||= new Map(); this.contextBefore.set(id, change.before || ''); this.contextBefore.set(id + '-after', change.after || '');
    while (this.contextBefore.size > 40) this.contextBefore.delete(this.contextBefore.keys().next().value);
    await vscode.commands.executeCommand('vscode.diff', vscode.Uri.parse('gptide-before:/' + id), vscode.Uri.parse('gptide-before:/' + id + '-after'), `${change.relative} · 此轮修改前 ↔ 修改后`);
  }
  beforeContent(uri) { const key = uri.path.slice(1); if (!this.contextBefore?.has(key)) throw new Error('临时预览已过期，请重新生成或查看保存的检查点'); return this.contextBefore.get(key); }
  async showCurrentDiff(file) {
    const metadata = this.changes?.find(c => c.path === file); if (!metadata || !review.within(this.project, file)) return;
    const change = this.checkpointStore ? this.checkpointStore.materialize(metadata) : metadata;
    const before = 'afterRef' in metadata ? vscode.Uri.from({ scheme: 'gptide-checkpoint', path: `/${this.projectKey}/${metadata.afterRef || 'empty'}/${path.basename(file)}` }) : vscode.Uri.parse('gptide-before:/' + crypto.randomUUID());
    if (!('afterRef' in metadata)) { this.contextBefore ||= new Map(); this.contextBefore.set(before.path.slice(1), change.after || ''); }
    const current = review.readText(file); if (current === undefined) throw new Error('当前文件无法作为文本比较');
    const right = current === null ? vscode.Uri.from({ scheme: 'gptide-checkpoint', path: `/${this.projectKey}/empty/${path.basename(file)}` }) : vscode.Uri.file(file);
    await vscode.commands.executeCommand('vscode.diff', before, right, `${change.relative} · 此轮修改后 ↔ 当前文件`);
  }
  async exportChat() {
    await this.ready;
    const chat = this.chats.find(c => c.id === this.activeId && c.projectKey === this.projectKey); if (!chat || this.invalidated) return;
    if (!chat.messages?.length && !chat.tasks?.length && !chat.draft?.trim()) return vscode.window.showInformationMessage('当前对话没有可导出的内容');
    const core = require('./conversation.cjs'), snapshot = core.snapshot(chat), streaming = this.busy;
    const extras = await vscode.window.showQuickPick([{ label: '包含任务日志', kind: 'tasks' }, { label: '包含未发送草稿', kind: 'draft' }], { canPickMany: true, title: '导出对话', placeHolder: '全部消息会导出，可选附加内容' }); if (!extras) return;
    const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(this.project, core.filename(snapshot.name))), filters: { Markdown: ['md'] }, title: '导出当前项目对话' });
    if (!uri || this.invalidated) return;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(core.markdown(snapshot, this.project, { streaming, tasks: extras.some(e => e.kind === 'tasks'), draft: extras.some(e => e.kind === 'draft') }), 'utf8'));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  }
  async revert(file, redo = false) {
    if (this.actionLocked() || this.invalidated) return;
    if (this.storageBlocked) throw new Error(this.historyWarning);
    const metadata = this.changes?.find(c => c.path === file); if (!metadata || (redo ? metadata.status !== 'reverted' : !['pending', 'accepted'].includes(metadata.status)) || !review.within(this.project, file)) return;
    const restore=this.prepareRestore(metadata,redo);
    this.reviewBusy = true; this.post();
    try { await this.applyRestore(restore); }
    finally { this.reviewBusy = false; this.post(); }
  }
  prepareRestore(metadata,redo=false){
    const file=metadata.path;
    if(!review.within(this.project,file))throw new Error('文件不属于当前项目');
    if (!vscode.workspace.isTrusted) throw new Error('请先信任项目以撤销文件修改');
    const change = this.checkpointStore ? this.checkpointStore.materialize(metadata) : metadata;
    const restore={metadata,file,expected:redo?change.before:change.after,target:redo?change.after:change.before,redo};
    this.checkRestore(restore);return restore;
  }
  checkRestore({file,expected}){
    if(this.invalidated||!review.within(this.project,file))throw new Error('项目已改变，已停止撤销');
    if(!vscode.workspace.isTrusted)throw new Error('请先信任项目以撤销文件修改');
    const sameFile = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() === path.resolve(file).toLowerCase() : path.resolve(value) === path.resolve(file);
    if (review.readText(file) !== expected || vscode.workspace.textDocuments.some(d => d.uri.scheme === 'file' && sameFile(d.uri.fsPath) && d.isDirty)) throw new Error('文件已有后续修改或未保存编辑，无法安全恢复。请先查看差异。');
  }
  async applyRestore(restore){
      this.checkRestore(restore);
      const {file,target,metadata,redo}=restore;
      const uri = vscode.Uri.file(file);
      if (target === null) await vscode.workspace.fs.delete(uri, { recursive: false });
      else await vscode.workspace.fs.writeFile(uri, Buffer.from(target, 'utf8'));
      if (review.readText(file) !== target) throw new Error('恢复结果与检查点不一致，请检查文件');
      this.changeStatus(metadata, redo ? 'pending' : 'reverted');
      if(!this.save())throw new Error(this.historyWarning||'文件已恢复，但检查点状态保存失败');
  }
  async renameChat(id=this.activeId) {
    const chat = this.chats.find(c => c.id === id && c.projectKey === this.projectKey); if (!chat || this.actionLocked() || this.storageBlocked || this.invalidated) return;
    const name = await vscode.window.showInputBox({ prompt: '对话名称', value: chat.name, validateInput: s => s.trim() ? null : '名称不能为空' });
    if (name?.trim() && !this.actionLocked() && !this.invalidated && !this.storageBlocked && this.chats.includes(chat)) {const old=chat.name,metadata=this.cursorChatMetadata?.[chat.id]; chat.name = name.trim().slice(0, 200); this.rememberCursorMetadata(chat);if(!this.save()){chat.name=old;if(chat.source==='cursor'){if(metadata)this.cursorChatMetadata[chat.id]=metadata;else delete this.cursorChatMetadata[chat.id];}} this.post(); }
  }
  async inlineEdit() {
    await this.ready;
    if (this.invalidated) throw new Error('项目已切换，已放弃改写。');
    if (this.actionLocked()) throw new Error('请等待当前任务或登录完成后再改写选区。');
    const editor = vscode.window.activeTextEditor, document = editor?.document;
    if (!this.project || !document || document.uri.scheme !== 'file' || !review.within(this.project, document.uri.fsPath)) throw new Error('请先打开本项目中的代码文件。');
    if (!vscode.workspace.isTrusted) throw new Error('请先信任此项目，再使用 Ctrl+K 改写。');
    const range = new vscode.Range(editor.selection.start, editor.selection.end);
    const snapshot = { file: document.uri.fsPath, language: document.languageId, version: document.version, text: document.getText(), start: document.offsetAt(range.start), end: document.offsetAt(range.end), eol: document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n' };
    let instruction; this.inlinePromptBusy = true; this.post();
    try { instruction = await require('./inline-input.cjs').prompt(vscode, editor); }
    finally { this.inlinePromptBusy = false; this.post(); if (!instruction && !this.invalidated) this.scheduleQueue(this.activeId); }
    if (!instruction) return;
    if (this.invalidated) throw new Error('项目已切换，已放弃改写。');
    if (this.actionLocked()) throw new Error('已有任务开始，请等待完成。');
    if (!vscode.workspace.isTrusted) throw new Error('请先信任此项目，再使用 Ctrl+K 改写。');
    if (document.isClosed || !inlineCore.unchanged(snapshot, { text: document.getText(), version: document.version })) throw new Error('代码在输入要求期间发生变化，请重新选择后改写。');
    this.inlineBusy = true; this.post();
    const cancellation = new vscode.CancellationTokenSource(); this.inlineCancellation = cancellation;
    try {
      const fixed = this.fixedContext?.read(); if (fixed) { snapshot.projectContext = fixed.text; if (fixed.warnings.length) this.contextWarning = fixed.warnings.join('；'); }
      const replacement = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'GPTIDE 正在改写选区', cancellable: true }, async (_, token) => {
        const relay = token.onCancellationRequested(() => cancellation.cancel());
        if (token.isCancellationRequested || this.invalidated) cancellation.cancel();
        try { return await inlineAgent.generate({ executable: findCodex(vscode.workspace.getConfiguration('gptide').get('codexPath')), cwd: this.project, model: this.model, effort: this.effort, snapshot, instruction, token: cancellation.token }); }
        finally { relay.dispose(); }
      });
      if (this.invalidated) throw new Error('项目已切换，已放弃改写。');
      if (cancellation.token.isCancellationRequested) throw new Error('已取消代码改写。');
      const current = () => ({ text: document.getText(), version: document.version });
      if (document.isClosed || !inlineCore.unchanged(snapshot, current())) throw new Error('代码在生成期间发生变化或文件已关闭，已放弃应用。');
      const proposed = inlineCore.proposal(snapshot, replacement);
      if (proposed.text === snapshot.text) { vscode.window.showInformationMessage('模型未提出代码变化。'); return; }
      const id = crypto.randomUUID(); this.contextBefore ||= new Map(); this.contextBefore.set(id + '-before', snapshot.text); this.contextBefore.set(id + '-after', proposed.text); while (this.contextBefore.size > 40) this.contextBefore.delete(this.contextBefore.keys().next().value);
      const before = vscode.Uri.parse('gptide-before:/' + id + '-before'), after = vscode.Uri.parse('gptide-before:/' + id + '-after');
      await vscode.languages.setTextDocumentLanguage(await vscode.workspace.openTextDocument(before), document.languageId);
      await vscode.languages.setTextDocumentLanguage(await vscode.workspace.openTextDocument(after), document.languageId);
      await vscode.commands.executeCommand('vscode.diff', before, after, `${path.basename(document.fileName)} · Ctrl+K 修改预览`);
      const answer = await vscode.window.showInformationMessage('检查差异后选择是否应用到原文件。', '应用修改', '放弃');
      if (answer !== '应用修改') return;
      if (this.invalidated) throw new Error('项目已切换，已拒绝应用。');
      if (!vscode.workspace.isTrusted) throw new Error('项目未受信任，已拒绝应用。');
      if (document.isClosed || !inlineCore.unchanged(snapshot, current())) throw new Error('原文件已有后续修改或已关闭，无法安全应用。请重新生成。');
      const edit = new vscode.WorkspaceEdit(); edit.replace(document.uri, range, proposed.replacement);
      if (!await vscode.workspace.applyEdit(edit)) throw new Error('应用修改失败。');
      await vscode.window.showTextDocument(document); vscode.window.showInformationMessage('已应用选区修改。Ctrl+Z 可撤销；保存文件由你决定。');
    } finally { if (this.inlineCancellation === cancellation) this.inlineCancellation = null; cancellation.dispose(); this.inlineBusy = false; this.post(); if (!this.invalidated) this.scheduleQueue(this.activeId); }
  }
  async deleteChat(id=this.activeId) {
    const chat = this.chats.find(c => c.id === id && c.projectKey === this.projectKey); if (!chat || this.actionLocked() || this.storageBlocked || this.invalidated) return;
    const answer = await vscode.window.showWarningMessage(chat.source === 'cursor' ? '从 GPTIDE 隐藏此对话？Cursor 原记录会保留。' : '删除本地对话记录？', { modal: true }, '确认');
    if (answer !== '确认' || this.actionLocked() || this.storageBlocked || this.invalidated || !this.chats.includes(chat)) return;
    if (chat.source === 'cursor') this.hiddenCursorIds.push(chat.id);
    this.chats = this.chats.filter(c => c.id !== chat.id); this.openChatIds = this.openChatIds.filter(id => id !== chat.id);
    this.chatAttachments?.delete(chat.id);if(this.cursorChatMetadata)delete this.cursorChatMetadata[chat.id];if(this.activeId===chat.id){const next=this.openChatIds[0]||this.chats.find(c=>!c.archived)?.id;if(next)this.select(next);else this.newChat();}this.save();this.post();
  }
  async connect() {
    if (this.invalidated) throw new Error('项目已切换');
    if (this.connecting) return this.connecting;
    if (this.bridge) return this.bridge;
    this.connecting = (async () => {
      const bridge = new Bridge(findCodex(vscode.workspace.getConfiguration('gptide').get('codexPath')), this.project || this.root, { timeout: preferences.values(vscode.workspace.getConfiguration('gptide')).rpcTimeout });
      this.pendingBridge = bridge;
      bridge.on('notification', event => { if (this.bridge === bridge || this.pendingBridge === bridge) this.onNotification(event); });
      bridge.on('request', request => this.approve(request, bridge).catch(e => { this.output.appendLine('Agent 请求处理失败：' + e.message); }));
      bridge.on('disconnected', e => { if (this.bridge === bridge && !this.invalidated) { for (const record of this.pendingRequests?.values() || []) if (record.bridge === bridge) { record.resolved = true; record.token.cancel(); } this.bridge = null; this.resumed = false; if (this.busy && this.turnId) this.finishTurn({ id: this.turnId, status: 'failed', error: e }); else { this.busy = false; this.status = e.message; this.post(); } } });
      try {
        await bridge.start();
        if (this.invalidated) throw new Error('项目已切换');
        this.bridge = bridge;
        await this.refreshAccount();
        return bridge;
      } catch (error) { if (this.bridge === bridge) this.bridge = null; bridge.dispose(); throw error; }
      finally { if (this.pendingBridge === bridge) this.pendingBridge = null; }
    })();
    try { return await this.connecting; } finally { this.connecting = null; }
  }
  async refreshAccount() {
    const bridge = this.bridge, epoch = Symbol('account-refresh');
    if (!bridge || this.invalidated) return;
    this.accountRefreshEpoch = epoch;
    const isCurrent = () => !this.invalidated && this.bridge === bridge && this.accountRefreshEpoch === epoch;
    let result, models;
    try {
      result = await bridge.call('account/read', { refreshToken: false });
      if (!isCurrent()) return;
      if (result.account && !['chatgpt', 'chatgptAuthTokens'].includes(result.account.type)) {
        this.account = { type: result.account.type, plan: result.account.planType }; this.status = '请使用 ChatGPT 登录；此软件不使用 API Key'; this.models = []; this.post(); return;
      }
      models = await require('./model-catalog.cjs').read(bridge, isCurrent);
      if (!isCurrent()) return;
    } catch (error) { if (isCurrent()) throw error; return; }
    this.account = result.account ? { type: result.account.type, plan: result.account.planType } : null;
    this.models = models || [];
    if (this.models.length && !this.models.some(m => m.model === this.model)) this.model = this.models.find(m => m.model === 'gpt-6.1-sol')?.model || this.models.find(m => m.isDefault)?.model || this.models[0].model;
    const current = this.models.find(m => m.model === this.model);this.serviceTier=require('./model-catalog.cjs').tier(current,this.serviceTier);
    this.effort = require('./model-catalog.cjs').effort(current, this.effort);
    this.status = this.account ? this.models.length ? `ChatGPT ${(this.account.plan || '').toUpperCase()} 已连接` : 'ChatGPT 已连接，但没有可用模型；请重新连接' : '请使用 ChatGPT 登录'; this.post();
  }
  async reconnect() {
    await this.ready;
    if (this.invalidated || this.actionLocked()) throw new Error('请先结束当前任务或登录再重新连接');
    if (this.reconnecting) return;
    this.reconnecting = true;
    const chat = this.chats.find(value => value.id === this.activeId && value.projectKey === this.projectKey); if (chat?.queue?.length) { chat.queuePaused = true; this.save(); }
    try { if (this.bridge && !this.connecting) await this.refreshAccount(); else await this.connect(); } finally { this.reconnecting = false; }
  }
  async restoreRequest(id, revision, editVersion) {
    await this.ready;
    const chat = this.chats.find(value => value.id === id && value.projectKey === this.projectKey);
    if (!chat || id !== this.activeId || revision !== this.streamRevision || this.invalidated || this.actionLocked() || this.storageBlocked) throw new Error('当前对话状态已变化，无法恢复草稿');
    if (!chat.lastRequest) throw new Error('没有可取回的指令');
    if (chat.draft?.trim()) throw new Error('当前草稿已有内容，请先处理草稿');
    if (!this.persistDraft(id, chat.lastRequest)) throw new Error(this.draftWarning || '恢复草稿失败');
    this.save();
    this.status = '已取回上次指令 · 尚未发送';
    this.view?.webview.postMessage({ type: 'draftRestored', projectKey: this.projectKey, id, text: chat.lastRequest, editVersion }); this.post();
  }
  async login() {
    await this.ready;
    if (this.invalidated) throw new Error('项目已切换');
    if (this.loginPending) return;
    if (this.actionLocked()) throw new Error('请先完成或停止当前任务，再切换 ChatGPT 账户');
    this.loginPending = true;
    this.status = '正在准备 ChatGPT 登录'; for (const chat of this.chats) if (chat.queue?.length) chat.queuePaused = true; this.save(); this.post();
    try {
      const bridge = await this.connect(); if (this.invalidated || this.busy || this.reviewBusy || this.inlineBusy || this.inlinePromptBusy) throw new Error('当前状态已变化，请完成任务后重试');
      const session = new (require('./login-session.cjs').LoginSession)(bridge, {
        open: url => vscode.env.openExternal(vscode.Uri.parse(url)), refresh: async () => { this.resumed = false; try { await this.refreshAccount(); } catch (error) { this.account = null; this.models = []; throw error; } },
        state: message => { if (!this.invalidated && this.loginSession === session) { this.status = message; this.post(); } },
        end: () => { if (this.loginSession === session) { this.loginSession = null; this.loginPending = false; if (!this.invalidated) this.post(); } }
      }); this.loginSession = session; await session.begin();
    } catch (error) { this.loginPending = false; this.post(); throw error; }
  }
  async send(text, mode, attach, clientSendId, queueId) {
    await this.ready;
    if (this.invalidated) throw new Error('项目已切换。');
    if (this.storageBlocked) throw new Error(this.historyWarning);
    if (this.loginPending) throw new Error('请先完成 ChatGPT 登录，再发送任务');
    if (this.reviewBusy) throw new Error('请等待文件恢复完成');
    if (this.inlineBusy || this.inlinePromptBusy) throw new Error('请先完成或放弃 Ctrl+K 修改预览。');
    if (this.busy || typeof text !== 'string' || !text.trim()) return;
    if (!['ask', 'agent', 'plan'].includes(mode)) throw new Error('未知工作模式');
    if (!this.project) throw new Error('请先打开项目文件夹');
    const submittedChatId = this.activeId, submitted = this.chats.find(c => c.id === submittedChatId && c.projectKey === this.projectKey);
    if (!submitted) throw new Error('当前对话归属无法确认');
    const queued = queueId ? submitted.queue?.find(item => item.id === queueId && item.status === 'starting') : null;
    if (queueId && !queued) throw new Error('排队消息已失效');
    const submittedDraftText = submitted.draft || '', submittedDraftVersion = submitted.draftVersion || 0, epoch = Symbol('send');
    const isCurrent = () => this.sendEpoch === epoch && !this.invalidated;
    const check = () => { if (!isCurrent()) throw new Error('发送状态已失效'); if (this.cancelPendingSend) throw new Error('已取消发送'); };
    if (mode === 'agent' && !vscode.workspace.isTrusted) throw new Error('请先在 VS Code 的工作区信任中信任此项目，或使用 Ask / Plan 只读模式');
    this.sendEpoch = epoch; this.busy = true; this.cancelPendingSend = false; submitted.lastRequest = text; submitted.lastOutcome = 'preparing';
    if (!this.save()) { this.busy = false; throw new Error(this.historyWarning || '请求记录未能保存'); }
    this.status = '正在准备'; this.post();
    let bridge;
    try {
      bridge = await this.connect();
      check();
      if (this.invalidated || submittedChatId !== this.activeId) throw new Error('项目或对话已切换，已取消发送');
      if (this.cancelPendingSend) throw new Error('已取消发送');
      if (!this.account || !['chatgpt', 'chatgptAuthTokens'].includes(this.account.type)) throw new Error('请先使用 ChatGPT 账号登录');
      if (Array.isArray(this.models) && !this.models.length) throw new Error('没有可用模型，请重新连接后再发送');
    } catch (error) { if (!isCurrent()) return; this.busy = false; this.pauseQueue(); const failure = this.cancelPendingSend ? new Error('已取消发送') : error; this.status = failure.message; this.post(); throw failure; }
    this.mode = mode; this.busy = true; this.status = '正在思考'; this.activity = ''; this.post();
    try {
      let importedContext = '';
      const selected = this.chats.find(c => c.id === this.activeId);
      if (selected?.backgroundPending) {
        const transcript = selected.messages.slice(0, selected.backgroundCount).map(m => `[${m.role}]\n${m.text}`).join('\n\n');
        const limit = preferences.values(vscode.workspace.getConfiguration('gptide')).importLimit;
        if (transcript.length > limit) {
          const answer = await vscode.window.showWarningMessage(`历史摘录较长，将发送最近 ${limit.toLocaleString()} 字符作为背景，完整记录仍可查看。`, { modal: true }, '继续');
          check(); if (answer !== '继续') { this.busy = false; this.status = '已取消发送'; this.post(); return; }
        }
        importedContext = '以下是已有对话的历史摘录，仅作为项目背景。请以当前请求为准。\n' + transcript.slice(-limit) + '\n\n当前请求：\n';
      }
      if (!selected || selected.source === 'cursor') {
        if (selected) {
          const transcript = selected.messages.map(m => `[${m.role}]\n${m.text}`).join('\n\n');
          const importLimit = preferences.values(vscode.workspace.getConfiguration('gptide')).importLimit;
          if (transcript.length > importLimit) {
            const answer = await vscode.window.showWarningMessage(`这段 Cursor 历史较长。继续时将发送最近 ${importLimit.toLocaleString()} 字符作为背景，完整记录仍可查看。`, { modal: true }, '继续');
            check(); if (answer !== '继续') { this.busy = false; this.status = '已取消发送'; this.post(); return; }
          }
          importedContext = '以下是从 Cursor 导入的历史对话，仅作为项目背景。请以用户当前请求为准。\n' + transcript.slice(-importLimit) + '\n\n当前请求：\n';
        }
        const chat = { id: crypto.randomUUID(), projectKey: this.projectKey, source: 'gptide', name: text.slice(0, 40), draft: selected?.draft || '', draftUpdatedAt: selected?.draftUpdatedAt || 0, draftVersion: selected?.draftVersion || 0, messages: selected ? selected.messages.map(m => ({ ...m })) : [], lastRequest: text, lastOutcome: 'preparing', backgroundPending: !!selected, backgroundCount: selected?.messages.length || 0, updatedAt: Date.now() };
        this.chats.unshift(chat); if (!this.openChatIds.includes(chat.id)) this.openChatIds.push(chat.id); this.activeId = chat.id; this.messages = chat.messages; this.threadId = null; this.resumed = false;
      }
      const named = this.chats.find(c => c.id === this.activeId); if (named?.name === '新对话' && !named.messages.length) named.name = text.slice(0, 40);
      if (!this.resumed) {
        if (this.threadId) { const previous = await bridge.call('thread/read', { threadId: this.threadId, includeTurns: false }); check(); if (!projectScope.matches(previous.thread?.cwd, this.project)) throw new Error('对话不属于当前项目，已拒绝继续。'); }
        const params = { cwd: this.project, model: this.model, serviceTier:require("./model-catalog.cjs").tier(this.models?.find(m=>m.model===this.model),this.serviceTier), ...this.approvalSettings(), sandbox: mode === 'agent' ? 'workspace-write' : 'read-only' };
        const result = await bridge.call(this.threadId ? 'thread/resume' : 'thread/start', this.threadId ? { ...params, threadId: this.threadId } : params);
        check();
        this.threadId = result.thread.id; this.resumed = true;
        this.chats.find(c => c.id === this.activeId).threadId = this.threadId;
      }
      let editorContext = '';
      if (attach && vscode.window.activeTextEditor && review.within(this.project, vscode.window.activeTextEditor.document.uri.fsPath)) {
        const editor = vscode.window.activeTextEditor;
        const content = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
        editorContext = `\n\n当前编辑器文件：${editor.document.uri.fsPath}\n${content.slice(0, 50000)}`;
      }
      check(); const submissionAttachments = queued ? queued.attachments : this.attachments;
      const submittedAttachmentIds = new Set(submissionAttachments.map(a => a.id));
      const fixed = this.fixedContext?.read() || { text: '', labels: [], warnings: [] };
      editorContext += fixed.text;
      if (fixed.warnings.length) this.contextWarning = fixed.warnings.join('；'); else if (this.fixedContext) this.contextWarning = undefined;
      const labels = [...fixed.labels, ...submissionAttachments.map(a => a.label)]; let budget = 100000 - fixed.text.length;
      for (const attachment of submissionAttachments) { if (budget <= 0) break; const snippet = attachment.text.slice(0, Math.min(50000, budget)); budget -= snippet.length; editorContext += `\n\n引用${attachment.kind ? '上下文' : '文件'}：${attachment.kind ? attachment.label : attachment.path}\n${snippet}`; }
      if (submissionAttachments.some(a => a.truncated || a.text.length > 50000) || budget <= 0) this.importWarning = '引用上下文最多附上约 10 万字符，长内容已截断。';
      this.baseline = mode === 'agent' ? review.snapshot(this.project) : null; this.candidates = new Map();
      const active = this.chats.find(c => c.id === this.activeId); active.tasks ||= []; this.tasks = active.tasks; active.taskTurn = (active.taskTurn || 0) + 1; this.currentTaskTurn = active.taskTurn;
      if (this.baseline?.limited) this.importWarning = '项目较大，修改预览只覆盖已采集的文本文件。';
      this.messages.push({ role: 'user', text, attachments: labels, mode, model: this.model, createdAt: Date.now() }); if (!this.save()) throw new Error(this.historyWarning); this.post();
      const sentChatId = this.activeId, sentThreadId = this.threadId;
      this.pendingSubmission = { epoch, ids: [...new Set([submittedChatId, sentChatId])], draftText: submittedDraftText, draftVersion: submittedDraftVersion, attachmentIds: submittedAttachmentIds, chatId: sentChatId, threadId: sentThreadId, clientSendId, queueId, clearDraft: !queueId };
      const instruction = mode === 'plan' ? '请先调查项目并给出具体实施计划、涉及文件和验证步骤。本轮只做计划，不修改文件。\n\n' : '';
      const result = await bridge.call('turn/start', { threadId: this.threadId, model: this.model, serviceTier:require('./model-catalog.cjs').tier(this.models?.find(m=>m.model===this.model),this.serviceTier), effort: this.effort, ...this.approvalSettings(), input: [{ type: 'text', text: instruction + importedContext + text + editorContext }], sandboxPolicy: mode !== 'agent' ? { type: 'readOnly' } : { type: 'workspaceWrite', writableRoots: [this.project], networkAccess: preferences.values(vscode.workspace.getConfiguration('gptide')).networkAccess, excludeTmpdirEnvVar: false, excludeSlashTmp: false } });
      if (!isCurrent()) return;
      if (this.busy) this.turnId = result.turn.id;
      if (this.cancelPendingSend && this.busy) await bridge.call('turn/interrupt', { threadId: sentThreadId, turnId: result.turn.id });
      if (!isCurrent()) return;
      this.acknowledgeSubmission(epoch);
    } catch (e) { if (!isCurrent() || this.finishedSendEpoch === epoch) return; if (this.busy && this.turnId) { this.status = '任务已启动，等待后续状态'; this.post(); return; } this.pendingSubmission = null; this.busy = false; this.pauseQueue(); this.status = e.message; this.post(); throw e; }
  }
  acknowledgeSubmission(epoch) {
    const pending = this.pendingSubmission;
    if (!pending || pending.epoch !== epoch || this.sendEpoch !== epoch || this.invalidated) return;
    this.pendingSubmission = null;
    const background = this.chats.find(chat => chat.id === pending.chatId && chat.projectKey === this.projectKey);
    if (background) { background.lastOutcome = 'running'; this.save(); }
    if (background?.backgroundPending) { background.backgroundPending = false; this.save(); }
    if (pending.queueId && background) { background.queue = background.queue.filter(item => item.id !== pending.queueId); this.save(); }
    if (pending.clearDraft !== false) for (const id of pending.ids) { const chat = this.chats.find(c => c.id === id && c.projectKey === this.projectKey); if (chat?.draft === pending.draftText && (chat.draftVersion || 0) === pending.draftVersion) this.persistDraft(id, ''); }
    if (this.activeId === pending.chatId) this.attachments = this.attachments.filter(a => !pending.attachmentIds.has(a.id));
    else if (this.chatAttachments?.has(pending.chatId)) this.chatAttachments.set(pending.chatId, this.chatAttachments.get(pending.chatId).filter(a => !pending.attachmentIds.has(a.id)));
    if (!pending.queueId) this.view?.webview.postMessage({ type: 'sent', projectKey: this.projectKey, id: pending.chatId, clientSendId: pending.clientSendId }); this.post();
  }
  async approve(request, bridge = this.bridge) {
    if (!bridge || !request || !['string', 'number'].includes(typeof request.id)) return;
    const input = request.method === 'item/tool/requestUserInput', approval = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(request.method);
    if (!input && !approval) { bridge.send({ id: request.id, error: { code: -32601, message: 'GPTIDE 尚不支持此请求' } }); return; }
    const params = request.params, activeId = this.activeId, key = typeof request.id + ':' + String(request.id);
    const current = () => !this.invalidated && !record?.resolved && this.bridge === bridge && this.busy && this.activeId === activeId && typeof params?.threadId === 'string' && params.threadId === this.threadId && typeof params.turnId === 'string' && !!params.turnId && (!this.turnId || params.turnId === this.turnId) && !this.retiredTurnIds?.has(params.turnId);
    let record;
    if (!current()) { bridge.reply(request.id, input ? { answers: {} } : { decision: 'decline' }); return; }
    this.pendingRequests ||= new Map(); if (this.pendingRequests.has(key)) return;
    const token = new vscode.CancellationTokenSource(); record = { bridge, token, threadId: params.threadId, turnId: params.turnId }; this.pendingRequests.set(key, record);
    try {
      let result;
      if (input) result = await require('./request-input.cjs').ask(vscode, params, current, token.token);
      else {
        const label = params.command || params.reason || '修改项目文件', details = [params.reason && params.command ? params.reason : '', params.cwd ? '目录：' + params.cwd : '', params.grantRoot ? '请求写入：' + params.grantRoot : ''].filter(Boolean).join('\n');
        const answer = await vscode.window.showWarningMessage(`AI 请求授权：${label}`, { modal: true, detail: details }, '允许此次');
        result = { decision: answer === '允许此次' && current() ? 'accept' : 'decline' };
      }
      if (!record.resolved) bridge.reply(request.id, current() ? result : input ? { answers: {} } : { decision: 'decline' });
    } catch (error) { if (!record.resolved) bridge.send({ id: request.id, error: { code: -32602, message: error.message } }); }
    finally { token.dispose(); if (this.pendingRequests.get(key) === record) this.pendingRequests.delete(key); }
  }
  onNotification({ method, params: p }) {
    if (this.invalidated || typeof method !== 'string') return;
    if (method === 'account/rateLimits/updated') { require('./usage.cjs').save(this.root, p).catch(() => {}); return; }
    if (method === 'account/login/completed') return; // LoginSession owns the matching loginId.
    if (p?.threadId && p.threadId !== this.threadId) return;
    if (method === 'serverRequest/resolved') { const request = this.pendingRequests?.get(typeof p?.requestId + ':' + String(p?.requestId)); if (request && request.threadId === p?.threadId) { request.resolved = true; request.token.cancel(); } return; }
    if (method.startsWith('turn/') || method.startsWith('item/') || method === 'error') {
      if (method.startsWith('turn/') && typeof p?.turn?.id !== 'string') return;
      const turnId = p?.turnId || p?.turn?.id;
      if (!this.busy || p?.threadId !== this.threadId || typeof turnId !== 'string' || !turnId || this.retiredTurnIds?.has(turnId) || this.turnId && this.turnId !== turnId) return;
      if (!this.turnId) this.turnId = turnId;
    }
    if (method === 'turn/started' && this.pendingSubmission?.threadId === p.threadId) this.acknowledgeSubmission(this.pendingSubmission.epoch);
    if (p && tasklog.update(this.tasks || (this.tasks = []), method, p, this.currentTaskTurn)) {
      if (method.endsWith('/outputDelta')) this.schedulePost();
      else { if (method === 'item/completed') this.save(); this.post(); }
    }
    if (method === 'item/agentMessage/delta' && typeof p.itemId === 'string' && typeof p.delta === 'string') {
      let item = this.messages.find(m => m.itemId === p.itemId);
      if (!item) { item = { role: 'assistant', text: '', itemId: p.itemId, createdAt: Date.now() }; this.messages.push(item); }
      item.text += p.delta; (this.streamUpdates ||= new Set()).add(this.messages.indexOf(item)); this.schedulePost();
    }
    if (method === 'item/started') { this.activity = p.item?.type === 'commandExecution' ? '运行：' + p.item.command : p.item?.type === 'fileChange' ? '正在修改文件' : '正在处理项目'; this.post(); }
    if (method === 'item/completed' && p.item?.type === 'fileChange' && this.candidates) {
      for (const change of p.item.changes || []) { this.candidates.set(change.path, change.kind?.type || 'update'); const moved = change.kind?.move_path || change.kind?.movePath; if (moved) this.candidates.set(moved, 'add'); }
    }
    if (method === 'item/completed' && p.item?.type === 'agentMessage' && typeof p.item.id === 'string') {
      let item = this.messages.find(m => m.itemId === p.item.id);
      if (!item) { item = { role: 'assistant', text: '', itemId: p.item.id, createdAt: Date.now() }; this.messages.push(item); }
      if (typeof p.item.text === 'string') item.text = p.item.text; this.post();
    }
    if (method === 'turn/completed') this.finishTurn(p.turn);
    if (method === 'error') { if (!p.willRetry) this.finishTurn({ id: p.turnId, status: 'failed', error: p.error }); else { this.status = p.error?.message || '正在重试'; this.save(); this.post(); } }
  }
  finishTurn(turn) {
    const unconfirmedQueueId = this.pendingSubmission?.queueId;
    this.finishedSendEpoch = this.sendEpoch;
    if (turn.status !== 'failed' && this.pendingSubmission?.threadId === this.threadId) this.acknowledgeSubmission(this.pendingSubmission.epoch);
    this.pendingSubmission = null;
    this.retireTurn(turn.id); tasklog.finish(this.tasks || [], turn.id, turn.status);
    this.busy = false; this.turnId = null; this.status = turn.status === 'failed' ? turn.error?.message || '请求失败' : turn.status === 'interrupted' ? '已停止' : '完成'; this.activity = '';
    const chat = this.chats.find(c => c.id === this.activeId && c.projectKey === this.projectKey);
    if (this.baseline) {
      try { this.changes = review.collectRoundChanges(this.project, this.baseline, this.candidates || new Map()); if (chat) { this.changes.limited = !!(this.baseline.limited || this.changes.limited); chat.changes = this.changes; chat.pendingCheckpointTurn = this.currentTaskTurn; if (this.changes.limited) this.importWarning = '此轮检查点只覆盖已采集的文本文件'; this.prepareReview(chat, false); } }
      catch (error) { this.importWarning = '修改预览读取失败：' + error.message; }
      this.baseline = null;
    }
    if (chat) {
      chat.updatedAt = Date.now(); chat.lastOutcome = ['completed', 'failed', 'interrupted'].includes(turn.status) ? turn.status : 'unknown'; if (turn.status !== 'completed') chat.queuePaused = true;
      const item = chat.queue?.find(value => value.id === unconfirmedQueueId); if (item && turn.status === 'failed') { item.status = 'failed'; item.error = turn.error?.message || '任务失败，请检查对话后重试'; }
    }
    this.queueDispatchToken = null; this.save(); this.post();
    if (chat?.queue?.length && !chat.queuePaused && turn.status === 'completed') this.scheduleQueue(chat.id);
  }
  retireTurn(id) { this.retiredTurnIds ||= new Set(); this.retiredTurnIds.add(id); if (this.retiredTurnIds.size > 100) this.retiredTurnIds.delete(this.retiredTurnIds.values().next().value); for (const record of this.pendingRequests?.values() || []) if (record.turnId === id) record.token.cancel(); }
  resolveWebviewView(view) {
    this.view = view; view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.file(this.context.extensionPath)] };
    const nonce = crypto.randomBytes(20).toString('hex');
    const source = name => fs.readFileSync(path.join(this.context.extensionPath, name), 'utf8');
    view.webview.html = source('view.html').replace('__STYLE__', () => source('view.css')).replace('__MARKDOWN__', () => source('markdown.cjs')).replace('__CODE__', () => source('code.cjs')).replace('__FIND__', () => source('find.cjs')).replace('__ACTIONS__', () => source('quick-actions.cjs')).replace('__SCRIPT__', () => source('view.js')).replaceAll('__NONCE__', nonce).replaceAll('__PROJECT_KEY__', this.projectKey);
    view.webview.onDidReceiveMessage(async msg => {
      if (this.invalidated || msg.projectKey !== this.projectKey) return;
      if (msg.type !== 'ready') { await this.ready; if (this.invalidated) return; }
      try {
        if (msg.type === 'ready') this.post();
        if (msg.type === 'focusHandled' && msg.id === this.focusRequestId) this.focusRequestId = undefined;
        if (msg.type === 'openCode') await this.showCode(msg.id,msg.index,msg.codeIndex,msg.revision);
        if (msg.type === 'draft') { const saved = this.persistDraft(msg.id, msg.text); this.view?.webview.postMessage({ type: 'draftSaved', projectKey: this.projectKey, id: msg.id, sequence: msg.sequence, saved, history: history.entries(this.chats.filter(c => c.projectKey === this.projectKey), this.activeId) }); }
        if (msg.type === 'login') await this.login();
        if (msg.type === 'cancelLogin') await this.loginSession?.cancel();
        if (msg.type === 'reconnect') await this.reconnect();
        if (msg.type === 'restoreRequest') await this.restoreRequest(msg.id, msg.revision, msg.editVersion);
        if (msg.type === 'send') await this.send(msg.text, msg.mode, msg.attach, typeof msg.clientSendId === 'string' && msg.clientSendId.length <= 160 ? msg.clientSendId : undefined);
        if (msg.type === 'enqueue') await this.enqueue(msg.text, msg.mode, msg.clientSendId);
        if (['queuePause', 'queueEdit', 'queueRemove', 'queueMove', 'queueRetry'].includes(msg.type)) await this.queueAction(msg.type, msg.id, msg.direction);
        if (msg.type === 'stop' && this.busy) { const chat = this.chats.find(value => value.id === this.activeId); if (chat) chat.queuePaused = true; this.cancelPendingSend = true; this.status = '正在停止'; this.post(); if (this.turnId && this.bridge) await this.bridge.call('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }); else if (!this.bridge) this.pendingBridge?.dispose(); }
        if (msg.type === 'select') { if (!this.busy && this.select(msg.id)) this.save(); else { this.view?.webview.postMessage({ type: 'tabChangeRejected', projectKey: this.projectKey }); this.post(); } }
        if (msg.type === 'new') { if (!this.actionLocked() && !this.storageBlocked) this.newChat(); else { this.view?.webview.postMessage({ type: 'tabChangeRejected', projectKey: this.projectKey }); this.post(); } }
        if (msg.type === 'branch') { if (!this.branchChat(msg.id, msg.index, msg.revision)) { this.view?.webview.postMessage({ type: 'tabChangeRejected', projectKey: this.projectKey }); this.post(); } }
        if (msg.type === 'closeTab') { if (!this.actionLocked()) this.closeTab(msg.id, msg.draft); else { this.view?.webview.postMessage({ type: 'tabChangeRejected', projectKey: this.projectKey }); this.post(); } }
        if(msg.type==='model')this.chooseModel(msg.value);
        if(msg.type==='serviceTier')this.chooseServiceTier(msg.value);
        if(msg.type==='approvalMode')this.chooseApprovalMode(msg.value);
        if (msg.type === 'effort' && !this.actionLocked() && this.models?.find(m => m.model === this.model)?.supportedReasoningEfforts?.some(e => e.reasoningEffort === msg.value)) { this.effort = msg.value; this.save(); this.post(); }
        if (msg.type === 'attach') await this.attachFiles();
        if (msg.type === 'attachCurrent') await this.attachFiles(true);
        if (msg.type === 'attachDiagnostics') await this.attachContext('diagnostics');
        if (msg.type === 'attachGitDiff') await this.attachContext('git');
        if (msg.type === 'attachFolder') await this.attachContext('folder');
        if (msg.type === 'removeAttachment') { this.attachments = this.attachments.filter(a => a.id !== msg.id); this.post(); }
        if (msg.type === 'rename') await this.renameChat(msg.id);
        if(msg.type==='pinChat'||msg.type==='archiveChat')this.setHistoryFlag(msg.id,msg.type==='pinChat'?'pinned':'archived',msg.value);
        if(msg.type==='reviewAction')await this.reviewAction(msg.action,msg.id,msg.checkpointId,msg.revision);
        if(msg.type==='reviewDecision')await this.reviewDecision(msg);
        if (msg.type === 'delete') await this.deleteChat(msg.id);
        if (msg.type === 'diff') await this.showDiff(msg.path);
        if (msg.type === 'diffCurrent') await this.showCurrentDiff(msg.path);
        if (msg.type === 'checkpoint') this.selectCheckpoint(msg.id);
        if (msg.type === 'cleanupCheckpoints') this.cleanupCheckpoints();
        if (msg.type === 'openFile' && typeof msg.path === 'string' && this.project && this.tasks?.some(task => task.files?.includes(msg.path))) { const file = path.resolve(this.project, msg.path); if (review.within(this.project, file) && fs.existsSync(file) && fs.statSync(file).isFile()) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(file))); }
        if (msg.type === 'revert') await this.revert(msg.path);
        if (msg.type === 'redo') await this.revert(msg.path, true);
        if (msg.type === 'accept' && !this.actionLocked()) { const change = this.changes.find(c => c.path === msg.path); if (change) { this.changeStatus(change, 'accepted'); this.save(); this.post(); } }
        if (msg.type === 'copy' && typeof msg.text === 'string') await this.copyText(msg.text,msg.copyId);
        if (msg.type === 'openLink' && /^https?:\/\//i.test(msg.url)) await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        if (msg.type === 'settings') await vscode.commands.executeCommand('gptide.settings');
        if (msg.type === 'usage') await vscode.commands.executeCommand('gptide.usage');
        if (msg.type === 'export') await this.exportChat();
        if (msg.type === 'copyTasks' && Array.isArray(msg.ids)) { const ids = new Set(msg.ids.filter(id => typeof id === 'string').slice(0, 200)), selected = (this.tasks || []).filter(t => ids.has(t.turnId + ':' + t.id)); await vscode.env.clipboard.writeText(require('./conversation.cjs').taskReport(selected)); }
        if (msg.type === 'refresh' && !this.actionLocked()) { if (this.storageBlocked) { await vscode.commands.executeCommand('workbench.action.reloadWindow'); return; } await this.importCursor(true); if (!this.select(this.activeId) && !this.select(this.chats[0]?.id)) this.newChat(); if (preferences.values(vscode.workspace.getConfiguration('gptide')).autoConnect) { await this.connect(); await this.refreshAccount(); } }
        if (msg.type === 'folder') await vscode.commands.executeCommand('workbench.action.files.openFolder');
        if (msg.type === 'changes') await vscode.commands.executeCommand('workbench.view.scm');
        if (msg.type === 'terminal') await vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal');
      } catch (e) { this.status = e.message; this.post(); if (["send", "enqueue"].includes(msg.type)) this.view?.webview.postMessage({ type: "sendRejected", projectKey: this.projectKey, clientSendId: msg.clientSendId }); }
    });
    this.post();
  }
  invalidateProject() {
    this.codePreviews?.clear();
    this.loginSession?.dispose(); this.loginPending = false;
    vscode.commands?.executeCommand?.('gptide.cancelInlineInput')?.catch(() => {});
    clearTimeout(this.queueTimer); this.queueDispatchToken = null;
    this.inlineCancellation?.cancel();
    for (const record of this.pendingRequests?.values() || []) { record.resolved = true; record.token.cancel(); }
    this.save(); this.invalidated = true; clearTimeout(this.postTimer); this.bridge?.dispose(); this.pendingBridge?.dispose();
    this.view?.webview.postMessage({ type: 'reset', projectKey: this.projectKey });
    this.messages = []; this.chats = []; this.tasks = []; this.changes = []; this.attachments = []; this.threadId = null;
  }
  dispose() { this.invalidateProject(); }
}
function activate(context) {
  require('./data-paths.cjs').initialize(context,path.resolve(context.extensionPath,'../../../../..'));
  require('./onboarding.cjs').run(vscode,context,path.resolve(context.extensionPath,'../../../../..')).catch(error=>vscode.window.showErrorMessage('首次导入未完成：'+error.message));
  const usageUI = require('./usage-ui.cjs').install(vscode, context, path.resolve(context.extensionPath, '../../../../..'));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.importVSCode', () => require('./vscode-import-ui.cjs').run(vscode, path.resolve(context.extensionPath, '../../../../..'), context.globalStorageUri).catch(e => vscode.window.showErrorMessage(e.message))));
  let chat;
  require('./commit-message.cjs').install(vscode,context,()=>chat);
  const settings = require("./settings-ui.cjs").install(vscode, context, path.resolve(context.extensionPath, "../../../../.."), () => chat);
  context.subscriptions.push(vscode.commands.registerCommand('gptide.homeOpenRecent', (uri, workspace, remoteAuthority) => vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.parse(uri), { forceNewWindow: false, ...(remoteAuthority ? { remoteAuthority } : {}) })));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.homeError', command => vscode.window.showErrorMessage('操作未完成：' + command)));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.homeSSH', async () => {
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes('opensshremotes.openEmptyWindow')) return vscode.commands.executeCommand('opensshremotes.openEmptyWindow');
    const action = await vscode.window.showInformationMessage('需要安装 Remote SSH 扩展', '查看扩展');
    if (action) return vscode.commands.executeCommand('workbench.extensions.search', 'Remote SSH');
  }));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.homeAccount', async () => {
    const account = require('./account.cjs'), info = account.localInfo();
    const item = await vscode.window.showQuickPick([{ label: '登录 / 切换 ChatGPT 账户', action: 'login' }, ...(account.canCancel(context, chat) ? [{ label: '取消等待登录', action: 'cancel' }] : [])], { title: info.label });
    if (item?.action === 'cancel') return account.cancel(context, chat).catch(error => vscode.window.showErrorMessage(error.message));
    if (item) return vscode.commands.executeCommand('gptide.accountLogin');
  }));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.accountInfo', () => require('./account.cjs').localInfo()));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.accountLogin', () => require('./account.cjs').login(vscode, context, chat).catch(e => vscode.window.showErrorMessage(e.message))));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { chat?.invalidateProject(); vscode.commands.executeCommand('workbench.action.reloadWindow'); }));
  if (vscode.workspace.workspaceFolders?.length !== 1) return;
  require('./open-changes.cjs').install(vscode,context);
  chat = new Chat(context); chat.usageSnapshot = usageUI.snapshot; context.subscriptions.push(usageUI.onChange(() => chat.post())); chat.settingsRefresh = settings.refresh; context.subscriptions.push(chat);
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration("gptide")) chat.post(); }));
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('gptide.chat', chat, { webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.open', () => chat.focusInput().catch(error => vscode.window.showErrorMessage(error.message))));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.exportChat', () => chat.exportChat().catch(e => vscode.window.showErrorMessage(e.message))));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.login', () => chat.login()));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.refresh', async () => { await chat.ready; if (chat.busy || chat.reviewBusy) return vscode.window.showInformationMessage('请先等待当前任务完成'); if (chat.storageBlocked) return vscode.commands.executeCommand('workbench.action.reloadWindow'); await chat.importCursor(true); if (!chat.select(chat.activeId) && !chat.select(chat.chats[0]?.id)) chat.newChat(); }));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('gptide-before', { provideTextDocumentContent: uri => chat.beforeContent(uri) }));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('gptide-code', { provideTextDocumentContent: uri => chat.codeContent(uri) }));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('gptide-checkpoint', { provideTextDocumentContent: uri => { const [owner, hash] = uri.path.split('/').filter(Boolean); if (owner !== chat.projectKey) throw new Error('检查点不属于当前项目'); if (hash === 'empty') return ''; if (!chat.checkpointStore) throw new Error('检查点存储不可用'); return chat.checkpointStore.get(hash); } }));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.cleanupCheckpoints', () => { try { chat.cleanupCheckpoints(); } catch (error) { vscode.window.showErrorMessage(error.message); } }));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.attachSelection', () => chat.attachFiles(true)));
  for (const [command, kind] of [['gptide.attachDiagnostics', 'diagnostics'], ['gptide.attachGitDiff', 'git'], ['gptide.attachFolder', 'folder']]) context.subscriptions.push(vscode.commands.registerCommand(command, uri => chat.attachContext(kind, uri).catch(e => vscode.window.showErrorMessage(e.message))));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.inlineEdit', () => chat.inlineEdit().catch(error => vscode.window.showErrorMessage(error.message))));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.newChat', async () => { await chat.ready; if (chat.actionLocked()) return vscode.window.showInformationMessage('请先完成当前任务或登录'); chat.newChat(); await chat.focusInput(); }));
  vscode.commands.executeCommand('gptide.chat.focus');
}
module.exports = { activate, Chat };
