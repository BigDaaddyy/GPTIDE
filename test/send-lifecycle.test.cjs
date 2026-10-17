const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const config = { get: (key, fallback) => key === 'codexPath' ? path.join(__dirname, 'unused-fixture-codex.exe') : fallback };
const vscode = { workspace: { isTrusted: true, getConfiguration: () => config }, window: {} };
vscode.CancellationTokenSource = class {
  constructor() { this.listeners = new Set(); this.token = { isCancellationRequested: false, onCancellationRequested: callback => { this.listeners.add(callback); return { dispose: () => this.listeners.delete(callback) }; } }; }
  cancel() { this.token.isCancellationRequested = true; for (const callback of this.listeners) callback(); }
  dispose() { this.listeners.clear(); }
};
const originalRequire = Module.prototype.require;
let Chat;
try { Module.prototype.require = function(id) { return id === 'vscode' ? vscode : originalRequire.apply(this, arguments); }; Chat = require('../builtin/extension.cjs').Chat; }
finally { Module.prototype.require = originalRequire; }
function fixture() {
  const chat = Object.create(Chat.prototype), record = { id: 'one', projectKey: 'project', source: 'gptide', name: 'existing', messages: [], draft: 'submitted' };
  Object.assign(chat, { ready: Promise.resolve(), project: process.cwd(), projectKey: 'project', activeId: 'one', chats: [record], openChatIds: ['one'], messages: record.messages, attachments: [], threadId: 'thread', resumed: true, account: { type: 'chatgpt' }, model: 'fixture', effort: 'medium', busy: false, post: () => {}, save: () => true, view: { webview: { postMessage: () => {} } }, drafts: { set: () => {} } });
  return chat;
}

test('running task accepts steering with the exact active turn and preserves subsequent input', async () => {
  const chat = fixture(), calls = [], notifications = [];
  chat.busy = true; chat.turnId = 'running'; chat.messages.push({ role: 'user', text: 'original', workStartedAt: Date.now() - 10000 });
  chat.attachments = [{ id: 'old', label: 'a.js', text: 'context' }];
  let complete; chat.bridge = { call: (method, params) => { calls.push({ method, params }); return new Promise(resolve => { complete = resolve; }); } };
  chat.view.webview.postMessage = value => notifications.push(value);
  const pending = chat.steer('follow-up', 'client'); await Promise.resolve();
  assert.equal(calls[0].method, 'turn/steer'); assert.equal(calls[0].params.expectedTurnId, 'running'); assert.match(calls[0].params.input[0].text, /context/);
  await assert.rejects(chat.steer('duplicate'), /当前状态/); assert.equal(calls.length, 1);
  chat.chats[0].draft = 'next draft'; chat.chats[0].draftVersion = 2; chat.attachments.push({ id: 'new', label: 'b.js', text: 'later' });
  complete({ turnId: 'running' }); await pending;
  assert.equal(chat.busy, true); assert.equal(chat.chats[0].draft, 'next draft'); assert.deepEqual(chat.attachments.map(a => a.id), ['new']);
  assert.equal(chat.messages.at(-1).text, 'follow-up'); assert.equal(notifications.at(-1).clientSendId, 'client'); assert.equal(chat.steerBusy, false);
  chat.tasks = []; chat.finishTurn({ id: 'running', status: 'completed' });
  assert.equal(chat.messages[0].workDurationMs, chat.messages[1].workDurationMs);
});
test('steering rejects unavailable turns, preserves drafts on failures and never retries unknown delivery', async () => {
  const chat = fixture(); await assert.rejects(chat.steer('follow-up'), /任务尚未/);
  chat.busy = true; chat.turnId = 'running'; let calls = 0;
  chat.bridge = { call: async () => { calls++; throw Object.assign(Error('turn mismatch'), { code: -32600 }); } };
  await assert.rejects(chat.steer('follow-up'), /追加失败/); assert.equal(chat.messages.length, 0); assert.equal(chat.chats[0].draft, 'submitted');
  chat.bridge = { call: async () => { calls++; throw Error('timeout'); } };
  await assert.rejects(chat.steer('follow-up'), /追加结果未确认/); assert.equal(chat.messages.at(-1).delivery, 'unknown'); assert.equal(calls, 2); assert.equal(chat.steerBusy, false);
  chat.save = () => false;
  await assert.rejects(chat.steer('unsaved'), /保存失败/); assert.equal(calls, 2); assert.equal(chat.messages.length, 1);
});
test('accepted steering clears only its unchanged draft and closed projects discard late acknowledgments', async () => {
  const chat = fixture(), cleared = [], notifications = []; chat.busy = true; chat.turnId = 'running';
  chat.persistDraft = (id, text) => { cleared.push({ id, text }); }; chat.view.webview.postMessage = value => notifications.push(value);
  chat.bridge = { call: async () => ({ turnId:'running' }) };
  await chat.steer('submitted', 'accepted'); assert.deepEqual(cleared,[{id:'one',text:''}]); assert.equal(notifications.length,1);
  let complete; chat.bridge = { call: () => new Promise(resolve => { complete=resolve; }) };
  const pending = chat.steer('late', 'closed'); await Promise.resolve(); chat.invalidated=true; complete({turnId:'running'}); await pending;
  assert.equal(notifications.length,1); assert.equal(cleared.length,1); assert.equal(chat.steerBusy,false);
});

test('finished turns persist elapsed work time once on their user request',()=>{
  for(const status of ['completed','interrupted','failed']){
    const chat=fixture(),started=Date.now()-187000;chat.messages.push({role:'user',text:'work',workStartedAt:started},{role:'assistant',text:'done'});chat.tasks=[];
    chat.finishTurn({id:'turn',status});const request=chat.messages[0];assert.ok(request.workDurationMs>=187000&&request.workDurationMs<190000);assert.equal(request.workOutcome,status);
    const saved=request.workDurationMs;chat.finishTurn({id:'turn',status});assert.equal(request.workDurationMs,saved);
  }
});
test('explicit focus waits for view activation and never posts into a closed project',async()=>{
  const previous=vscode.commands;let finish;vscode.commands={executeCommand:method=>{assert.equal(method,'gptide.chat.focus');return new Promise(resolve=>{finish=resolve;});}};
  try{const chat=fixture();let posts=0;chat.post=()=>posts++;const pending=chat.focusInput();await new Promise(resolve=>setImmediate(resolve));assert.equal(posts,0);assert.ok(chat.focusRequestId);chat.invalidated=true;finish();await pending;assert.equal(posts,0);}
  finally{vscode.commands=previous;}
});

test('project login holds the task and tab lock until the matching account finishes refreshing', async () => {
  const { EventEmitter } = require('node:events'), bridge = new EventEmitter(), chat = fixture(); let requests = 0;
  bridge.call = async () => { requests++; return { type: 'chatgpt', loginId: 'project-login', authUrl: 'https://example.invalid/fixture' }; };
  chat.connect = async () => bridge; chat.refreshAccount = async () => {}; const oldEnv = vscode.env, oldUri = vscode.Uri;
  vscode.env = { openExternal: async () => true }; vscode.Uri = { parse: value => value };
  try {
    await chat.login(); await chat.login(); assert.equal(requests, 1); assert.equal(chat.loginPending, true);
    await assert.rejects(chat.send('must not run', 'ask'), /先完成 ChatGPT 登录/); assert.equal(chat.select('one'), false);
    chat.newChat(); assert.equal(chat.chats.length, 1);
    bridge.emit('notification', { method: 'account/login/completed', params: { loginId: 'foreign', success: true } }); assert.equal(chat.loginPending, true);
    bridge.emit('notification', { method: 'account/login/completed', params: { loginId: 'project-login', success: true } }); await new Promise(resolve => setImmediate(resolve)); assert.equal(chat.loginPending, false);
  } finally { chat.loginSession?.dispose(); vscode.env = oldEnv; vscode.Uri = oldUri; }
});

test('rename and delete recheck inline and dispatch locks after their dialogs return', async () => {
  const savedInput = vscode.window.showInputBox, savedWarning = vscode.window.showWarningMessage;
  try {
    for (const method of ['renameChat', 'deleteChat']) {
      const chat = fixture(); let finish;
      vscode.window.showInputBox = () => new Promise(resolve => { finish = resolve; });
      vscode.window.showWarningMessage = () => new Promise(resolve => { finish = resolve; });
      const pending = chat[method](); chat.inlinePromptBusy = true; finish(method === 'renameChat' ? 'changed' : '确认'); await pending;
      assert.equal(chat.chats.length, 1); assert.equal(chat.chats[0].name, 'existing');
      chat.inlinePromptBusy = false; chat.queueDispatchToken = Symbol('dispatch');
      vscode.window.showInputBox = vscode.window.showWarningMessage = () => { throw Error('Locked operation must not show dialog'); };
      await chat[method]();
    }
  } finally { vscode.window.showInputBox = savedInput; vscode.window.showWarningMessage = savedWarning; }
});
test('account refresh keeps prior state until both responses arrive and discards a disconnected result', async () => {
  const chat = fixture(); let finishModels; const calls = [];
  chat.bridge = { call: async method => { calls.push(method); if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'plus' } }; return new Promise(resolve => { finishModels = resolve; }); } };
  const pending = chat.refreshAccount(); await Promise.resolve(); await Promise.resolve();
  assert.equal(chat.account.plan, undefined); chat.bridge = null;
  finishModels({ data: [{ model: 'old', isDefault: true }] }); await pending;
  assert.equal(chat.model, 'fixture'); assert.equal(chat.account.plan, undefined); assert.deepEqual(calls, ['account/read', 'model/list']);
});
test('only the latest account refresh may publish account and model state', async () => {
  const chat = fixture(); let firstRead, calls = 0, posts = 0; chat.post = () => posts++;
  chat.bridge = { call: async method => {
    calls++;
    if (method === 'account/read' && calls === 1) return new Promise(resolve => { firstRead = resolve; });
    return method === 'account/read' ? { account: { type: 'chatgpt', planType: 'plus' } } : { data: [{ model: 'new', isDefault: true, defaultReasoningEffort: 'high' }] };
  } };
  const old = chat.refreshAccount(); await chat.refreshAccount();
  firstRead({ account: { type: 'chatgpt', planType: 'old' } }); await old;
  assert.equal(chat.account.plan, 'plus'); assert.equal(chat.model, 'new'); assert.equal(chat.effort, 'high'); assert.equal(posts, 1); assert.equal(calls, 3);
});
test('stale account refresh errors cannot overwrite a new connection', async () => {
  const chat = fixture(); let fail;
  chat.bridge = { call: () => new Promise((resolve, reject) => { fail = reject; }) };
  const old = chat.refreshAccount(); chat.bridge = { call: async () => { throw new Error('current failure'); } };
  fail(new Error('old failure')); await old;
  await assert.rejects(chat.refreshAccount(), /current failure/);
});

test('account refresh selects a model on a later page and retains prior state on invalid catalog', async () => {
  const chat=fixture();chat.bridge={call:async(method,params)=>method==='account/read'?{account:{type:'chatgpt',planType:'plus'}}:params.cursor?{data:[{model:'gpt-6.1-sol',defaultReasoningEffort:'ultra',supportedReasoningEfforts:[{reasoningEffort:'ultra'}]}]}:{data:[{model:'old',isDefault:true}],nextCursor:'next'}};
  await chat.refreshAccount();assert.equal(chat.model,'gpt-6.1-sol');assert.equal(chat.effort,'ultra');assert.equal(chat.models.length,2);
  chat.bridge={call:async method=>method==='account/read'?{account:{type:'chatgpt',planType:'new'}}:{data:{invalid:true}}};
  await assert.rejects(chat.refreshAccount(),/模型列表响应无效/);assert.equal(chat.account.plan,'plus');assert.equal(chat.model,'gpt-6.1-sol');
});
test('empty official model catalog rejects before issuing a task and retains attempted instruction',async()=>{
  const chat=fixture();chat.models=[];chat.connect=async()=>({call:()=>{throw Error('No task may start');}});
  await assert.rejects(chat.send('saved attempt','ask'),/没有可用模型/);assert.equal(chat.busy,false);assert.equal(chat.chats[0].lastRequest,'saved attempt');assert.equal(chat.chats[0].lastOutcome,'failed');
});
test('file discovery cannot open a picker after a project closes or expose foreign files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-attach-')), file = path.join(root, 'a.js'); fs.writeFileSync(file, 'QA file');
  const saved = { find: vscode.workspace.findFiles, relative: vscode.workspace.asRelativePath, pick: vscode.window.showQuickPick };
  try {
    const closed = fixture(); closed.project = root; let finish;
    vscode.workspace.findFiles = () => new Promise(resolve => { finish = resolve; });
    vscode.window.showQuickPick = () => { throw new Error('Closed project must not show a picker'); };
    const pending = closed.attachFiles(); await Promise.resolve(); closed.invalidated = true; finish([{ scheme: 'file', fsPath: file }]); await pending; assert.deepEqual(closed.attachments, []);
    const chat = fixture(); chat.project = root; vscode.workspace.asRelativePath = uri => path.basename(uri.fsPath);
    vscode.workspace.findFiles = async () => [{ scheme: 'file', fsPath: file }, { scheme: 'untitled', fsPath: file }, { scheme: 'file', fsPath: path.join(os.tmpdir(), 'foreign.js') }];
    vscode.window.showQuickPick = async rows => { assert.equal(rows.length, 1); assert.equal(rows[0].uri.fsPath, file); return rows; };
    await chat.attachFiles(); assert.equal(chat.attachments.length, 1); assert.equal(chat.attachments[0].text, 'QA file');
  } finally { vscode.workspace.findFiles = saved.find; vscode.workspace.asRelativePath = saved.relative; vscode.window.showQuickPick = saved.pick; fs.rmSync(root, { recursive: true, force: true }); }
});
test('context pickers discard project changes before Git or folder content reads', async () => {
  const chat = fixture(), core = require('../builtin/context.cjs'), saved = { pick: vscode.window.showQuickPick, git: core.gitDiff, find: vscode.workspace.findFiles, folder: core.folderText, RelativePattern: vscode.RelativePattern };
  try {
    let finish;
    vscode.window.showQuickPick = () => new Promise(resolve => { finish = resolve; }); core.gitDiff = () => { throw new Error('Stale Git selection must not read'); };
    const git = chat.attachContext('git'); await Promise.resolve(); chat.activeId = 'other'; finish('未暂存差异'); await git; assert.deepEqual(chat.attachments, []);
    chat.activeId = 'one'; vscode.RelativePattern = class {};
    vscode.workspace.findFiles = () => new Promise(resolve => { finish = resolve; }); core.folderText = () => { throw new Error('Closed project must not read folder contents'); };
    const folder = chat.attachContext('folder', { scheme: 'file', fsPath: chat.project }); await Promise.resolve(); chat.invalidated = true; finish([]); await folder; assert.deepEqual(chat.attachments, []);
  } finally { vscode.window.showQuickPick = saved.pick; core.gitDiff = saved.git; vscode.workspace.findFiles = saved.find; core.folderText = saved.folder; vscode.RelativePattern = saved.RelativePattern; }
});
test('inline prompt rechecks project, trust, review lock and document before any generation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-inline-guard-')), file = path.join(root, 'a.js'); fs.writeFileSync(file, 'let a = 1;');
  const saved = { editor: vscode.window.activeTextEditor, input: vscode.window.showInputBox, progress: vscode.window.withProgress, Range: vscode.Range, EndOfLine: vscode.EndOfLine };
  try {
    vscode.Range = class { constructor(start, end) { this.start = start; this.end = end; } }; vscode.EndOfLine = { CRLF: 2 };
    vscode.window.withProgress = () => { throw new Error('Must not start generation'); };
    for (const kind of ['project', 'trust', 'review', 'edited', 'closed']) {
      const chat = fixture(); chat.project = root; let finish, text = 'let a = 1;';
      const document = { uri: { scheme: 'file', fsPath: file }, version: 1, languageId: 'javascript', getText: () => text, offsetAt: position => position.offset };
      vscode.workspace.isTrusted = true; vscode.window.activeTextEditor = { document, selection: { start: { offset: 0 }, end: { offset: 10 }, isEmpty: false } };
      vscode.window.showInputBox = () => new Promise(resolve => { finish = resolve; });
      const pending = chat.inlineEdit(); await new Promise(resolve => setImmediate(resolve));
      if (kind === 'project') chat.invalidated = true;
      if (kind === 'trust') vscode.workspace.isTrusted = false;
      if (kind === 'review') chat.reviewBusy = true;
      if (kind === 'edited') { text = 'new text'; document.version++; }
      if (kind === 'closed') document.isClosed = true;
      finish('QA instruction'); await assert.rejects(pending, /项目已切换|信任|已有任务|发生变化/); assert.ok(!chat.inlineBusy);
    }
  } finally { vscode.workspace.isTrusted = true; vscode.Range = saved.Range; vscode.EndOfLine = saved.EndOfLine; vscode.window.activeTextEditor = saved.editor; vscode.window.showInputBox = saved.input; vscode.window.withProgress = saved.progress; fs.rmSync(root, { recursive: true, force: true }); }
});
test('closing a project cancels its active inline generation and releases the lock', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-inline-cancel-')), file = path.join(root, 'a.js'); fs.writeFileSync(file, 'let a = 1;');
  const agent = require('../builtin/inline-agent.cjs'), originalGenerate = agent.generate;
  const saved = { editor: vscode.window.activeTextEditor, input: vscode.window.showInputBox, progress: vscode.window.withProgress, Range: vscode.Range, EndOfLine: vscode.EndOfLine, ProgressLocation: vscode.ProgressLocation };
  const progressToken = new vscode.CancellationTokenSource(); let received;
  try {
    const chat = fixture(); chat.project = root;
    vscode.Range = class { constructor(start, end) { this.start = start; this.end = end; } }; vscode.EndOfLine = { CRLF: 2 }; vscode.ProgressLocation = { Notification: 15 };
    vscode.window.activeTextEditor = { document: { uri: { scheme: 'file', fsPath: file }, version: 1, languageId: 'javascript', getText: () => 'let a = 1;', offsetAt: position => position.offset }, selection: { start: { offset: 0 }, end: { offset: 10 }, isEmpty: false } };
    vscode.window.showInputBox = async () => 'QA instruction'; vscode.window.withProgress = (options, action) => action({}, progressToken.token);
    agent.generate = ({ token }) => { received = token; return new Promise((resolve, reject) => token.onCancellationRequested(() => reject(new Error('已取消代码改写。')))); };
    const pending = chat.inlineEdit(); await new Promise(resolve => setImmediate(resolve)); assert.equal(chat.inlineBusy, true);
    chat.invalidateProject(); await assert.rejects(pending, /已取消/); assert.equal(received.isCancellationRequested, true); assert.equal(chat.inlineBusy, false); assert.equal(chat.inlineCancellation, null); assert.equal(fs.readFileSync(file, 'utf8'), 'let a = 1;');
  } finally { agent.generate = originalGenerate; progressToken.dispose(); vscode.Range = saved.Range; vscode.EndOfLine = saved.EndOfLine; vscode.ProgressLocation = saved.ProgressLocation; vscode.window.activeTextEditor = saved.editor; vscode.window.showInputBox = saved.input; vscode.window.withProgress = saved.progress; fs.rmSync(root, { recursive: true, force: true }); }
});
test('preparing a send locks its conversation and ignores duplicate send', async () => {
  const chat = fixture(); let finishConnect, calls = 0;
  chat.connect = () => new Promise(resolve => { finishConnect = resolve; });
  const pending = chat.send('submitted', 'ask', false); await Promise.resolve();
  assert.equal(chat.busy, true); chat.newChat(); assert.equal(chat.activeId, 'one');
  await chat.send('duplicate', 'ask', false);
  finishConnect({ call: async method => { calls++; assert.equal(method, 'turn/start'); return { turn: { id: 'turn' } }; } });
  await pending; assert.equal(calls, 1); assert.equal(chat.messages.length, 1); assert.equal(chat.messages[0].text, 'submitted');
});
test('reconnect restores only the connection, pauses queues and prevents duplicate refreshes', async () => {
  const chat = fixture(); chat.chats[0].queue = [{ id: 'pending' }]; let finish, calls = 0; chat.connect = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const pending = chat.reconnect(); await Promise.resolve(); await chat.reconnect(); assert.equal(calls, 1); finish(); await pending; assert.equal(chat.chats[0].queuePaused, true); assert.equal(chat.messages.length, 0);
  chat.busy = true; await assert.rejects(chat.reconnect(), /结束当前任务/);
});
test('restore takes the last request into an empty draft without sending or replacing existing text', async () => {
  const chat = fixture(), replies = []; chat.streamRevision = 3; chat.chats[0].lastRequest = 'QA failed request'; chat.chats[0].draft = ''; chat.view.webview.postMessage = value => replies.push(value);
  chat.connect = () => { throw new Error('Restoring a draft must never connect'); }; await chat.restoreRequest('one', 3, 7); assert.equal(chat.chats[0].draft, 'QA failed request'); assert.equal(replies.find(value => value.type === 'draftRestored').editVersion, 7); assert.equal(chat.messages.length, 0);
  await assert.rejects(chat.restoreRequest('one', 3, 8), /已有内容/); assert.equal(chat.chats[0].draft, 'QA failed request'); await assert.rejects(chat.restoreRequest('foreign', 3, 8), /状态已变化/);
});
test('expired transient previews report missing content while valid empty files stay empty', () => {
  const chat = fixture(); chat.contextBefore = new Map([['empty', '']]); assert.equal(chat.beforeContent({ path: '/empty' }), ''); assert.throws(() => chat.beforeContent({ path: '/expired' }), /已过期/);
});
test('send retains its last attempted request even when connection preparation fails', async () => {
  const chat = fixture(); chat.connect = async () => { throw new Error('QA cannot connect'); }; await assert.rejects(chat.send('attempted', 'ask', false), /cannot connect/); assert.equal(chat.chats[0].lastRequest, 'attempted'); assert.equal(chat.chats[0].lastOutcome, 'failed'); assert.equal(chat.busy, false);
});
test('queued send uses captured references without clearing next draft or emitting an unrelated input acknowledgment', async () => {
  const chat = fixture(), notifications = []; chat.busy = true; chat.attachments = [{ id: 'queued-file', label: 'a.js', path: 'QA/a.js', text: 'snapshot' }]; chat.view.webview.postMessage = value => notifications.push(value);
  await chat.enqueue('queued task', 'ask', 'queue-client'); assert.equal(chat.chats[0].queue.length, 1); assert.equal(chat.attachments.length, 0); assert.equal(notifications.find(value => value.type === 'queued').clientSendId, 'queue-client');
  chat.busy = false; chat.chats[0].draft = 'next draft'; chat.attachments = [{ id: 'next-file', label: 'b.js', text: 'later' }]; let input;
  chat.connect = async () => ({ call: async (method, params) => { input = params.input[0].text; return { turn: { id: 'queued-turn' } }; } });
  await chat.dispatchQueue(); assert.ok(input.includes('snapshot')); assert.ok(!input.includes('later')); assert.equal(chat.chats[0].draft, 'next draft'); assert.equal(chat.chats[0].queue.length, 0); assert.equal(chat.attachments[0].id, 'next-file'); assert.equal(notifications.filter(value => value.type === 'sent').length, 0);
});
test('queue failure pauses without automatic retry and pause stops subsequent dispatch', async () => {
  const chat = fixture(); chat.busy = true; await chat.enqueue('next task', 'ask'); chat.busy = false;
  let calls = 0; chat.connect = async () => { calls++; throw new Error('QA disconnected'); };
  await chat.dispatchQueue(); assert.equal(chat.chats[0].queuePaused, true); assert.equal(chat.chats[0].queue[0].status, 'failed'); await chat.dispatchQueue(); assert.equal(calls, 1);
  await chat.queueAction('queueRemove', chat.chats[0].queue[0].id); assert.equal(chat.chats[0].queue.length, 0); clearTimeout(chat.queueTimer);
});
test('failed turn unlocks unconfirmed queue immediately and its late RPC cannot overwrite edited pending work', async () => {
  const chat = fixture(); chat.busy = true; await chat.enqueue('queued request', 'ask'); chat.busy = false; let rejectStart;
  chat.connect = async () => ({ call: () => new Promise((resolve, reject) => { rejectStart = reject; }) }); const dispatch = chat.dispatchQueue(); await new Promise(resolve => setImmediate(resolve));
  chat.onNotification({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'early-failed', status: 'failed', error: { message: 'QA early failure' } } } });
  const item = chat.chats[0].queue[0]; assert.equal(item.status, 'failed'); assert.equal(chat.chats[0].queuePaused, true);
  item.text = 'edited pending'; item.status = 'pending'; rejectStart(new Error('old RPC failure')); await dispatch; assert.equal(item.text, 'edited pending'); assert.equal(item.status, 'pending');
});
test('successful completion schedules the next queued instruction only for the active unpaused conversation', async () => {
  const chat = fixture(); chat.busy = true; chat.turnId = 'old'; chat.tasks = []; await chat.enqueue('follow-up', 'ask'); let calls = 0;
  chat.connect = async () => ({ call: async () => { calls++; return { turn: { id: 'next' } }; } });
  chat.finishTurn({ id: 'old', status: 'completed' }); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(calls, 1); assert.equal(chat.turnId, 'next'); assert.equal(chat.chats[0].queue.length, 0);
  chat.chats[0].queuePaused = true; await chat.enqueue('stay pending', 'ask'); chat.finishTurn({ id: 'next', status: 'completed' }); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(calls, 1); assert.equal(chat.chats[0].queue.length, 1);
});
test('branch starts an independent thread, sends only prefix background once and preserves origin', async () => {
  const chat = fixture(); chat.streamRevision = 7; chat.chatAttachments = new Map(); chat.chats[0].messages.push({ role: 'user', text: 'prefix' }, { role: 'assistant', text: 'answer' }, { role: 'user', text: 'later' });
  const origin = chat.chats[0]; assert.equal(chat.branchChat('one', 1, 6), false); assert.equal(chat.branchChat('one', 1, 7), true); const branch = chat.chats[0]; assert.notEqual(branch.id, 'one'); assert.equal(chat.threadId, undefined); assert.equal(origin.messages.length, 3);
  const calls = []; chat.connect = async () => ({ call: async (method, params) => { calls.push({ method, params }); return method === 'thread/start' ? { thread: { id: 'independent' } } : { turn: { id: 'branch-turn' } }; } });
  await chat.send('try alternative', 'ask', false); assert.equal(calls[0].method, 'thread/start'); const input = calls[1].params.input[0].text; assert.ok(input.includes('prefix')); assert.ok(input.includes('answer')); assert.ok(!input.includes('later')); assert.equal(branch.backgroundPending, false);
  chat.busy = false; await chat.send('next request', 'ask', false); assert.ok(!calls.at(-1).params.input[0].text.includes('prefix')); assert.equal(origin.threadId, undefined); assert.equal(origin.draft, 'submitted');
});
test('unacknowledged branch retains original background for a retry without copying failed requests into it', async () => {
  const chat = fixture(); chat.streamRevision = 1; chat.chatAttachments = new Map(); chat.chats[0].messages.push({ role: 'user', text: 'seed' }); chat.branchChat('one', 0, 1);
  const branch = chat.chats[0]; let fail = true, input;
  chat.connect = async () => ({ call: async (method, params) => { if (method === 'thread/start') return { thread: { id: 'retry' } }; if (fail) throw new Error('QA failed before start'); input = params.input[0].text; return { turn: { id: 'ok' } }; } });
  await assert.rejects(chat.send('failed request', 'ask', false), /QA failed/); assert.equal(branch.backgroundPending, true);
  fail = false; await chat.send('retry request', 'ask', false); assert.ok(input.includes('seed')); assert.ok(!input.includes('failed request')); assert.equal(branch.backgroundPending, false);
});
test('Cursor migration retry retains imported background after its first turn fails', async () => {
  const chat = fixture(); chat.chats[0].source = 'cursor'; chat.chats[0].messages = [{ role: 'user', text: 'Cursor seed' }]; let failed = true, input;
  chat.connect = async () => ({ call: async (method, params) => { if (method === 'thread/start') return { thread: { id: 'cursor-copy' } }; if (failed) throw new Error('QA first failure'); input = params.input[0].text; return { turn: { id: 'ok' } }; } });
  await assert.rejects(chat.send('first try', 'ask', false), /QA first failure/); const copy = chat.chats[0]; assert.equal(copy.source, 'gptide'); assert.equal(copy.backgroundPending, true);
  failed = false; await chat.send('retry', 'ask', false); assert.ok(input.includes('Cursor seed')); assert.ok(!input.includes('first try')); assert.equal(copy.backgroundPending, false);
});

test('sending reads fixed project context fresh and preserves it after acknowledgment', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-fixed-send-'));
  try {
    const chat = fixture(); chat.project = root; fs.writeFileSync(path.join(root, 'a.js'), 'old code');
    chat.fixedContext = new (require('../builtin/project-context.cjs').ProjectContext)(path.join(root, 'context.json'), root, 'project');
    chat.fixedContext.save({ files: ['a.js'], excluded: [], rules: 'QA rules' }); fs.writeFileSync(path.join(root, 'a.js'), 'fresh code'); let payload;
    chat.connect = async () => ({ call: async (method, params) => { assert.equal(method, 'turn/start'); payload = params; return { turn: { id: 'qa-fixed' } }; } });
    await chat.send('request', 'ask', false); assert.ok(payload.input[0].text.includes('fresh code')); assert.ok(payload.input[0].text.includes('QA rules')); assert.ok(!payload.input[0].text.includes('old code'));
    assert.deepEqual(chat.fixedContext.state.files, ['a.js']); assert.ok(chat.messages[0].attachments.includes('固定 · a.js'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('canceling preparation avoids any turn and keeps the draft', async () => {
  const chat = fixture(); let finishConnect, calls = 0;
  chat.connect = () => new Promise(resolve => { finishConnect = resolve; });
  const pending = chat.send('submitted', 'ask', false); await Promise.resolve(); chat.cancelPendingSend = true;
  finishConnect({ call: async () => { calls++; } });
  await assert.rejects(pending, /已取消/); assert.equal(calls, 0); assert.equal(chat.busy, false); assert.equal(chat.chats[0].draft, 'submitted');
});
test('turn acknowledgment never clears text typed after submission', async () => {
  const chat = fixture(); let finishTurn;
  chat.connect = async () => ({ call: () => new Promise(resolve => { finishTurn = resolve; }) });
  const pending = chat.send('submitted', 'ask', false);
  await Promise.resolve(); await Promise.resolve(); chat.persistDraft('one', 'next message');
  finishTurn({ turn: { id: 'turn' } }); await pending;
  assert.equal(chat.chats[0].draft, 'next message');
});
test('loading never exposes unverified chat ids or drafts and unknown selection preserves active chat', () => {
  const chat = fixture(); let payload;
  chat.post = Chat.prototype.post; chat.view.webview.postMessage = value => { payload = value; };
  chat.loadingScope = true; chat.chats[0].projectKey = undefined; chat.chats[0].draft = 'private unverified draft';
  chat.post(); assert.equal(payload.activeId, null); assert.equal(payload.draft, ''); assert.deepEqual(payload.chats, []); assert.deepEqual(payload.messages, []);
  chat.loadingScope = false; chat.chats[0].projectKey = 'project'; chat.chatAttachments = new Map();
  assert.equal(chat.select('foreign-id'), false); assert.equal(chat.activeId, 'one');
});
test('export command writes the complete selected project conversation and rejects foreign records', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-export-'));
  try {
    const file = path.join(root, 'export.md'), chat = fixture();
    chat.chats[0].messages = Array.from({ length: 300 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'QA message ' + i }));
    chat.chats[0].tasks = [{ turn: 1, status: 'failed', title: 'QA command', output: 'QA task output' }];
    vscode.Uri = { file: file => ({ fsPath: file }) };
    vscode.window.showQuickPick = async () => [{ kind: 'tasks' }, { kind: 'draft' }];
    vscode.window.showSaveDialog = async () => ({ fsPath: file });
    vscode.workspace.fs = { writeFile: async (uri, buffer) => fs.writeFileSync(uri.fsPath, buffer) };
    vscode.workspace.openTextDocument = async uri => uri;
    vscode.window.showTextDocument = async () => {};
    await chat.exportChat(); const output = fs.readFileSync(file, 'utf8');
    assert.ok(output.includes('QA message 0')); assert.ok(output.includes('QA message 299')); assert.ok(output.includes('QA task output')); assert.ok(output.includes('未发送草稿'));
    chat.chats[0].projectKey = 'another-project'; vscode.window.showSaveDialog = async () => { throw new Error('Foreign export must never show a save dialog'); };
    await chat.exportChat(); assert.equal(fs.readFileSync(file, 'utf8'), output);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('old checkpoints restore in order, reject later edits and support explicit redo', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-restore-'));
  try {
    const file = path.join(root, 'a.txt'), chat = fixture(); chat.project = root;
    chat.checkpointStore = new (require('../builtin/checkpoints.cjs').Checkpoints)(path.join(root, 'cache'), root, 'project');
    const first = chat.checkpointStore.create([{ path: file, before: 'A\r\n', after: 'B\r\n' }], 1);
    const second = chat.checkpointStore.create([{ path: file, before: 'B\r\n', after: 'C\r\n' }], 2);
    chat.chats[0].checkpoints = [first, second]; fs.writeFileSync(file, 'C\r\n');
    vscode.workspace.textDocuments = [];
    vscode.Uri = { file: value => ({ fsPath: value, scheme: 'file' }) };
    let complete;
    vscode.workspace.fs = { writeFile: async (uri, data) => { await new Promise(resolve => { complete = resolve; }); fs.writeFileSync(uri.fsPath, data); } };
    chat.selectCheckpoint(first.id); await assert.rejects(chat.revert(file), /后续修改/);
    chat.selectCheckpoint(second.id); const restoring = chat.revert(file); await Promise.resolve();
    assert.equal(chat.reviewBusy, true); chat.selectCheckpoint(first.id); assert.equal(chat.activeCheckpointId, second.id);
    complete(); await restoring; assert.equal(fs.readFileSync(file, 'utf8'), 'B\r\n'); assert.equal(second.changes[0].status, 'reverted');
    vscode.workspace.fs.writeFile = async (uri, data) => fs.writeFileSync(uri.fsPath, data);
    chat.selectCheckpoint(first.id); await chat.revert(file); assert.equal(fs.readFileSync(file, 'utf8'), 'A\r\n');
    await chat.revert(file, true); assert.equal(fs.readFileSync(file, 'utf8'), 'B\r\n'); assert.equal(first.changes[0].status, 'pending');
    vscode.workspace.textDocuments = [{ uri: vscode.Uri.file(file), isDirty: true }];
    await assert.rejects(chat.revert(file), /未保存/); vscode.workspace.textDocuments = [];
    fs.writeFileSync(file, 'manual edit'); await assert.rejects(chat.revert(file), /后续修改/);
    assert.equal(chat.reviewBusy, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('manual cache cleanup retains backup and conflict recovery references', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-cleanup-'));
  try {
    const chat = fixture(); chat.project = root; chat.data = root; chat.stateFile = path.join(root, 'project.json');
    chat.checkpointStore = new (require('../builtin/checkpoints.cjs').Checkpoints)(path.join(root, 'cache'), root, 'project');
    const records = ['backup', 'conflict', 'unused'].map(text => chat.checkpointStore.create([{ path: path.join(root, text), before: null, after: text }]));
    for (const record of records) { const time = new Date(Date.now() - 120000); fs.utimesSync(path.join(chat.checkpointStore.blobs, record.changes[0].afterRef), time, time); }
    fs.writeFileSync(chat.stateFile, JSON.stringify({ projectKey: 'project', chats: [] }));
    fs.writeFileSync(chat.stateFile + '.bak', JSON.stringify({ projectKey: 'project', chats: [{ checkpoints: [records[0]] }] }));
    fs.writeFileSync(chat.stateFile + '.conflict-qa.json', JSON.stringify({ projectKey: 'project', chats: [{ checkpoints: [records[1]] }] }));
    vscode.window.showInformationMessage = () => {};
    chat.cleanupCheckpoints(); assert.equal(chat.checkpointStore.get(records[0].changes[0].afterRef), 'backup'); assert.equal(chat.checkpointStore.get(records[1].changes[0].afterRef), 'conflict');
    assert.throws(() => chat.checkpointStore.get(records[2].changes[0].afterRef), /缺失/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('approval rejects foreign turns and replies to original bridge after a connection changes', async () => {
  const chat = fixture(), replies = [], newReplies = []; chat.busy = true; chat.turnId = 'current'; chat.bridge = { reply: (id, result) => replies.push(result), send: () => {} };
  const request = { id: 1, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', turnId: 'current', command: 'fixture' } };
  vscode.window.showWarningMessage = () => { throw new Error('Foreign request must not open a prompt'); };
  await chat.approve({ ...request, params: { ...request.params, threadId: 'foreign' } }); await chat.approve({ ...request, params: { ...request.params, turnId: 'old' } }); assert.deepEqual(replies, [{ decision: 'decline' }, { decision: 'decline' }]);
  let resolve, prompts = 0; vscode.window.showWarningMessage = () => { prompts++; return new Promise(done => { resolve = done; }); };
  const origin = chat.bridge, pending = chat.approve(request, origin); await chat.approve(request, origin); assert.equal(prompts, 1);
  chat.bridge = { reply: (id, result) => newReplies.push(result) }; resolve('允许此次'); await pending;
  assert.deepEqual(replies.at(-1), { decision: 'decline' }); assert.deepEqual(newReplies, []);
});

test('resolved Agent questions cancel native prompt and never send duplicate answers', async () => {
  const chat = fixture(), replies = []; chat.busy = true; chat.turnId = 'current'; chat.bridge = { reply: (id, result) => replies.push(result), send: () => {} };
  const request = { id: 'input', method: 'item/tool/requestUserInput', params: { threadId: 'thread', turnId: 'current', questions: [{ id: 'a', header: 'A', question: 'Choose', options: [{ label: 'A', description: 'First' }] }] } };
  vscode.window.showQuickPick = (items, options, token) => new Promise(resolve => { token.onCancellationRequested(() => resolve(undefined)); });
  const pending = chat.approve(request); chat.onNotification({ method: 'serverRequest/resolved', params: { requestId: 'input', threadId: 'thread' } }); await pending;
  assert.deepEqual(replies, []); assert.equal(chat.pendingRequests.size, 0); assert.equal(chat.messages.length, 0);
});

test('late events cannot finish newer turns or append messages to idle conversations', () => {
  const chat = fixture(); chat.busy = true; chat.turnId = 'new'; chat.tasks = []; chat.currentTaskTurn = 2;
  chat.onNotification({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'old', status: 'completed' } } }); assert.equal(chat.busy, true);
  chat.onNotification({ method: 'item/agentMessage/delta', params: { threadId: 'foreign', turnId: 'new', itemId: 'item', delta: 'foreign' } }); assert.equal(chat.messages.length, 0);
  chat.onNotification({ method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'new', itemId: 'item', delta: 'current' } }); assert.equal(chat.messages[0].text, 'current');
  chat.onNotification({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'new', status: 'completed' } } }); assert.equal(chat.busy, false);
  chat.onNotification({ method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'new', itemId: 'item', delta: 'late' } }); assert.equal(chat.messages[0].text, 'current');
  chat.busy = true; chat.turnId = null;
  chat.onNotification({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'new' } } }); assert.equal(chat.turnId, null);
  chat.onNotification({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'next' } } }); assert.equal(chat.turnId, 'next');
});

test('terminal errors retain partial file checkpoints and mark unfinished tasks failed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-failed-turn-'));
  try {
    const file = path.join(root, 'a.txt'), chat = fixture(); chat.project = root; chat.busy = true; chat.turnId = 'turn'; chat.currentTaskTurn = 1;
    chat.checkpointStore = new (require('../builtin/checkpoints.cjs').Checkpoints)(path.join(root, 'cache'), root, 'project');
    fs.writeFileSync(file, 'before'); chat.baseline = require('../builtin/review.cjs').snapshot(root); fs.writeFileSync(file, 'partial edit'); chat.candidates = new Map([[file, 'update']]);
    chat.tasks = [{ id: 'command', turnId: 'turn', status: 'running' }];
    chat.onNotification({ method: 'error', params: { threadId: 'thread', turnId: 'turn', willRetry: false, error: { message: 'fixture disconnection' } } });
    assert.equal(chat.busy, false); assert.equal(chat.tasks[0].status, 'failed'); assert.equal(chat.chats[0].checkpoints.length, 1); assert.equal(chat.checkpointStore.materialize(chat.changes[0]).after, 'partial edit'); assert.equal(chat.baseline, null);
    chat.onNotification({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } }); assert.equal(chat.chats[0].checkpoints.length, 1); assert.equal(chat.status, 'fixture disconnection');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('same text retyped after submission and next attachments survive late acknowledgment', async () => {
  const chat = fixture(); let complete;
  chat.attachments = [{ id: 'sent', label: 'sent', text: 'fixture' }];
  chat.connect = async () => ({ call: () => new Promise(resolve => { complete = resolve; }) });
  const pending = chat.send('submitted', 'ask', false, 'client-one'); await Promise.resolve(); await Promise.resolve();
  chat.persistDraft('one', 'changed'); chat.persistDraft('one', 'submitted'); chat.attachments.push({ id: 'next', label: 'next', text: 'next fixture' });
  complete({ turn: { id: 'turn' } }); await pending;
  assert.equal(chat.chats[0].draft, 'submitted'); assert.deepEqual(chat.attachments.map(a => a.id), ['next']);
});

test('old RPC acknowledgment cannot overwrite a newer active turn', async () => {
  const chat = fixture(), complete = [], acknowledgments = []; chat.tasks = [];
  chat.view.webview.postMessage = value => { if (value.type === 'sent') acknowledgments.push(value.clientSendId); };
  chat.connect = async () => ({ call: () => new Promise(resolve => complete.push(resolve)) });
  const first = chat.send('submitted', 'ask', false, 'first'); await Promise.resolve(); await Promise.resolve();
  chat.onNotification({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'first-turn' } } }); assert.deepEqual(acknowledgments, ['first']);
  chat.onNotification({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'first-turn', status: 'completed' } } });
  chat.persistDraft('one', 'next'); const second = chat.send('next', 'ask', false, 'second'); await Promise.resolve(); await Promise.resolve();
  chat.onNotification({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'second-turn' } } }); chat.persistDraft('one', 'later draft');
  complete[0]({ turn: { id: 'first-turn' } }); await first; assert.equal(chat.turnId, 'second-turn'); assert.equal(chat.busy, true); assert.equal(chat.chats[0].draft, 'later draft');
  complete[1]({ turn: { id: 'second-turn' } }); await second; assert.deepEqual(acknowledgments, ['first', 'second']); assert.equal(chat.chats[0].draft, 'later draft');
});

test('cancel during thread lookup starts no turn and confirmation timeout preserves running task', async () => {
  const chat = fixture(); chat.resumed = false; let lookup, turnCalls = 0;
  chat.connect = async () => ({ call: method => { if (method === 'thread/read') return new Promise(resolve => { lookup = resolve; }); turnCalls++; throw new Error('No turn may start'); } });
  const canceled = chat.send('submitted', 'ask', false); await Promise.resolve(); await Promise.resolve(); chat.cancelPendingSend = true; lookup({ thread: { cwd: chat.project } });
  await assert.rejects(canceled, /已取消/); assert.equal(turnCalls, 0); assert.equal(chat.busy, false);
  chat.resumed = true; let reject;
  chat.connect = async () => ({ call: () => new Promise((resolve, failed) => { reject = failed; }) });
  const running = chat.send('submitted', 'ask', false); await Promise.resolve(); await Promise.resolve();
  chat.onNotification({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'running' } } }); reject(new Error('RPC timeout')); await running;
  assert.equal(chat.busy, true); assert.equal(chat.turnId, 'running'); assert.equal(chat.status, '任务已启动，等待后续状态');
});

test('old RPC failure leaves newer send state intact', async () => {
  const chat = fixture(); let rejectFirst, resolveSecond, calls = 0; chat.tasks = [];
  chat.connect = async () => ({ call: () => ++calls === 1 ? new Promise((resolve, reject) => { rejectFirst = reject; }) : new Promise(resolve => { resolveSecond = resolve; }) });
  const first = chat.send('submitted', 'ask', false); await Promise.resolve(); await Promise.resolve();
  chat.onNotification({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'first', status: 'completed' } } });
  chat.persistDraft('one', 'next'); const second = chat.send('next', 'ask', false); await Promise.resolve(); await Promise.resolve();
  rejectFirst(new Error('old RPC failure')); await first; assert.equal(chat.busy, true); assert.equal(chat.status, '正在思考');
  resolveSecond({ turn: { id: 'second' } }); await second; assert.equal(chat.turnId, 'second');
});

test('long Cursor import confirmation keeps conversation locked and cancellation preserves source', async () => {
  const chat = fixture(); chat.chats[0].source = 'cursor'; chat.chats[0].messages = [{ role: 'user', text: 'x'.repeat(200000) }]; let answer, calls = 0;
  chat.connect = async () => ({ call: async () => { calls++; throw new Error('No turn should start'); } });
  vscode.window.showWarningMessage = () => new Promise(resolve => { answer = resolve; });
  const pending = chat.send('submitted', 'ask', false); await Promise.resolve(); await Promise.resolve();
  assert.equal(chat.busy, true); chat.newChat(); assert.equal(chat.activeId, 'one'); answer(undefined); await pending;
  assert.equal(chat.busy, false); assert.equal(calls, 0); assert.equal(chat.chats.length, 1); assert.equal(chat.chats[0].source, 'cursor'); assert.equal(chat.chats[0].draft, 'submitted');
});

test('project login cannot connect during a running task and disposal invalidates pending prompts', async () => {
  const chat = fixture(); chat.busy = true; chat.connect = () => { throw new Error('No login connection allowed'); };
  await assert.rejects(chat.login(), /当前任务/);
  let canceled = false, disposed = 0;
  chat.pendingRequests = new Map([['request', { resolved: false, token: { cancel: () => { canceled = true; } } }]]); chat.bridge = { dispose: () => { disposed++; } };
  chat.dispose(); assert.equal(chat.invalidated, true); assert.equal(canceled, true); assert.equal(chat.pendingRequests.get('request').resolved, true); assert.equal(disposed, 1);
});

test('stream bursts coalesce state snapshots and final message flushes pending updates immediately', async () => {
  const chat = fixture(), snapshots = []; chat.post = Chat.prototype.post; chat.busy = true; chat.turnId = 'stream'; chat.tasks = [];
  chat.view.webview.postMessage = state => snapshots.push(state);
  for (let i = 0; i < 100; i++) chat.onNotification({ method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'stream', itemId: 'message', delta: 'x' } });
  assert.equal(snapshots.length, 0); await new Promise(resolve => setTimeout(resolve, 90)); assert.equal(snapshots.length, 1); assert.equal(snapshots[0].messages[0].text.length, 100);
  chat.onNotification({ method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'stream', itemId: 'message', delta: 'pending' } });
  chat.onNotification({ method: 'item/completed', params: { threadId: 'thread', turnId: 'stream', item: { id: 'message', type: 'agentMessage', text: 'final' } } });
  assert.equal(snapshots.length, 2); assert.equal(snapshots.at(-1).messages[0].text, 'final'); await new Promise(resolve => setTimeout(resolve, 90)); assert.equal(snapshots.length, 2); assert.equal(chat.postTimer, null);
});

test('stream patches exclude old history and fall back to full state after a conversation changes', () => {
  const chat = fixture(), snapshots = []; chat.post = Chat.prototype.post; chat.view.webview.postMessage = value => snapshots.push(value);
  chat.messages.push(...Array.from({ length: 2000 }, (_, i) => ({ role: 'user', text: 'old ' + i }))); chat.post();
  const revision = snapshots[0].revision; chat.messages.push({ role: 'assistant', text: 'streamed' }); chat.streamUpdates = new Set([2000]); chat.postStream();
  assert.equal(snapshots[1].type, 'stream'); assert.equal(snapshots[1].revision, revision); assert.equal(snapshots[1].messages.length, 1); assert.equal(snapshots[1].messageCount, 2001); assert.equal(snapshots[1].messages[0].index, 2000); assert.ok(JSON.stringify(snapshots[1]).length < 400);
  chat.activeId = 'changed'; chat.postStream(); assert.equal(snapshots[2].type, 'state'); assert.ok(snapshots[2].revision > revision);
});

test('history flags are project scoped, persisted for imported chats and rollback on save failure',()=>{
 const chat=fixture(),own=chat.chats[0];chat.closeTab=id=>{chat.closed=id;};chat.setHistoryFlag('foreign','pinned',true);assert.equal(own.pinned,undefined);chat.setHistoryFlag('one','pinned',true);assert.equal(own.pinned,true);
 own.source='cursor';own.queue=[{text:'pending'}];chat.setHistoryFlag('one','archived',true);assert.equal(chat.closed,'one');assert.equal(own.queuePaused,true);assert.equal(chat.cursorChatMetadata.one.archived,true);chat.setHistoryFlag('one','archived',false);assert.equal(chat.cursorChatMetadata.one.archived,false);assert.equal(own.queuePaused,true);
 chat.save=()=>false;chat.setHistoryFlag('one','pinned',false);assert.equal(own.pinned,true);assert.equal(chat.cursorChatMetadata.one.pinned,true);chat.busy=true;chat.setHistoryFlag('one','pinned',false);assert.equal(own.pinned,true);
});
test('rename and delete target chosen history without switching current chat',async()=>{
 const chat=fixture(),other={id:'two',projectKey:'project',name:'old',source:'cursor',messages:[]};chat.chats.push(other);chat.hiddenCursorIds=[];const saved={input:vscode.window.showInputBox,warning:vscode.window.showWarningMessage};
 try{vscode.window.showInputBox=async()=> 'Renamed';await chat.renameChat('two');assert.equal(other.name,'Renamed');assert.equal(chat.cursorChatMetadata.two.name,'Renamed');assert.equal(chat.activeId,'one');vscode.window.showWarningMessage=async()=> '确认';await chat.deleteChat('two');assert.equal(chat.activeId,'one');assert.equal(chat.chats.length,1);assert.deepEqual(chat.hiddenCursorIds,['two']);assert.equal(chat.cursorChatMetadata.two,undefined);}finally{vscode.window.showInputBox=saved.input;vscode.window.showWarningMessage=saved.warning;}
});
test('code review Keep persists and group Undo checks every file before writing',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gptide-group-undo-'));
 const prior={fs:vscode.workspace.fs,documents:vscode.workspace.textDocuments,uri:vscode.Uri};
 try{
  const chat=fixture();chat.project=root;chat.streamRevision=3;chat.activeCheckpointId='cp';
  const first=path.join(root,'a.txt'),second=path.join(root,'b.txt');
  chat.changes=[{path:first,relative:'a.txt',before:'A',after:'B',status:'pending'},{path:second,relative:'b.txt',before:null,after:'new',status:'pending'}];
  fs.writeFileSync(first,'B');fs.writeFileSync(second,'manual');vscode.workspace.textDocuments=[];vscode.Uri={file:fsPath=>({fsPath,scheme:'file'})};
  let writes=0;vscode.workspace.fs={writeFile:async(uri,data)=>{writes++;assert.equal(chat.reviewBusy,true);fs.writeFileSync(uri.fsPath,data);},delete:async uri=>{writes++;fs.unlinkSync(uri.fsPath);}};
  await chat.reviewAction('undo','one','cp',2);assert.equal(writes,0);
  await assert.rejects(chat.reviewAction('undo','one','cp',3),/后续修改/);assert.equal(writes,0);assert.equal(fs.readFileSync(first,'utf8'),'B');
  fs.writeFileSync(second,'new');vscode.workspace.textDocuments=[{uri:vscode.Uri.file(second),isDirty:true}];await assert.rejects(chat.reviewAction('undo','one','cp',3),/未保存/);assert.equal(writes,0);
  vscode.workspace.textDocuments=[];await chat.reviewAction('undo','one','cp',3);assert.equal(writes,2);assert.equal(fs.readFileSync(first,'utf8'),'A');assert.equal(fs.existsSync(second),false);assert.ok(chat.changes.every(c=>c.status==='reverted'));assert.equal(chat.reviewBusy,false);
  chat.changes.forEach(c=>c.status='pending');chat.save=()=>false;await chat.reviewAction('keep','one','cp',3);assert.ok(chat.changes.every(c=>c.status==='pending'));chat.save=()=>true;await chat.reviewAction('keep','one','cp',3);assert.ok(chat.changes.every(c=>c.status==='accepted'));await chat.reviewAction('undo','one','cp',3);assert.equal(writes,2);
 }finally{vscode.workspace.fs=prior.fs;vscode.workspace.textDocuments=prior.documents;vscode.Uri=prior.uri;fs.rmSync(root,{recursive:true,force:true});}
});

test('simple file decisions reject stale scope and preserve pending state after failed acceptance',async()=>{
 const chat=fixture();chat.streamRevision=1;chat.activeCheckpointId='cp';chat.changes=[{path:'file',relative:'file',status:'pending'}];const msg={id:'one',checkpointId:'cp',revision:1,path:'file',action:'accept'};
 await chat.reviewDecision({...msg,id:'foreign'});await chat.reviewDecision({...msg,revision:0});assert.equal(chat.changes[0].status,'pending');chat.save=()=>false;await chat.reviewDecision(msg);assert.equal(chat.changes[0].status,'pending');chat.save=()=>true;await chat.reviewDecision(msg);assert.equal(chat.changes[0].status,'accepted');let rejected=0;chat.revert=async()=>rejected++;await chat.reviewDecision({...msg,action:'reject'});assert.equal(rejected,0);chat.changes[0].status='pending';await chat.reviewDecision({...msg,action:'reject'});assert.equal(rejected,1);
});

test('offline presets save safely and Fast selection requires catalog support with rollback and locks',()=>{
 const chat=fixture();chat.chooseModel('arbitrary');assert.equal(chat.model,'fixture');chat.chooseModel('gpt-6.1-sol');assert.equal(chat.model,'gpt-6.1-sol');assert.equal(chat.serviceTier,'default');chat.chooseServiceTier('fast');assert.equal(chat.serviceTier,'default');
 chat.models=[{model:'gpt-6.1-sol',serviceTiers:[{id:'fast'}]},{model:'other',serviceTiers:[]}];chat.chooseServiceTier('fast');assert.equal(chat.serviceTier,'fast');chat.busy=true;chat.chooseServiceTier('default');assert.equal(chat.serviceTier,'fast');chat.busy=false;chat.save=()=>false;chat.chooseServiceTier('default');assert.equal(chat.serviceTier,'fast');chat.chooseModel('other');assert.equal(chat.model,'gpt-6.1-sol');assert.equal(chat.serviceTier,'fast');chat.save=()=>true;chat.chooseModel('other');assert.equal(chat.serviceTier,'default');chat.chooseModel('gpt-6-luna');assert.equal(chat.model,'other');
});
test('thread and turn requests carry explicit standard or supported Fast tier',async()=>{
 for(const [requested,supported,expected] of [['fast',true,'fast'],['default',true,'default'],['fast',false,'default']]){
  const chat=fixture(),calls=[];chat.threadId=null;chat.resumed=false;chat.serviceTier=requested;chat.approvalMode=supported?'auto_review':'user';chat.models=[{model:'fixture',serviceTiers:supported?[{id:'fast'}]:[]}];
  chat.connect=async()=>({call:async(method,params)=>{calls.push({method,params});return method==='thread/start'?{thread:{id:'tier-fixture'}}:{turn:{id:'tier-turn'}};}});
  await chat.send('offline tier fixture','ask',false);assert.deepEqual(calls.map(c=>c.method),['thread/start','turn/start']);assert.ok(calls.every(c=>c.params.serviceTier===expected));assert.ok(calls.every(c=>c.params.approvalPolicy==='on-request'&&c.params.approvalsReviewer===(supported?'auto_review':'user')));
 }
});

test('approval picker uses interactive policy and actual reviewer, validates choices and rolls back failed saves',()=>{const chat=fixture();chat.chooseApprovalMode('never');assert.equal(chat.approvalMode,undefined);chat.chooseApprovalMode('auto_review');assert.deepEqual(chat.approvalSettings(),{approvalPolicy:'on-request',approvalsReviewer:'auto_review'});chat.busy=true;chat.chooseApprovalMode('user');assert.equal(chat.approvalMode,'auto_review');chat.busy=false;chat.save=()=>false;chat.chooseApprovalMode('user');assert.equal(chat.approvalMode,'auto_review');chat.save=()=>true;chat.chooseApprovalMode('user');assert.deepEqual(chat.approvalSettings(),{approvalPolicy:'on-request',approvalsReviewer:'user'});});
