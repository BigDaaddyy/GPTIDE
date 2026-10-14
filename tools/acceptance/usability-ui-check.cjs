const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const env = require('../acceptance-env.cjs'), { pathToFileURL } = require('node:url');
(async () => {
  const read = name => fs.readFileSync(path.join(env.root, 'builtin', name), 'utf8'), nonce = 'usability-nonce';
  let html = read('view.html').replace('__STYLE__', () => ':root{--vscode-foreground:#20232b;--vscode-font-family:"Segoe UI";--vscode-sideBar-background:#f8f9fb;--vscode-focusBorder:#5e6ad2;--vscode-input-background:#fff;--vscode-errorForeground:#b42318}' + read('view.css')).replace('__MARKDOWN__', () => read('markdown.cjs')).replace('__FIND__', () => read('find.cjs')).replace('__ACTIONS__', () => read('quick-actions.cjs')).replace('__SCRIPT__', () => read('view.js')).replaceAll('__NONCE__', nonce).replaceAll('__PROJECT_KEY__', 'qa');
  html = html.replace('<script nonce="' + nonce + '">', '<script nonce="' + nonce + '">window.qaMessages=[];window.acquireVsCodeApi=()=>({getState:()=>({}),setState:()=>{},postMessage:m=>qaMessages.push(m)});');
  const file = path.join(env.artifacts, 'usability.html'); fs.writeFileSync(file, html);
  const browser = await env.playwright.chromium.launch(env.chromiumOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } }); await page.goto(pathToFileURL(file).href);
    const state = { type: 'state', revision: 1, projectKey: 'qa', project: 'C:/qa/很长的项目名称', activeId: 'a', openChatIds: ['a','b'], chats: [{ id: 'a', name: '当前项目对话', source: 'gptide' }, { id: 'b', name: '另外一个对话', source: 'gptide' }], history: [{ id: 'a', name: '当前项目对话', source: 'gptide' }], source: 'gptide', preferences: { autoConnect: false }, models: [], messages: [{ role: 'user', text: 'long/path/'.repeat(30) }, { role: 'assistant', text: '```js\n' + 'const name = "long";'.repeat(50) + '\n```' }], tasks: [], changes: [], attachments: [], draft: '', busy: false, status: '未连接 · 发送时连接' };
    const publish = async extra => page.evaluate(s => window.dispatchEvent(new MessageEvent('message', { data: s })), { ...state, ...extra }); await publish();
    await page.locator('#history').click();await publish({focusRequestId:'focus-qa'});assert.equal(await page.evaluate(()=>document.activeElement.id),'input');assert.ok(await page.locator('#history-panel').isHidden());assert.ok(await page.evaluate(()=>qaMessages.some(m=>m.type==='focusHandled'&&m.id==='focus-qa')));
    await publish({ account:{type:'chatgpt',plan:'plus'},connected:false,model:'gpt-6.1-sol',effort:'medium' }); assert.equal(await page.locator('#connection').getAttribute('class'),'connection'); assert.ok((await page.locator('#model').innerText()).includes('默认 6.1 sol')); assert.equal(await page.locator('#effort').innerText(),'均衡');
    await publish({ account:{type:'chatgpt',plan:'plus'},connected:true }); assert.ok((await page.locator('#connection').getAttribute('class')).includes('connected')); await publish();
    await page.locator('#more').click(); assert.equal(await page.locator('#more').getAttribute('aria-expanded'), 'true'); await page.keyboard.press('End'); assert.equal(await page.evaluate(() => document.activeElement.id), 'delete');
    await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.activeElement.id), 'more');
    await page.locator('#history').click(); assert.equal(await page.evaluate(() => document.activeElement.id), 'history-search'); await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.activeElement.id), 'history');
    await publish({ loginPending: true, canCancelLogin:true, operationLocked: true, status: '请在浏览器完成 ChatGPT 登录' });
    await page.locator('#cancel-login').click();assert.equal(await page.evaluate(()=>qaMessages.at(-1).type),'cancelLogin');
    assert.ok(await page.locator('#send').isDisabled()); assert.ok(await page.locator('.chat-tab-name').first().isDisabled()); assert.ok(await page.locator('#input').isEnabled());
    await page.locator('#more').click(); assert.ok(await page.locator('#login').isDisabled()); assert.ok(await page.locator('#delete').isDisabled()); await page.keyboard.press('Escape');
    await publish({ inlineBusy: true, operationLocked: true }); assert.ok(await page.locator('.branch-message').first().isDisabled()); assert.ok(await page.locator('#new').isDisabled());
    await publish(); await page.locator('#input').fill('preserve draft'); await page.locator('#send').click();
    const send = await page.evaluate(() => qaMessages.findLast(m => m.type === 'send')); await publish({ inlineBusy: true, operationLocked: true });
    await page.evaluate(id => window.dispatchEvent(new MessageEvent('message', { data: { type: 'sendRejected', projectKey: 'qa', clientSendId: id } })), send.clientSendId); assert.ok(await page.locator('#send').isDisabled()); assert.equal(await page.locator('#input').inputValue(), 'preserve draft');
    for (const width of [260,320,390]) {
      await page.setViewportSize({ width, height: 500 });
      await publish({ warning: '目录无法读取，请调整引用后重试。'.repeat(300), lastOutcome: 'failed', canRestore: true, queue: Array.from({ length: 10 }, (_, i) => ({ id: String(i), text: '待执行的开发任务'.repeat(20), mode: 'ask', status: 'pending' })), queuePaused: true, attachments: Array.from({ length: 20 }, (_, i) => ({ id: String(i), label: 'src/very-long-file-name-' + i + '.js' })), tasks: [{ id: 't', turnId: 'turn', turn: 1, kind: 'command', status: 'failed', title: 'npm test', output: 'error output'.repeat(500) }], changes: [{ path: 'C:/qa/a.js', relative: 'src/long-file-name.js', before: 'before', after: 'after', status: 'pending' }] });
      await page.locator('#queue-panel').evaluate(e => e.open = true); await page.locator('#task-panel').evaluate(e => e.open = true); await page.locator('#input').fill('multiline\n'.repeat(30));
      const metrics = await page.evaluate(() => { const input = document.querySelector('#input').getBoundingClientRect(), send = document.querySelector('#send').getBoundingClientRect(); return { width: innerWidth, height: innerHeight, input: { top: input.top, bottom: input.bottom }, send: { left: send.left, right: send.right, bottom: send.bottom }, overflow: document.documentElement.scrollWidth - innerWidth }; });
      assert.ok(metrics.send.right <= width && metrics.send.left >= 0 && metrics.send.bottom <= 500, JSON.stringify(metrics)); assert.ok(metrics.input.top >= 0 && metrics.input.bottom <= 500, JSON.stringify(metrics)); assert.equal(metrics.overflow, 0);
      await page.screenshot({ path: path.join(env.artifacts, 'usability-' + width + '.png') });
      await page.locator('#more').click(); await page.locator('#menu').evaluate(e => e.scrollTop = e.scrollHeight); assert.ok(await page.locator('#delete').isVisible()); await page.keyboard.press('Escape');
    }
    console.log('Keyboard focus, login/inline locks, draft protection and compact 260/320/390px layouts with expanded auxiliary content passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
