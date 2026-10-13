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
const exec = promisify(execFile);

class Chat {
  constructor(context) {
    this.context = context; this.messages = []; this.chats = []; this.model = vscode.workspace.getConfiguration('gptide').get('model');
    this.status = '正在读取项目进度'; this.busy = false; this.attachments = []; this.effort = 'medium'; this.mode = 'agent'; this.hiddenCursorIds = []; this.project = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.output = vscode.window.createOutputChannel('GptIDE'); context.subscriptions.push(this.output);
    const root = path.resolve(context.extensionPath, '../../../../..');
    this.root = root; this.data = path.join(root, 'data', 'projects'); fs.mkdirSync(this.data, { recursive: true });
    this.stateFile = this.project ? path.join(this.data, crypto.createHash('sha256').update(this.project.toLowerCase()).digest('hex') + '.json') : null;
    this.ready = this.load();
  }
  async load() {
    if (this.stateFile) {
      try { const result = storage.read(this.stateFile), state = result.state || {}; this.storageRevision = result.revision; this.chats = state.chats || []; this.activeId = state.activeId; this.model = state.model || this.model; this.effort = state.effort || 'medium'; this.mode = state.mode || 'agent'; this.hiddenCursorIds = state.hiddenCursorIds || []; if (result.recovered) this.historyWarning = '主历史损坏，已恢复上一份本地备份。'; } catch (e) { this.historyWarning = e.message; this.storageBlocked = true; this.output.appendLine('本地历史读取失败：' + e.message); }
    }
    await this.importCursor();
    if (!this.activeId || !this.chats.some(c => c.id === this.activeId)) this.activeId = this.chats[0]?.id;
    this.select(this.activeId);
    this.status = this.project ? '项目进度已加载' : '请从「文件 → 打开文件夹」选择项目'; this.post();
    try { await this.connect(); } catch (e) { this.status = '连接失败：' + e.message; this.post(); }
  }
  async importCursor() {
    if (!this.project) return;
    try {
      const { stdout } = await exec(path.join(this.root, 'runtime', 'node.exe'), ['--disable-warning=ExperimentalWarning', path.join(this.root, 'tools', 'cursor-import.cjs'), this.project, vscode.workspace.getConfiguration('gptide').get('cursorUserPath') || ''], { windowsHide: true, maxBuffer: 100 * 1024 * 1024, timeout: 60000 });
      const result = JSON.parse(stdout); this.cursorCount = result.chats.length;
      const native = this.chats.filter(c => c.source !== 'cursor'); this.chats = [...native, ...result.chats.filter(c => !this.hiddenCursorIds.includes(c.id))];
      this.importWarning = result.warnings.join('；');
    } catch (e) { this.importWarning = 'Cursor 历史未能读取：' + e.message; }
  }
  select(id) { this.activeId = id; const chat = this.chats.find(c => c.id === id); this.messages = chat?.messages || []; this.changes = chat?.changes || []; this.tasks = chat?.tasks || []; this.currentTaskTurn = chat?.taskTurn || 0; this.threadId = chat?.threadId; this.resumed = false; this.post(); }
  save() {
    if (!this.stateFile) return true;
    const state = { activeId: this.activeId, model: this.model, effort: this.effort, mode: this.mode, hiddenCursorIds: this.hiddenCursorIds, chats: this.chats.filter(c => c.source !== 'cursor') };
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
    clearTimeout(this.postTimer); this.postTimer = null;
    const chat = this.chats.find(c => c.id === this.activeId);
    this.view?.webview.postMessage({ type: 'state', project: this.project || '', status: this.status, warning: [this.historyWarning, this.importWarning].filter(Boolean).join('；'), busy: this.busy, messages: this.messages, activeId: this.activeId, source: chat?.source, chats: this.chats.map(c => ({ id: c.id, name: c.name, source: c.source, updatedAt: c.updatedAt, count: c.messages.length })), models: this.models || [], model: this.model, effort: this.effort, mode: this.mode, tasks: this.tasks || [], attachments: this.attachments.map(({ id, label }) => ({ id, label })), changes: (this.changes || []).map(c => ({ path: c.path, relative: c.relative, status: c.status, added: (c.after || '').split('\n').length, removed: (c.before || '').split('\n').length })), account: this.account, activity: this.activity || '', cursorCount: this.cursorCount || 0 });
  }
  async attachFiles(current = false) {
    if (!this.project || this.busy) return;
    if (current) {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !review.within(this.project, editor.document.uri.fsPath)) throw new Error('请先打开本项目中的一个文件');
      const selected = !editor.selection.isEmpty;
      const attachment = { id: crypto.randomUUID(), path: editor.document.uri.fsPath, label: path.basename(editor.document.fileName) + (selected ? `:${editor.selection.start.line + 1}-${editor.selection.end.line + 1}` : ''), text: selected ? editor.document.getText(editor.selection) : editor.document.getText() };
      this.attachments.push(attachment);
    } else {
      const files = await vscode.workspace.findFiles('**/*', '**/{.git,node_modules,dist,build,.next,.venv}/**', 2000);
      const picked = await vscode.window.showQuickPick(files.map(uri => ({ label: vscode.workspace.asRelativePath(uri), uri })), { canPickMany: true, placeHolder: '搜索项目文件，作为上下文附到当前消息' });
      for (const item of picked || []) {
        if (!review.within(this.project, item.uri.fsPath)) continue;
        const text = review.readText(item.uri.fsPath);
        if (text === undefined || text === null) { vscode.window.showInformationMessage(`${item.label} 不是可读取的小型文本文件`); continue; }
        if (!this.attachments.some(a => a.path === item.uri.fsPath)) this.attachments.push({ id: crypto.randomUUID(), path: item.uri.fsPath, label: item.label, text });
      }
    }
    this.post();
  }
  async showDiff(file) {
    const change = this.changes?.find(c => c.path === file); if (!change || !review.within(this.project, file)) return;
    const id = crypto.randomUUID(); this.contextBefore ||= new Map(); this.contextBefore.set(id, change.before || '');
    if (change.after === null) this.contextBefore.set(id + '-after', '');
    await vscode.commands.executeCommand('vscode.diff', vscode.Uri.parse('gptide-before:/' + id), change.after === null ? vscode.Uri.parse('gptide-before:/' + id + '-after') : vscode.Uri.file(file), `${change.relative} · 修改前 ↔ 当前`);
  }
  async revert(file) {
    if (this.busy) return;
    const change = this.changes?.find(c => c.path === file); if (!change || change.status !== 'pending' || !review.within(this.project, file)) return;
    if (!vscode.workspace.isTrusted) throw new Error('请先信任项目以撤销文件修改');
    if (!review.canRevert(change) || vscode.workspace.textDocuments.some(d => d.uri.fsPath === file && d.isDirty)) throw new Error('文件已有后续修改或未保存编辑，无法安全撤销。请先查看差异。');
    const edit = new vscode.WorkspaceEdit(); const uri = vscode.Uri.file(file);
    if (change.before === null) edit.deleteFile(uri);
    else if (change.after === null) { edit.createFile(uri); edit.insert(uri, new vscode.Position(0, 0), change.before); }
    else { const document = await vscode.workspace.openTextDocument(uri); edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), change.before); }
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('撤销失败');
    if (change.before !== null) await (await vscode.workspace.openTextDocument(uri)).save();
    change.status = 'reverted'; this.save(); this.post();
  }
  async renameChat() {
    const chat = this.chats.find(c => c.id === this.activeId); if (!chat || chat.source === 'cursor' || this.busy) return;
    const name = await vscode.window.showInputBox({ prompt: '对话名称', value: chat.name, validateInput: s => s.trim() ? null : '名称不能为空' });
    if (name) { chat.name = name.trim(); this.save(); this.post(); }
  }
  async inlineEdit() {
    await this.ready;
    if (this.busy || this.inlineBusy) throw new Error('请等待当前任务完成后再改写选区。');
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
    this.chats = this.chats.filter(c => c.id !== chat.id); this.select(null); this.save();
  }
  async connect() {
    if (this.bridge) return this.bridge;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const bridge = new Bridge(findCodex(vscode.workspace.getConfiguration('gptide').get('codexPath')), this.project || this.root);
      bridge.on('notification', event => this.onNotification(event));
      bridge.on('request', request => this.approve(request));
      bridge.on('disconnected', e => { if (this.bridge === bridge) { this.bridge = null; this.resumed = false; this.busy = false; this.status = e.message; this.post(); } });
      try { await bridge.start(); } catch (error) { bridge.dispose(); throw error; }
      this.bridge = bridge;
      await this.refreshAccount();
      return bridge;
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
    if (this.storageBlocked) throw new Error(this.historyWarning);
    if (this.inlineBusy) throw new Error('请先完成或放弃 Ctrl+K 修改预览。');
    if (this.busy || typeof text !== 'string' || !text.trim()) return;
    if (!['ask', 'agent', 'plan'].includes(mode)) throw new Error('未知工作模式');
    if (!this.project) throw new Error('请先打开项目文件夹');
    if (mode === 'agent' && !vscode.workspace.isTrusted) throw new Error('请先在 VS Code 的工作区信任中信任此项目，或使用 Ask / Plan 只读模式');
    const bridge = await this.connect();
    if (this.busy) return;
    if (!this.account || !['chatgpt', 'chatgptAuthTokens'].includes(this.account.type)) throw new Error('请先使用 ChatGPT 账号登录');
    this.mode = mode; this.busy = true; this.status = '正在思考'; this.activity = ''; this.post();
    try {
      let importedContext = '';
      const selected = this.chats.find(c => c.id === this.activeId);
      if (!selected || selected.source === 'cursor') {
        if (selected) {
          const transcript = selected.messages.map(m => `[${m.role}]\n${m.text}`).join('\n\n');
          if (transcript.length > 180000) {
            this.busy = false; this.post();
            const answer = await vscode.window.showWarningMessage('这段 Cursor 历史较长。继续时将发送最近约 18 万字符作为背景，完整记录仍可查看。', { modal: true }, '继续');
            if (!answer) return; this.busy = true;
          }
          importedContext = '以下是从 Cursor 导入的历史对话，仅作为项目背景。请以用户当前请求为准。\n' + transcript.slice(-180000) + '\n\n当前请求：\n';
        }
        const chat = { id: crypto.randomUUID(), source: 'gptide', name: text.slice(0, 40), messages: selected ? selected.messages.map(m => ({ ...m })) : [], updatedAt: Date.now() };
        this.chats.unshift(chat); this.activeId = chat.id; this.messages = chat.messages; this.threadId = null; this.resumed = false;
      }
      if (!this.resumed) {
        const params = { cwd: this.project, model: this.model, approvalPolicy: 'on-request', sandbox: mode === 'agent' ? 'workspace-write' : 'read-only' };
        const result = await bridge.call(this.threadId ? 'thread/resume' : 'thread/start', this.threadId ? { ...params, threadId: this.threadId } : params);
        this.threadId = result.thread.id; this.resumed = true;
        this.chats.find(c => c.id === this.activeId).threadId = this.threadId;
      }
      let editorContext = '';
      if (attach && vscode.window.activeTextEditor) {
        const editor = vscode.window.activeTextEditor;
        const content = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
        editorContext = `\n\n当前编辑器文件：${editor.document.uri.fsPath}\n${content.slice(0, 50000)}`;
      }
      const labels = this.attachments.map(a => a.label); let budget = 100000;
      for (const attachment of this.attachments) { if (budget <= 0) break; const snippet = attachment.text.slice(0, Math.min(50000, budget)); budget -= snippet.length; editorContext += `\n\n引用文件：${attachment.path}\n${snippet}`; }
      if (this.attachments.some(a => a.text.length > 50000) || budget <= 0) this.importWarning = '文件上下文最多附上约 10 万字符，长文件已截断。';
      this.baseline = mode === 'agent' ? review.snapshot(this.project) : null; this.candidates = new Map();
      const active = this.chats.find(c => c.id === this.activeId); active.tasks ||= []; this.tasks = active.tasks; active.taskTurn = (active.taskTurn || 0) + 1; this.currentTaskTurn = active.taskTurn;
      if (this.baseline?.limited) this.importWarning = '项目较大，修改预览只覆盖已采集的文本文件。';
      this.messages.push({ role: 'user', text, attachments: labels, mode, model: this.model }); if (!this.save()) throw new Error(this.historyWarning); this.post();
      const instruction = mode === 'plan' ? '请先调查项目并给出具体实施计划、涉及文件和验证步骤。本轮只做计划，不修改文件。\n\n' : '';
      const result = await bridge.call('turn/start', { threadId: this.threadId, model: this.model, effort: this.effort, input: [{ type: 'text', text: instruction + importedContext + text + editorContext }], sandboxPolicy: mode !== 'agent' ? { type: 'readOnly' } : { type: 'workspaceWrite', writableRoots: [this.project], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } });
      if (this.busy) this.turnId = result.turn.id;
      this.attachments = []; this.view?.webview.postMessage({ type: 'sent' }); this.post();
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
    if (method === 'account/login/completed' && p.success) { this.refreshAccount().catch(e => { this.status = e.message; this.post(); }); return; }
    if (p?.threadId && p.threadId !== this.threadId) return;
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
      if (this.baseline) {
        try { this.changes = review.collectChanges(this.project, this.baseline, this.candidates); } catch (e) { this.importWarning = '修改预览读取失败：' + e.message; }
        this.baseline = null;
      }
      const chat = this.chats.find(c => c.id === this.activeId); if (chat) { chat.updatedAt = Date.now(); chat.changes = this.changes; }
      this.save(); this.post();
    }
    if (method === 'error') { this.status = p.error?.message || '模型请求失败'; if (!p.willRetry) this.busy = false; this.save(); this.post(); }
  }
  resolveWebviewView(view) {
    this.view = view; view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.file(this.context.extensionPath)] };
    const nonce = crypto.randomBytes(20).toString('hex');
    const source = name => fs.readFileSync(path.join(this.context.extensionPath, name), 'utf8');
    view.webview.html = source('view.html').replace('__STYLE__', () => source('view.css')).replace('__MARKDOWN__', () => source('markdown.cjs')).replace('__SCRIPT__', () => source('view.js')).replaceAll('__NONCE__', nonce);
    view.webview.onDidReceiveMessage(async msg => {
      try {
        if (msg.type === 'ready') this.post();
        if (msg.type === 'login') await this.login();
        if (msg.type === 'send') await this.send(msg.text, msg.mode, msg.attach);
        if (msg.type === 'stop' && this.turnId) { this.status = '正在停止'; this.post(); await this.bridge.call('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }); }
        if (msg.type === 'select' && !this.busy) { this.select(msg.id); this.save(); }
        if (msg.type === 'new' && !this.busy) { this.select(null); this.save(); }
        if (msg.type === 'model' && !this.busy && this.models.some(m => m.model === msg.value)) { this.model = msg.value; const model = this.models.find(m => m.model === msg.value); if (!model.supportedReasoningEfforts.some(e => e.reasoningEffort === this.effort)) this.effort = model.defaultReasoningEffort; this.save(); this.post(); }
        if (msg.type === 'effort' && !this.busy && this.models.find(m => m.model === this.model)?.supportedReasoningEfforts?.some(e => e.reasoningEffort === msg.value)) { this.effort = msg.value; this.save(); this.post(); }
        if (msg.type === 'attach') await this.attachFiles();
        if (msg.type === 'attachCurrent') await this.attachFiles(true);
        if (msg.type === 'removeAttachment') { this.attachments = this.attachments.filter(a => a.id !== msg.id); this.post(); }
        if (msg.type === 'rename') await this.renameChat();
        if (msg.type === 'delete') await this.deleteChat();
        if (msg.type === 'diff') await this.showDiff(msg.path);
        if (msg.type === 'openFile' && typeof msg.path === 'string' && this.project && this.tasks?.some(task => task.files?.includes(msg.path))) { const file = path.resolve(this.project, msg.path); if (review.within(this.project, file) && fs.existsSync(file) && fs.statSync(file).isFile()) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(file))); }
        if (msg.type === 'revert') await this.revert(msg.path);
        if (msg.type === 'accept' && !this.busy) { const change = this.changes.find(c => c.path === msg.path); if (change) { change.status = 'accepted'; this.save(); this.post(); } }
        if (msg.type === 'copy' && typeof msg.text === 'string') await vscode.env.clipboard.writeText(msg.text);
        if (msg.type === 'openLink' && /^https?:\/\//i.test(msg.url)) await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        if (msg.type === 'settings') await vscode.commands.executeCommand('workbench.action.openSettings', 'gptide');
        if (msg.type === 'refresh' && !this.busy) { if (this.conflictFile) { await vscode.commands.executeCommand('workbench.action.reloadWindow'); return; } await this.importCursor(); this.select(this.activeId); await this.connect(); await this.refreshAccount(); }
        if (msg.type === 'folder') await vscode.commands.executeCommand('workbench.action.files.openFolder');
        if (msg.type === 'changes') await vscode.commands.executeCommand('workbench.view.scm');
        if (msg.type === 'terminal') await vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal');
      } catch (e) { this.status = e.message; this.post(); }
    });
    this.post();
  }
  dispose() { clearTimeout(this.postTimer); this.save(); this.bridge?.dispose(); }
}
function activate(context) {
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => vscode.commands.executeCommand('workbench.action.reloadWindow')));
  if (!vscode.workspace.workspaceFolders?.length) return;
  const chat = new Chat(context); context.subscriptions.push(chat);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('gptide.chat', chat, { webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.open', () => vscode.commands.executeCommand('gptide.chat.focus')));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.login', () => chat.login()));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.refresh', async () => { await chat.ready; await chat.importCursor(); chat.select(chat.activeId); }));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('gptide-before', { provideTextDocumentContent: uri => chat.contextBefore?.get(uri.path.slice(1)) || '' }));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.attachSelection', () => chat.attachFiles(true)));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.inlineEdit', () => chat.inlineEdit().catch(error => vscode.window.showErrorMessage(error.message))));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.newChat', () => { if (!chat.busy) { chat.select(null); chat.save(); vscode.commands.executeCommand('gptide.chat.focus'); } }));
  vscode.commands.executeCommand('gptide.chat.focus');
}
module.exports = { activate };
