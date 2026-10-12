const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Bridge, findCodex } = require('./bridge.cjs');
const exec = promisify(execFile);

class Chat {
  constructor(context) {
    this.context = context; this.messages = []; this.chats = []; this.model = vscode.workspace.getConfiguration('gptide').get('model');
    this.status = '正在读取项目进度'; this.busy = false; this.project = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.output = vscode.window.createOutputChannel('GptIDE'); context.subscriptions.push(this.output);
    const root = path.resolve(context.extensionPath, '../../../../..');
    this.root = root; this.data = path.join(root, 'data', 'projects'); fs.mkdirSync(this.data, { recursive: true });
    this.stateFile = this.project ? path.join(this.data, crypto.createHash('sha256').update(this.project.toLowerCase()).digest('hex') + '.json') : null;
    this.ready = this.load();
  }
  async load() {
    if (this.stateFile && fs.existsSync(this.stateFile)) {
      try { const state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); this.chats = state.chats || []; this.activeId = state.activeId; this.model = state.model || this.model; } catch (e) { this.output.appendLine('本地历史读取失败：' + e.message); }
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
      const native = this.chats.filter(c => c.source !== 'cursor'); this.chats = [...native, ...result.chats];
      this.importWarning = result.warnings.join('；');
    } catch (e) { this.importWarning = 'Cursor 历史未能读取：' + e.message; }
  }
  select(id) { this.activeId = id; const chat = this.chats.find(c => c.id === id); this.messages = chat?.messages || []; this.threadId = chat?.threadId; this.resumed = false; this.post(); }
  save() { if (this.stateFile) fs.writeFileSync(this.stateFile, JSON.stringify({ activeId: this.activeId, model: this.model, chats: this.chats.filter(c => c.source !== 'cursor') }), 'utf8'); }
  post() {
    const chat = this.chats.find(c => c.id === this.activeId);
    this.view?.webview.postMessage({ type: 'state', project: this.project || '', status: this.status, warning: this.importWarning || '', busy: this.busy, messages: this.messages, activeId: this.activeId, source: chat?.source, chats: this.chats.map(c => ({ id: c.id, name: c.name, source: c.source })), models: this.models || [], model: this.model, account: this.account, activity: this.activity || '', cursorCount: this.cursorCount || 0 });
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
    this.status = this.account ? `ChatGPT ${(this.account.plan || '').toUpperCase()} 已连接` : '请使用 ChatGPT 登录'; this.post();
  }
  async login() { await this.ready; const bridge = await this.connect(); const result = await bridge.call('account/login/start', { type: 'chatgpt' }); if (result.authUrl) await vscode.env.openExternal(vscode.Uri.parse(result.authUrl)); this.status = '请在浏览器完成 ChatGPT 登录'; this.post(); }
  async send(text, mode, attach) {
    await this.ready;
    if (this.busy || !text.trim()) return;
    if (!this.project) throw new Error('请先打开项目文件夹');
    if (mode !== 'ask' && !vscode.workspace.isTrusted) throw new Error('请先在 VS Code 的工作区信任中信任此项目，或使用 Ask 只读分析');
    const bridge = await this.connect();
    if (!this.account || !['chatgpt', 'chatgptAuthTokens'].includes(this.account.type)) throw new Error('请先使用 ChatGPT 账号登录');
    this.busy = true; this.status = '正在思考'; this.activity = ''; this.post();
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
        const params = { cwd: this.project, model: this.model, approvalPolicy: 'on-request', sandbox: mode === 'ask' ? 'read-only' : 'workspace-write' };
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
      this.messages.push({ role: 'user', text }); this.save(); this.post();
      const result = await bridge.call('turn/start', { threadId: this.threadId, model: this.model, input: [{ type: 'text', text: importedContext + text + editorContext }], sandboxPolicy: mode === 'ask' ? { type: 'readOnly' } : { type: 'workspaceWrite', writableRoots: [this.project], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } });
      this.turnId = result.turn.id;
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
    if (method === 'item/agentMessage/delta') {
      let item = this.messages.find(m => m.itemId === p.itemId);
      if (!item) { item = { role: 'assistant', text: '', itemId: p.itemId }; this.messages.push(item); }
      item.text += p.delta; this.post();
    }
    if (method === 'item/started') { this.activity = p.item?.type === 'commandExecution' ? '运行：' + p.item.command : p.item?.type === 'fileChange' ? '正在修改文件' : '正在处理项目'; this.post(); }
    if (method === 'item/completed' && p.item?.type === 'agentMessage') {
      let item = this.messages.find(m => m.itemId === p.item.id);
      if (!item) { item = { role: 'assistant', text: '', itemId: p.item.id }; this.messages.push(item); }
      if (p.item.text) item.text = p.item.text; this.post();
    }
    if (method === 'turn/completed') { this.busy = false; this.turnId = null; this.status = p.turn?.status === 'failed' ? p.turn.error?.message || '请求失败' : p.turn?.status === 'interrupted' ? '已停止' : '完成'; this.activity = ''; const chat = this.chats.find(c => c.id === this.activeId); if (chat) chat.updatedAt = Date.now(); this.save(); this.post(); }
    if (method === 'error') { this.status = p.error?.message || '模型请求失败'; if (!p.willRetry) this.busy = false; this.save(); this.post(); }
  }
  resolveWebviewView(view) {
    this.view = view; view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.file(this.context.extensionPath)] };
    const nonce = crypto.randomBytes(20).toString('hex');
    view.webview.html = fs.readFileSync(path.join(this.context.extensionPath, 'view.html'), 'utf8').replaceAll('__NONCE__', nonce);
    view.webview.onDidReceiveMessage(async msg => {
      try {
        if (msg.type === 'ready') this.post();
        if (msg.type === 'login') await this.login();
        if (msg.type === 'send') await this.send(msg.text, msg.mode, msg.attach);
        if (msg.type === 'stop' && this.turnId) await this.bridge.call('turn/interrupt', { threadId: this.threadId, turnId: this.turnId });
        if (msg.type === 'select' && !this.busy) { this.select(msg.id); this.save(); }
        if (msg.type === 'new' && !this.busy) { this.select(null); this.save(); }
        if (msg.type === 'model' && !this.busy && this.models.some(m => m.model === msg.value)) { this.model = msg.value; this.save(); this.post(); }
        if (msg.type === 'refresh' && !this.busy) { await this.importCursor(); this.select(this.activeId); if (this.bridge) await this.refreshAccount(); }
        if (msg.type === 'folder') await vscode.commands.executeCommand('workbench.action.files.openFolder');
        if (msg.type === 'changes') await vscode.commands.executeCommand('workbench.view.scm');
        if (msg.type === 'terminal') await vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal');
      } catch (e) { this.status = e.message; this.post(); }
    });
    this.post();
  }
  dispose() { this.save(); this.bridge?.dispose(); }
}
function activate(context) {
  const chat = new Chat(context); context.subscriptions.push(chat);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('gptide.chat', chat, { webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.open', () => vscode.commands.executeCommand('gptide.chat.focus')));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.login', () => chat.login()));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.refresh', async () => { await chat.ready; await chat.importCursor(); chat.select(chat.activeId); }));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => vscode.commands.executeCommand('workbench.action.reloadWindow')));
  vscode.commands.executeCommand('gptide.chat.focus');
}
module.exports = { activate };
