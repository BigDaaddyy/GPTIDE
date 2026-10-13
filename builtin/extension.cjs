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
  constructor(context) {
    this.context = context; this.messages = []; this.chats = []; this.model = vscode.workspace.getConfiguration('gptide').get('model');
    this.preferences = preferences.values(vscode.workspace.getConfiguration('gptide'));
    this.status = '正在读取项目进度'; this.busy = false; this.attachments = []; this.effort = this.preferences.defaultEffort; this.mode = this.preferences.defaultMode; this.hiddenCursorIds = []; this.project = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.output = vscode.window.createOutputChannel('GptIDE'); context.subscriptions.push(this.output);
    const root = path.resolve(context.extensionPath, '../../../../..');
    this.root = root; this.data = path.join(root, 'data', 'projects'); fs.mkdirSync(this.data, { recursive: true });
    this.projectKey = this.project ? projectScope.key(this.project) : null;
    this.stateFile = this.projectKey ? path.join(this.data, this.projectKey + '.json') : null;
    try { this.drafts = new (require('./drafts.cjs').Drafts)(path.join(this.data, this.projectKey + '.drafts.json'), this.projectKey); if (this.drafts.recovered) this.draftWarning = '草稿已从备份恢复'; }
    catch (error) { this.draftWarning = '草稿保存不可用：' + error.message; }
    try { this.checkpointStore = new (require('./checkpoints.cjs').Checkpoints)(path.join(this.data, this.projectKey + '-checkpoints'), this.project, this.projectKey, this.preferences.reviewStorageLimitMb * 1024 * 1024); }
    catch (error) { this.reviewWarning = '检查点存储不可用：' + error.message; }
    this.loadingScope = true; this.quarantinedChats = []; this.openChatIds = []; this.chatAttachments = new Map();
    this.ready = this.load();
  }
  async load() {
    if (this.stateFile) {
      try { const result = storage.read(this.stateFile), state = result.state || {}; if ((state.projectKey && state.projectKey !== this.projectKey) || (state.projectPath && !projectScope.matches(state.projectPath, this.project))) throw new Error('历史文件的项目归属不匹配，已拒绝读取。'); this.quarantinedChats = state.quarantinedChats || []; this.storageRevision = result.revision; this.chats = state.chats || []; this.activeId = state.activeId; this.openChatIds = state.openChatIds || []; this.model = state.model || this.model; this.effort = state.effort || this.preferences.defaultEffort; this.mode = state.mode || this.preferences.defaultMode; this.hiddenCursorIds = state.hiddenCursorIds || []; if (result.recovered) this.historyWarning = '主历史损坏，已恢复上一份本地备份。'; } catch (e) { this.historyWarning = e.message; this.storageBlocked = true; this.output.appendLine('本地历史读取失败：' + e.message); }
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
    if (this.quarantinedChats.length) this.scopeWarning = `已隐藏 ${this.quarantinedChats.length} 条无法确认当前项目归属的记录。`;
    if (!this.activeId || !this.chats.some(c => c.id === this.activeId)) this.activeId = this.chats[0]?.id;
    this.openChatIds = this.openChatIds.filter(id => this.chats.some(c => c.id === id && c.projectKey === this.projectKey));
    if (this.activeId) this.select(this.activeId); else this.newChat();
    if (this.bridge) this.status = '项目进度已加载'; else if (!this.preferences.autoConnect) this.status = '未连接 · 发送时连接'; this.post();
  }
  async importCursor() {
    if (!this.project) return;
    try {
      const { stdout } = await exec(path.join(this.root, 'runtime', 'node.exe'), ['--disable-warning=ExperimentalWarning', path.join(this.root, 'tools', 'cursor-import.cjs'), this.project, vscode.workspace.getConfiguration('gptide').get('cursorUserPath') || ''], { windowsHide: true, maxBuffer: 100 * 1024 * 1024, timeout: 60000 });
      const result = JSON.parse(stdout); this.cursorCount = result.chats.length;
      if (this.invalidated) return;
      const native = this.chats.filter(c => c.source !== 'cursor'); this.chats = [...native, ...result.chats.filter(c => !this.hiddenCursorIds.includes(c.id)).map(c => ({ ...c, projectKey: this.projectKey }))];
      this.drafts?.apply(this.chats);
      this.importWarning = result.warnings.join('；');
    } catch (e) { this.importWarning = 'Cursor 历史未能读取：' + e.message; }
  }
  select(id) {
    if (this.busy || this.reviewBusy || this.invalidated) return false;
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
      const records = (chat.checkpoints || []).filter(c => c.projectKey === this.projectKey), record = records.find(c => c.id === chat.activeCheckpointId) || records.at(-1);
      if (record) { this.changes = this.checkpointStore.load(record); this.activeCheckpointId = record.id; chat.activeCheckpointId = record.id; }
      this.reviewWarning = undefined;
    } catch (error) { this.reviewWarning = '检查点未能读取或保存：' + error.message; }
  }
  selectCheckpoint(id) {
    if (this.busy || this.reviewBusy || this.invalidated) return;
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
  cleanupCheckpoints() {
    if (this.busy || this.reviewBusy || this.storageBlocked || !this.checkpointStore) return;
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
    if (this.busy || this.reviewBusy || this.invalidated) return;
    this.view?.webview.postMessage({ type: 'tabChangePending', projectKey: this.projectKey });
    const chat = { id: crypto.randomUUID(), projectKey: this.projectKey, source: 'gptide', name: '新对话', messages: [], tasks: [], changes: [], updatedAt: Date.now() };
    this.chats.unshift(chat); this.select(chat.id); this.save();
  }
  closeTab(id, draft) {
    if (this.busy || this.reviewBusy || !this.openChatIds.includes(id)) return;
    const chat = this.chats.find(c => c.id === id && c.projectKey === this.projectKey); if (chat && typeof draft === 'string') this.persistDraft(id, draft);
    const index = this.openChatIds.indexOf(id); this.openChatIds.splice(index, 1);
    if (this.activeId === id) { const next = this.openChatIds[Math.max(0, index - 1)]; if (next) this.select(next); else this.newChat(); }
    this.save(); this.post();
  }
  persistDraft(id, text) {
    if (this.invalidated || typeof text !== 'string') return false;
    const chat = this.chats.find(c => c.id === id && c.projectKey === this.projectKey); if (!chat) return false;
    chat.draft = text.slice(0, 100000); chat.draftUpdatedAt = Date.now();
    try { if (!this.drafts) throw new Error('草稿文件不可用'); this.drafts.set(id, chat.draft, chat.draftUpdatedAt); return true; }
    catch (error) { this.draftWarning = '草稿未保存：' + error.message; this.post(); return false; }
  }
  save() {
    if (this.invalidated || this.loadingScope) return false;
    if (!this.stateFile) return true;
    const state = { projectKey: this.projectKey, projectPath: this.project, quarantinedChats: this.quarantinedChats, openChatIds: this.openChatIds, activeId: this.activeId, model: this.model, effort: this.effort, mode: this.mode, hiddenCursorIds: this.hiddenCursorIds, chats: this.chats.filter(c => c.source !== 'cursor' && c.projectKey === this.projectKey) };
    try {
      if (this.storageBlocked) { if (this.conflictFile) storage.write(this.conflictFile, state); return false; }
      this.storageRevision = storage.write(this.stateFile, state, this.storageRevision); return true;
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
    const chat = this.loadingScope ? null : this.chats.find(c => c.id === this.activeId && c.projectKey === this.projectKey); const visible = this.loadingScope ? [] : this.chats.filter(c => c.projectKey === this.projectKey);
    this.view?.webview.postMessage({ type: 'state', projectKey: this.projectKey, project: this.project || '', status: this.status, warning: [this.historyWarning, this.scopeWarning, this.importWarning, this.draftWarning, this.reviewWarning].filter(Boolean).join('；'), busy: this.busy || this.loadingScope, loadingScope: this.loadingScope, reviewBusy: this.reviewBusy, checkpoints: this.loadingScope ? [] : (chat?.checkpoints || []).filter(c => c.projectKey === this.projectKey).map(c => ({ id: c.id, turn: c.turn, createdAt: c.createdAt, count: c.changes.length, limited: c.limited, legacy: c.legacy })), activeCheckpointId: this.activeCheckpointId, preferences: preferences.values(vscode.workspace.getConfiguration("gptide")), messages: this.loadingScope ? [] : this.messages, activeId: this.loadingScope ? null : this.activeId, source: chat?.source, draft: chat?.draft || '', draftUpdatedAt: chat?.draftUpdatedAt || 0, history: history.entries(visible, this.activeId), openChatIds: this.loadingScope ? [] : this.openChatIds, chats: visible.map(c => ({ id: c.id, name: c.name, source: c.source, updatedAt: c.updatedAt, count: c.messages.length })), models: this.models || [], model: this.model, effort: this.effort, mode: this.mode, tasks: this.loadingScope ? [] : this.tasks || [], attachments: this.attachments.map(({ id, label }) => ({ id, label })), changes: (this.changes || []).map(c => ({ path: c.path, relative: c.relative, status: c.status, added: c.added ?? (c.after || '').split('\n').length, removed: c.removed ?? (c.before || '').split('\n').length })), account: this.account, activity: this.activity || '', cursorCount: this.cursorCount || 0 });
  }
  async attachFiles(current = false) {
    await this.ready;
    if (!this.project || this.busy) return;
    const targetId = this.activeId;
    if (current) {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !review.within(this.project, editor.document.uri.fsPath)) throw new Error('请先打开本项目中的一个文件');
      const selected = !editor.selection.isEmpty;
      const attachment = { id: crypto.randomUUID(), path: editor.document.uri.fsPath, label: path.basename(editor.document.fileName) + (selected ? `:${editor.selection.start.line + 1}-${editor.selection.end.line + 1}` : ''), text: selected ? editor.document.getText(editor.selection) : editor.document.getText() };
      attachment.truncated = attachment.text.length > 100000; attachment.text = attachment.text.slice(0, 100000);
      this.attachments = this.attachments.filter(a => a.path !== attachment.path || a.label !== attachment.label);
      if (this.attachments.length >= 20) throw new Error('最多引用 20 项上下文');
      this.attachments.push(attachment);
    } else {
      const files = await vscode.workspace.findFiles('**/*', '**/{.git,node_modules,dist,build,.next,.venv}/**', 2000);
      const picked = await vscode.window.showQuickPick(files.map(uri => ({ label: vscode.workspace.asRelativePath(uri), uri })), { canPickMany: true, placeHolder: '搜索项目文件，作为上下文附到当前消息' });
      if (this.invalidated || this.activeId !== targetId) return;
      for (const item of (picked || []).slice(0, 20)) {
        if (this.attachments.length >= 20) { vscode.window.showInformationMessage('最多引用 20 项上下文'); break; }
        if (!review.within(this.project, item.uri.fsPath)) continue;
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
    const core = require('./context.cjs'), targetId = this.activeId; let text, label;
    if (kind === 'diagnostics') {
      text = core.diagnostics(this.project, vscode.languages.getDiagnostics()); label = '项目诊断';
      if (!text) return vscode.window.showInformationMessage('当前项目没有错误或警告');
    } else if (kind === 'git') {
      const selected = await vscode.window.showQuickPick(['未暂存差异', '暂存区差异'], { title: '引用 Git 差异' }); if (!selected) return;
      text = await core.gitDiff(this.project, selected === '暂存区差异'); label = selected;
      if (!text.trim()) return vscode.window.showInformationMessage('所选范围没有 Git 差异');
    } else if (kind === 'folder') {
      if (!folderUri) { const selected = await vscode.window.showOpenDialog({ defaultUri: vscode.Uri.file(this.project), canSelectFiles: false, canSelectFolders: true, canSelectMany: false }); folderUri = selected?.[0]; }
      if (!folderUri) return;
      if (folderUri.scheme !== 'file' || !review.within(this.project, folderUri.fsPath)) throw new Error('文件夹不属于当前项目');
      const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folderUri, '**/*'), '**/{.git,node_modules,dist,build,.next,.venv,__pycache__}/**', 200);
      const result = core.folderText(this.project, folderUri.fsPath, files.map(uri => uri.fsPath));
      if (!result.count) return vscode.window.showInformationMessage('文件夹没有可引用的文本文件');
      text = result.text; label = `${path.relative(this.project, folderUri.fsPath) || path.basename(this.project)}/ · ${result.count} 文件${result.limited ? '（部分）' : ''}`;
    } else return;
    if (this.invalidated || targetId !== this.activeId) return;
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
    if (this.busy || this.reviewBusy || this.inlineBusy || this.invalidated) return;
    if (this.storageBlocked) throw new Error(this.historyWarning);
    const metadata = this.changes?.find(c => c.path === file); if (!metadata || (redo ? metadata.status !== 'reverted' : !['pending', 'accepted'].includes(metadata.status)) || !review.within(this.project, file)) return;
    if (!vscode.workspace.isTrusted) throw new Error('请先信任项目以撤销文件修改');
    const change = this.checkpointStore ? this.checkpointStore.materialize(metadata) : metadata, expected = redo ? change.before : change.after, target = redo ? change.after : change.before;
    const sameFile = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() === path.resolve(file).toLowerCase() : path.resolve(value) === path.resolve(file);
    if (review.readText(file) !== expected || vscode.workspace.textDocuments.some(d => d.uri.scheme === 'file' && sameFile(d.uri.fsPath) && d.isDirty)) throw new Error('文件已有后续修改或未保存编辑，无法安全恢复。请先查看差异。');
    this.reviewBusy = true; this.post();
    try {
      const uri = vscode.Uri.file(file);
      if (target === null) await vscode.workspace.fs.delete(uri, { recursive: false });
      else await vscode.workspace.fs.writeFile(uri, Buffer.from(target, 'utf8'));
      if (review.readText(file) !== target) throw new Error('恢复结果与检查点不一致，请检查文件');
      this.changeStatus(metadata, redo ? 'pending' : 'reverted'); this.save();
    } finally { this.reviewBusy = false; this.post(); }
  }
  async renameChat() {
    const chat = this.chats.find(c => c.id === this.activeId); if (!chat || chat.source === 'cursor' || this.busy) return;
    const name = await vscode.window.showInputBox({ prompt: '对话名称', value: chat.name, validateInput: s => s.trim() ? null : '名称不能为空' });
    if (name) { chat.name = name.trim(); this.save(); this.post(); }
  }
  async inlineEdit() {
    await this.ready;
    if (this.busy || this.reviewBusy || this.inlineBusy) throw new Error('请等待当前任务完成后再改写选区。');
    const editor = vscode.window.activeTextEditor, document = editor?.document;
    if (!this.project || !document || document.uri.scheme !== 'file' || !review.within(this.project, document.uri.fsPath)) throw new Error('请先打开本项目中的代码文件。');
    if (!vscode.workspace.isTrusted) throw new Error('请先信任此项目，再使用 Ctrl+K 改写。');
    const range = new vscode.Range(editor.selection.start, editor.selection.end);
    const snapshot = { file: document.uri.fsPath, language: document.languageId, version: document.version, text: document.getText(), start: document.offsetAt(range.start), end: document.offsetAt(range.end), eol: document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n' };
    const instruction = await vscode.window.showInputBox({ title: 'GptIDE · Ctrl+K 改写代码', prompt: editor.selection.isEmpty ? '描述要在光标处生成的代码' : '描述要如何修改选中的代码', placeHolder: '例如：转换为 async 函数，保持现有行为', ignoreFocusOut: true, validateInput: value => !value.trim() ? '请输入修改要求' : value.length > 4000 ? '修改要求过长' : null });
    if (!instruction) return;
    if (this.busy || this.inlineBusy) throw new Error('已有任务开始，请等待完成。');
    this.inlineBusy = true;
    try {
      const replacement = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'GptIDE 正在改写选区', cancellable: true }, (_, token) => inlineAgent.generate({ executable: findCodex(vscode.workspace.getConfiguration('gptide').get('codexPath')), cwd: this.project, model: this.model, effort: this.effort, snapshot, instruction, token }));
      if (this.invalidated) throw new Error('项目已切换，已放弃改写。');
      const current = () => ({ text: document.getText(), version: document.version });
      if (!inlineCore.unchanged(snapshot, current())) throw new Error('代码在生成期间发生变化，已放弃应用，避免覆盖你的修改。');
      const proposed = inlineCore.proposal(snapshot, replacement);
      if (proposed.text === snapshot.text) { vscode.window.showInformationMessage('模型未提出代码变化。'); return; }
      const id = crypto.randomUUID(); this.contextBefore ||= new Map(); this.contextBefore.set(id + '-before', snapshot.text); this.contextBefore.set(id + '-after', proposed.text);
      const before = vscode.Uri.parse('gptide-before:/' + id + '-before'), after = vscode.Uri.parse('gptide-before:/' + id + '-after');
      await vscode.languages.setTextDocumentLanguage(await vscode.workspace.openTextDocument(before), document.languageId);
      await vscode.languages.setTextDocumentLanguage(await vscode.workspace.openTextDocument(after), document.languageId);
      await vscode.commands.executeCommand('vscode.diff', before, after, `${path.basename(document.fileName)} · Ctrl+K 修改预览`);
      const answer = await vscode.window.showInformationMessage('检查差异后选择是否应用到原文件。', '应用修改', '放弃');
      if (answer !== '应用修改') return;
      if (this.invalidated) throw new Error('项目已切换，已拒绝应用。');
      if (!inlineCore.unchanged(snapshot, current())) throw new Error('原文件已有后续修改，无法安全应用。请重新生成。');
      const edit = new vscode.WorkspaceEdit(); edit.replace(document.uri, range, proposed.replacement);
      if (!await vscode.workspace.applyEdit(edit)) throw new Error('应用修改失败。');
      await vscode.window.showTextDocument(document); vscode.window.showInformationMessage('已应用选区修改。Ctrl+Z 可撤销；保存文件由你决定。');
    } finally { this.inlineBusy = false; }
  }
  async deleteChat() {
    const chat = this.chats.find(c => c.id === this.activeId); if (!chat || this.busy) return;
    const answer = await vscode.window.showWarningMessage(chat.source === 'cursor' ? '从 GptIDE 隐藏此对话？Cursor 原记录会保留。' : '删除本地对话记录？', { modal: true }, '确认');
    if (!answer) return;
    if (chat.source === 'cursor') this.hiddenCursorIds.push(chat.id);
    this.chats = this.chats.filter(c => c.id !== chat.id); this.openChatIds = this.openChatIds.filter(id => id !== chat.id);
    const next = this.openChatIds[0] || this.chats[0]?.id; if (next) this.select(next); else this.newChat(); this.save();
  }
  async connect() {
    if (this.invalidated) throw new Error('项目已切换');
    if (this.bridge) return this.bridge;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const bridge = new Bridge(findCodex(vscode.workspace.getConfiguration('gptide').get('codexPath')), this.project || this.root, { timeout: preferences.values(vscode.workspace.getConfiguration('gptide')).rpcTimeout });
      this.pendingBridge = bridge;
      bridge.on('notification', event => this.onNotification(event));
      bridge.on('request', request => this.approve(request));
      bridge.on('disconnected', e => { if (this.bridge === bridge) { this.bridge = null; this.resumed = false; this.busy = false; this.status = e.message; this.post(); } });
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
    const result = await this.bridge.call('account/read', { refreshToken: false });
    this.account = result.account ? { type: result.account.type, plan: result.account.planType } : null;
    if (this.account && !['chatgpt', 'chatgptAuthTokens'].includes(this.account.type)) { this.status = '请使用 ChatGPT 登录；此软件不使用 API Key'; this.models = []; this.post(); return; }
    const models = await this.bridge.call('model/list', { limit: 50, includeHidden: false });
    this.models = models.data || [];
    if (this.models.length && !this.models.some(m => m.model === this.model)) this.model = this.models.find(m => m.model === 'gpt-6.1-sol')?.model || this.models.find(m => m.isDefault)?.model || this.models[0].model;
    const current = this.models.find(m => m.model === this.model);
    if (!current?.supportedReasoningEfforts?.some(e => e.reasoningEffort === this.effort)) this.effort = current?.defaultReasoningEffort || 'medium';
    this.status = this.account ? `ChatGPT ${(this.account.plan || '').toUpperCase()} 已连接` : '请使用 ChatGPT 登录'; this.post();
  }
  async login() { await this.ready; const bridge = await this.connect(); const result = await bridge.call('account/login/start', { type: 'chatgpt' }); if (result.authUrl) await vscode.env.openExternal(vscode.Uri.parse(result.authUrl)); this.status = '请在浏览器完成 ChatGPT 登录'; this.post(); }
  async send(text, mode, attach) {
    await this.ready;
    if (this.invalidated) throw new Error('项目已切换。');
    if (this.storageBlocked) throw new Error(this.historyWarning);
    if (this.reviewBusy) throw new Error('请等待文件恢复完成');
    if (this.inlineBusy) throw new Error('请先完成或放弃 Ctrl+K 修改预览。');
    if (this.busy || typeof text !== 'string' || !text.trim()) return;
    if (!['ask', 'agent', 'plan'].includes(mode)) throw new Error('未知工作模式');
    if (!this.project) throw new Error('请先打开项目文件夹');
    const submittedChatId = this.activeId, submittedDraftText = this.chats.find(c => c.id === submittedChatId)?.draft || '';
    if (mode === 'agent' && !vscode.workspace.isTrusted) throw new Error('请先在 VS Code 的工作区信任中信任此项目，或使用 Ask / Plan 只读模式');
    this.busy = true; this.cancelPendingSend = false; this.status = '正在准备'; this.post();
    let bridge;
    try {
      bridge = await this.connect();
      if (this.invalidated || submittedChatId !== this.activeId) throw new Error('项目或对话已切换，已取消发送');
      if (this.cancelPendingSend) throw new Error('已取消发送');
      if (!this.account || !['chatgpt', 'chatgptAuthTokens'].includes(this.account.type)) throw new Error('请先使用 ChatGPT 账号登录');
    } catch (error) { this.busy = false; const failure = this.cancelPendingSend ? new Error('已取消发送') : error; this.status = failure.message; this.post(); throw failure; }
    this.mode = mode; this.busy = true; this.status = '正在思考'; this.activity = ''; this.post();
    try {
      let importedContext = '';
      const selected = this.chats.find(c => c.id === this.activeId);
      if (!selected || selected.source === 'cursor') {
        if (selected) {
          const transcript = selected.messages.map(m => `[${m.role}]\n${m.text}`).join('\n\n');
          const importLimit = preferences.values(vscode.workspace.getConfiguration('gptide')).importLimit;
          if (transcript.length > importLimit) {
            this.busy = false; this.post();
            const answer = await vscode.window.showWarningMessage(`这段 Cursor 历史较长。继续时将发送最近 ${importLimit.toLocaleString()} 字符作为背景，完整记录仍可查看。`, { modal: true }, '继续');
            if (!answer) return; this.busy = true;
          }
          importedContext = '以下是从 Cursor 导入的历史对话，仅作为项目背景。请以用户当前请求为准。\n' + transcript.slice(-importLimit) + '\n\n当前请求：\n';
        }
        const chat = { id: crypto.randomUUID(), projectKey: this.projectKey, source: 'gptide', name: text.slice(0, 40), draft: selected?.draft || '', draftUpdatedAt: selected?.draftUpdatedAt || 0, messages: selected ? selected.messages.map(m => ({ ...m })) : [], updatedAt: Date.now() };
        this.chats.unshift(chat); if (!this.openChatIds.includes(chat.id)) this.openChatIds.push(chat.id); this.activeId = chat.id; this.messages = chat.messages; this.threadId = null; this.resumed = false;
      }
      const named = this.chats.find(c => c.id === this.activeId); if (named?.name === '新对话' && !named.messages.length) named.name = text.slice(0, 40);
      if (!this.resumed) {
        if (this.threadId) { const previous = await bridge.call('thread/read', { threadId: this.threadId, includeTurns: false }); if (!projectScope.matches(previous.thread?.cwd, this.project)) throw new Error('对话不属于当前项目，已拒绝继续。'); }
        const params = { cwd: this.project, model: this.model, approvalPolicy: preferences.values(vscode.workspace.getConfiguration('gptide')).approvalPolicy, sandbox: mode === 'agent' ? 'workspace-write' : 'read-only' };
        const result = await bridge.call(this.threadId ? 'thread/resume' : 'thread/start', this.threadId ? { ...params, threadId: this.threadId } : params);
        this.threadId = result.thread.id; this.resumed = true;
        this.chats.find(c => c.id === this.activeId).threadId = this.threadId;
      }
      let editorContext = '';
      if (attach && vscode.window.activeTextEditor && review.within(this.project, vscode.window.activeTextEditor.document.uri.fsPath)) {
        const editor = vscode.window.activeTextEditor;
        const content = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
        editorContext = `\n\n当前编辑器文件：${editor.document.uri.fsPath}\n${content.slice(0, 50000)}`;
      }
      const labels = this.attachments.map(a => a.label); let budget = 100000;
      for (const attachment of this.attachments) { if (budget <= 0) break; const snippet = attachment.text.slice(0, Math.min(50000, budget)); budget -= snippet.length; editorContext += `\n\n引用${attachment.kind ? '上下文' : '文件'}：${attachment.kind ? attachment.label : attachment.path}\n${snippet}`; }
      if (this.attachments.some(a => a.truncated || a.text.length > 50000) || budget <= 0) this.importWarning = '引用上下文最多附上约 10 万字符，长内容已截断。';
      this.baseline = mode === 'agent' ? review.snapshot(this.project) : null; this.candidates = new Map();
      const active = this.chats.find(c => c.id === this.activeId); active.tasks ||= []; this.tasks = active.tasks; active.taskTurn = (active.taskTurn || 0) + 1; this.currentTaskTurn = active.taskTurn;
      if (this.baseline?.limited) this.importWarning = '项目较大，修改预览只覆盖已采集的文本文件。';
      this.messages.push({ role: 'user', text, attachments: labels, mode, model: this.model }); if (!this.save()) throw new Error(this.historyWarning); this.post();
      const instruction = mode === 'plan' ? '请先调查项目并给出具体实施计划、涉及文件和验证步骤。本轮只做计划，不修改文件。\n\n' : '';
      const result = await bridge.call('turn/start', { threadId: this.threadId, model: this.model, effort: this.effort, approvalPolicy: preferences.values(vscode.workspace.getConfiguration('gptide')).approvalPolicy, input: [{ type: 'text', text: instruction + importedContext + text + editorContext }], sandboxPolicy: mode !== 'agent' ? { type: 'readOnly' } : { type: 'workspaceWrite', writableRoots: [this.project], networkAccess: preferences.values(vscode.workspace.getConfiguration('gptide')).networkAccess, excludeTmpdirEnvVar: false, excludeSlashTmp: false } });
      if (this.busy) this.turnId = result.turn.id;
      if (this.cancelPendingSend && this.busy) await bridge.call('turn/interrupt', { threadId: this.threadId, turnId: result.turn.id });
      for (const id of new Set([submittedChatId, this.activeId])) { const chat = this.chats.find(c => c.id === id); if (chat?.draft === submittedDraftText) this.persistDraft(id, ''); }
      this.attachments = []; this.view?.webview.postMessage({ type: 'sent', projectKey: this.projectKey }); this.post();
    } catch (e) { this.busy = false; this.status = e.message; this.post(); throw e; }
  }
  async approve(request) {
    let result;
    if (request.method === 'item/commandExecution/requestApproval' || request.method === 'item/fileChange/requestApproval') {
      const label = request.params?.command || request.params?.reason || '修改项目文件';
      const answer = await vscode.window.showWarningMessage(`AI 请求授权：${label}`, { modal: true }, '允许此次');
      result = { decision: answer ? 'accept' : 'decline' };
    } else { this.bridge.send({ id: request.id, error: { code: -32601, message: 'GptIDE 尚不支持此授权请求' } }); return; }
    this.bridge.reply(request.id, result);
  }
  onNotification({ method, params: p }) {
    if (this.invalidated) return;
    if (method === 'account/rateLimits/updated') { require('./usage.cjs').save(this.root, p).catch(() => {}); return; }
    if (method === 'account/login/completed' && p.success) { this.refreshAccount().catch(e => { this.status = e.message; this.post(); }); return; }
    if (p?.threadId && p.threadId !== this.threadId) return;
    if (method === 'turn/started' && p?.turn?.id) this.turnId = p.turn.id;
    if (p && tasklog.update(this.tasks || (this.tasks = []), method, p, this.currentTaskTurn)) {
      if (method.endsWith('/outputDelta')) { if (!this.postTimer) this.postTimer = setTimeout(() => this.post(), 60); }
      else { if (method === 'item/completed') this.save(); this.post(); }
    }
    if (method === 'item/agentMessage/delta') {
      let item = this.messages.find(m => m.itemId === p.itemId);
      if (!item) { item = { role: 'assistant', text: '', itemId: p.itemId }; this.messages.push(item); }
      item.text += p.delta; this.post();
    }
    if (method === 'item/started') { this.activity = p.item?.type === 'commandExecution' ? '运行：' + p.item.command : p.item?.type === 'fileChange' ? '正在修改文件' : '正在处理项目'; this.post(); }
    if (method === 'item/completed' && p.item?.type === 'fileChange' && this.candidates) {
      for (const change of p.item.changes || []) { this.candidates.set(change.path, change.kind?.type || 'update'); const moved = change.kind?.move_path || change.kind?.movePath; if (moved) this.candidates.set(moved, 'add'); }
    }
    if (method === 'item/completed' && p.item?.type === 'agentMessage') {
      let item = this.messages.find(m => m.itemId === p.item.id);
      if (!item) { item = { role: 'assistant', text: '', itemId: p.item.id }; this.messages.push(item); }
      if (p.item.text) item.text = p.item.text; this.post();
    }
    if (method === 'turn/completed') {
      tasklog.finish(this.tasks || [], p.turn.id, p.turn.status);
      this.busy = false; this.turnId = null; this.status = p.turn?.status === 'failed' ? p.turn.error?.message || '请求失败' : p.turn?.status === 'interrupted' ? '已停止' : '完成'; this.activity = '';
      const chat = this.chats.find(c => c.id === this.activeId);
      if (this.baseline) {
        try { this.changes = review.collectChanges(this.project, this.baseline, this.candidates); if (chat) { this.changes.limited = !!(this.baseline.limited || this.changes.limited); chat.changes = this.changes; chat.pendingCheckpointTurn = this.currentTaskTurn; if (this.changes.limited) this.importWarning = '此轮检查点只覆盖已采集的文本文件'; this.prepareReview(chat, false); } } catch (e) { this.importWarning = '修改预览读取失败：' + e.message; }
        this.baseline = null;
      }
      if (chat) chat.updatedAt = Date.now();
      this.save(); this.post();
    }
    if (method === 'error') { this.status = p.error?.message || '模型请求失败'; if (!p.willRetry) this.busy = false; this.save(); this.post(); }
  }
  resolveWebviewView(view) {
    this.view = view; view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.file(this.context.extensionPath)] };
    const nonce = crypto.randomBytes(20).toString('hex');
    const source = name => fs.readFileSync(path.join(this.context.extensionPath, name), 'utf8');
    view.webview.html = source('view.html').replace('__STYLE__', () => source('view.css')).replace('__MARKDOWN__', () => source('markdown.cjs')).replace('__FIND__', () => source('find.cjs')).replace('__SCRIPT__', () => source('view.js')).replaceAll('__NONCE__', nonce).replaceAll('__PROJECT_KEY__', this.projectKey);
    view.webview.onDidReceiveMessage(async msg => {
      if (this.invalidated || msg.projectKey !== this.projectKey) return;
      if (msg.type !== 'ready') { await this.ready; if (this.invalidated) return; }
      try {
        if (msg.type === 'ready') this.post();
        if (msg.type === 'draft') { const saved = this.persistDraft(msg.id, msg.text); this.view?.webview.postMessage({ type: 'draftSaved', projectKey: this.projectKey, id: msg.id, sequence: msg.sequence, saved, history: history.entries(this.chats.filter(c => c.projectKey === this.projectKey), this.activeId) }); }
        if (msg.type === 'login') await this.login();
        if (msg.type === 'send') await this.send(msg.text, msg.mode, msg.attach);
        if (msg.type === 'stop' && this.busy) { this.cancelPendingSend = true; this.status = '正在停止'; this.post(); if (this.turnId && this.bridge) await this.bridge.call('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }); else if (!this.bridge) this.pendingBridge?.dispose(); }
        if (msg.type === 'select') { if (!this.busy && this.select(msg.id)) this.save(); else { this.view?.webview.postMessage({ type: 'tabChangeRejected', projectKey: this.projectKey }); this.post(); } }
        if (msg.type === 'new') { if (!this.busy) this.newChat(); else this.post(); }
        if (msg.type === 'closeTab' && !this.busy) this.closeTab(msg.id, msg.draft);
        if (msg.type === 'model' && !this.busy && this.models.some(m => m.model === msg.value)) { this.model = msg.value; const model = this.models.find(m => m.model === msg.value); if (!model.supportedReasoningEfforts.some(e => e.reasoningEffort === this.effort)) this.effort = model.defaultReasoningEffort; this.save(); this.post(); }
        if (msg.type === 'effort' && !this.busy && this.models.find(m => m.model === this.model)?.supportedReasoningEfforts?.some(e => e.reasoningEffort === msg.value)) { this.effort = msg.value; this.save(); this.post(); }
        if (msg.type === 'attach') await this.attachFiles();
        if (msg.type === 'attachCurrent') await this.attachFiles(true);
        if (msg.type === 'attachDiagnostics') await this.attachContext('diagnostics');
        if (msg.type === 'attachGitDiff') await this.attachContext('git');
        if (msg.type === 'attachFolder') await this.attachContext('folder');
        if (msg.type === 'removeAttachment') { this.attachments = this.attachments.filter(a => a.id !== msg.id); this.post(); }
        if (msg.type === 'rename') await this.renameChat();
        if (msg.type === 'delete') await this.deleteChat();
        if (msg.type === 'diff') await this.showDiff(msg.path);
        if (msg.type === 'diffCurrent') await this.showCurrentDiff(msg.path);
        if (msg.type === 'checkpoint') this.selectCheckpoint(msg.id);
        if (msg.type === 'cleanupCheckpoints') this.cleanupCheckpoints();
        if (msg.type === 'openFile' && typeof msg.path === 'string' && this.project && this.tasks?.some(task => task.files?.includes(msg.path))) { const file = path.resolve(this.project, msg.path); if (review.within(this.project, file) && fs.existsSync(file) && fs.statSync(file).isFile()) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(file))); }
        if (msg.type === 'revert') await this.revert(msg.path);
        if (msg.type === 'redo') await this.revert(msg.path, true);
        if (msg.type === 'accept' && !this.busy && !this.reviewBusy) { const change = this.changes.find(c => c.path === msg.path); if (change) { this.changeStatus(change, 'accepted'); this.save(); this.post(); } }
        if (msg.type === 'copy' && typeof msg.text === 'string') await vscode.env.clipboard.writeText(msg.text);
        if (msg.type === 'openLink' && /^https?:\/\//i.test(msg.url)) await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        if (msg.type === 'settings') await vscode.commands.executeCommand('gptide.settings');
        if (msg.type === 'usage') await vscode.commands.executeCommand('gptide.usage');
        if (msg.type === 'export') await this.exportChat();
        if (msg.type === 'copyTasks' && Array.isArray(msg.ids)) { const ids = new Set(msg.ids.filter(id => typeof id === 'string').slice(0, 200)), selected = (this.tasks || []).filter(t => ids.has(t.turnId + ':' + t.id)); await vscode.env.clipboard.writeText(require('./conversation.cjs').taskReport(selected)); }
        if (msg.type === 'refresh' && !this.busy && !this.reviewBusy) { if (this.conflictFile) { await vscode.commands.executeCommand('workbench.action.reloadWindow'); return; } await this.importCursor(); if (!this.select(this.activeId) && !this.select(this.chats[0]?.id)) this.newChat(); if (preferences.values(vscode.workspace.getConfiguration('gptide')).autoConnect) { await this.connect(); await this.refreshAccount(); } }
        if (msg.type === 'folder') await vscode.commands.executeCommand('workbench.action.files.openFolder');
        if (msg.type === 'changes') await vscode.commands.executeCommand('workbench.view.scm');
        if (msg.type === 'terminal') await vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal');
      } catch (e) { this.status = e.message; this.post(); }
    });
    this.post();
  }
  invalidateProject() {
    this.save(); this.invalidated = true; clearTimeout(this.postTimer); this.bridge?.dispose(); this.pendingBridge?.dispose();
    this.view?.webview.postMessage({ type: 'reset', projectKey: this.projectKey });
    this.messages = []; this.chats = []; this.tasks = []; this.changes = []; this.attachments = []; this.threadId = null;
  }
  dispose() { clearTimeout(this.postTimer); this.save(); this.bridge?.dispose(); this.pendingBridge?.dispose(); }
}
function activate(context) {
  require('./usage-ui.cjs').install(vscode, context, path.resolve(context.extensionPath, '../../../../..'));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.importVSCode', () => require('./vscode-import-ui.cjs').run(vscode, path.resolve(context.extensionPath, '../../../../..')).catch(e => vscode.window.showErrorMessage(e.message))));
  let chat;
  require("./settings-ui.cjs").install(vscode, context, path.resolve(context.extensionPath, "../../../../.."), () => chat);
  context.subscriptions.push(vscode.commands.registerCommand('gptide.homeOpenRecent', (uri, workspace, remoteAuthority) => vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.parse(uri), { forceNewWindow: false, ...(remoteAuthority ? { remoteAuthority } : {}) })));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.homeError', command => vscode.window.showErrorMessage('操作未完成：' + command)));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.homeSSH', async () => {
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes('opensshremotes.openEmptyWindow')) return vscode.commands.executeCommand('opensshremotes.openEmptyWindow');
    const action = await vscode.window.showInformationMessage('需要安装 Remote SSH 扩展', '查看扩展');
    if (action) return vscode.commands.executeCommand('workbench.extensions.search', 'Remote SSH');
  }));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.homeAccount', async () => {
    const info = require('./account.cjs').localInfo();
    const item = await vscode.window.showQuickPick([{ label: '登录 / 切换 ChatGPT 账户' }], { title: info.label });
    if (item) return vscode.commands.executeCommand('gptide.accountLogin');
  }));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.accountInfo', () => require('./account.cjs').localInfo()));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.accountLogin', () => require('./account.cjs').login(vscode, context, chat).catch(e => vscode.window.showErrorMessage(e.message))));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { chat?.invalidateProject(); vscode.commands.executeCommand('workbench.action.reloadWindow'); }));
  if (vscode.workspace.workspaceFolders?.length !== 1) return;
  chat = new Chat(context); context.subscriptions.push(chat);
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration("gptide")) chat.post(); }));
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('gptide.chat', chat, { webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.open', () => vscode.commands.executeCommand('gptide.chat.focus')));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.exportChat', () => chat.exportChat().catch(e => vscode.window.showErrorMessage(e.message))));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.login', () => chat.login()));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.refresh', async () => { await chat.ready; if (chat.busy || chat.reviewBusy) return vscode.window.showInformationMessage('请先等待当前任务完成'); await chat.importCursor(); if (!chat.select(chat.activeId) && !chat.select(chat.chats[0]?.id)) chat.newChat(); }));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('gptide-before', { provideTextDocumentContent: uri => chat.contextBefore?.get(uri.path.slice(1)) || '' }));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('gptide-checkpoint', { provideTextDocumentContent: uri => { const [owner, hash] = uri.path.split('/').filter(Boolean); if (owner !== chat.projectKey) throw new Error('检查点不属于当前项目'); if (hash === 'empty') return ''; if (!chat.checkpointStore) throw new Error('检查点存储不可用'); return chat.checkpointStore.get(hash); } }));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.cleanupCheckpoints', () => { try { chat.cleanupCheckpoints(); } catch (error) { vscode.window.showErrorMessage(error.message); } }));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.attachSelection', () => chat.attachFiles(true)));
  for (const [command, kind] of [['gptide.attachDiagnostics', 'diagnostics'], ['gptide.attachGitDiff', 'git'], ['gptide.attachFolder', 'folder']]) context.subscriptions.push(vscode.commands.registerCommand(command, uri => chat.attachContext(kind, uri).catch(e => vscode.window.showErrorMessage(e.message))));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.inlineEdit', () => chat.inlineEdit().catch(error => vscode.window.showErrorMessage(error.message))));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.newChat', async () => { await chat.ready; if (!chat.busy) { chat.newChat(); vscode.commands.executeCommand('gptide.chat.focus'); } }));
  vscode.commands.executeCommand('gptide.chat.focus');
}
module.exports = { activate, Chat };
