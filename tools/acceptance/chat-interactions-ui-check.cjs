const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const env = require('../acceptance-env.cjs'), { pathToFileURL } = require('node:url');
(async () => {
  const read = name => fs.readFileSync(path.join(env.root, 'builtin', name), 'utf8'), nonce = 'interaction-qa';
  let html = read('view.html').replace('__STYLE__', () => ':root{--vscode-foreground:#20232b;--vscode-font-family:"Segoe UI";--vscode-sideBar-background:#f8f9fb;--vscode-input-background:#fff;--vscode-focusBorder:#5e6ad2}' + read('view.css'));
  for (const [token, file] of [['MARKDOWN','markdown.cjs'],['CODE','code.cjs'],['FIND','find.cjs'],['ACTIONS','quick-actions.cjs'],['SCRIPT','view.js']]) html = html.replace('__'+token+'__', () => read(file));
  html = html.replaceAll('__NONCE__', nonce).replaceAll('__PROJECT_KEY__', 'qa').replace('<script nonce="'+nonce+'">', '<script nonce="'+nonce+'">window.qaMessages=[];window.acquireVsCodeApi=()=>({getState:()=>({}),setState:()=>{},postMessage:m=>qaMessages.push(m)});');
  const file = path.join(env.artifacts, 'chat-interactions.html'); fs.writeFileSync(file, html);
  const browser = await env.playwright.chromium.launch(env.chromiumOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } }), errors = []; page.on('pageerror', error => errors.push(error.message)); await page.goto(pathToFileURL(file).href);
    const state = { type:'state', revision:1, projectKey:'qa', project:'C:/qa', activeId:'chat', openChatIds:['chat'], chats:[{id:'chat',name:'开发任务',source:'gptide'}], history:[], source:'gptide', messages:Array.from({length:240},(_,i)=>({role:i%2?'assistant':'user',text:i===0?'old-message-marker':'message '+i+'\n\n'+ '开发进度说明。'.repeat(12)})), tasks:[], changes:[], attachments:[], models:[], preferences:{submitKey:'enter'}, draft:'', busy:false, status:'未连接' };
    const publish = async extra => { Object.assign(state, extra); await page.evaluate(data => window.dispatchEvent(new MessageEvent('message',{data})), state); };
    const latest = () => page.locator('#messages').evaluate(e => e.scrollHeight-e.scrollTop-e.clientHeight<3);
    await publish(); await page.locator('#messages').evaluate(e=>e.scrollTop=0); assert.equal(await latest(),false);
    await page.locator('#input').fill('新任务'); await page.locator('#send').click(); assert.equal(await latest(),true);
    let sent = await page.evaluate(()=>qaMessages.findLast(m=>m.type==='send')); assert.equal(sent.text,'新任务');
    await page.evaluate(m=>window.dispatchEvent(new MessageEvent('message',{data:{type:'sent',projectKey:'qa',id:'chat',clientSendId:m.clientSendId}})),sent);
    // Search moves the virtualized window away from the latest messages.
    await page.locator('#more').click(); await page.locator('#find').click(); await page.locator('#find-query').fill('old-message-marker'); await page.waitForTimeout(350);
    assert.ok((await page.locator('.message').first().innerText()).includes('old-message-marker'));
    await page.locator('#find-close').click(); await page.locator('#input').fill('回到最新'); await page.locator('#send').click();
    assert.equal(await latest(),true); assert.ok((await page.locator('.message').last().innerText()).includes('239'));
    sent=await page.evaluate(()=>qaMessages.findLast(m=>m.type==='send'));
    await page.evaluate(m=>window.dispatchEvent(new MessageEvent('message',{data:{type:'sent',projectKey:'qa',id:'chat',clientSendId:m.clientSendId}})),sent);
    await publish({busy:true,canSteer:true,operationLocked:true});
    await page.locator('#input').fill('改为优先修复布局'); assert.equal(await page.locator('#send').getAttribute('aria-label'),'追加到当前任务');
    await page.locator('#input').press('Enter'); sent=await page.evaluate(()=>qaMessages.findLast(m=>m.type==='steer')); assert.equal(sent.text,'改为优先修复布局');
    await page.locator('#stop').click(); assert.equal(await page.evaluate(()=>qaMessages.at(-1).type),'stop');
    await page.evaluate(m=>window.dispatchEvent(new MessageEvent('message',{data:{type:'sent',projectKey:'qa',id:'chat',clientSendId:m.clientSendId}})),sent);
    await page.locator('#input').fill('稍后执行'); await page.locator('#enqueue').click(); const queued=await page.evaluate(()=>qaMessages.findLast(m=>m.type==='enqueue')); assert.equal(queued.text,'稍后执行');
    await page.evaluate(m=>window.dispatchEvent(new MessageEvent('message',{data:{type:'queued',projectKey:'qa',id:'chat',clientSendId:m.clientSendId}})),queued);
    const formatted='## 实施结果\n\n**重点：`view.js`** 与 __另一重点__\n\n*斜体说明*，~~旧方案~~，变量 foo_bar_baz。\n\n- **已修复**：展开面板重叠\n- `npm test` 验证通过\n\n<img src=x onerror=alert(1)>';
    await publish({messages:[{role:'user',text:'优化聊天体验'},{role:'assistant',text:formatted}],tasks:Array.from({length:8},(_,i)=>({id:'t'+i,turnId:'t',turn:1,kind:'command',status:'running',title:'检查步骤 '+i,output:'long output\n'.repeat(50)})),changes:[{path:'C:/qa/view.js',relative:'view.js',status:'pending',added:12,removed:3}]});
    assert.equal(await page.locator('.assistant .content strong').count(),3); assert.equal(await page.locator('.assistant strong code').innerText(),'view.js'); assert.equal(await page.locator('.assistant em').innerText(),'斜体说明'); assert.equal(await page.locator('.assistant del').innerText(),'旧方案'); assert.equal(await page.locator('.content img').count(),0); assert.ok((await page.locator('.assistant .content').innerText()).includes('foo_bar_baz'));
    const strongStyle=await page.locator('.assistant strong').first().evaluate(e=>({weight:Number(getComputedStyle(e).fontWeight),color:getComputedStyle(e).color,parent:getComputedStyle(e.parentElement).color})); assert.ok(strongStyle.weight>=600); assert.notEqual(strongStyle.color,strongStyle.parent);
    for(const width of [260,390]){
      await page.setViewportSize({width,height:500}); await page.locator('#task-panel').evaluate(e=>e.open=true); await page.locator('.task-row').first().evaluate(e=>e.open=true); await page.locator('#input').fill('继续优化');
      const geometry=await page.evaluate(()=>{const panel=document.querySelector('#task-panel'),r=panel.getBoundingClientRect(),review=document.querySelector('#review-panel')||document.querySelector('.review'),send=document.querySelector('#send').getBoundingClientRect();return{bottom:r.bottom,next:review.getBoundingClientRect().top,scrollable:panel.scrollHeight>panel.clientHeight,overflow:getComputedStyle(panel).overflowY,right:send.right,sendBottom:send.bottom,width:document.documentElement.scrollWidth};});
      assert.ok(geometry.bottom<=geometry.next+1,JSON.stringify(geometry)); assert.equal(geometry.scrollable,true); assert.equal(geometry.overflow,'auto'); assert.ok(geometry.right<=width); assert.ok(geometry.sendBottom<=500); assert.equal(geometry.width,width);
      await page.screenshot({path:path.join(env.artifacts,'chat-interactions-'+width+'.png')});
    }
    assert.deepEqual(errors,[]); console.log('Steering/queue/stop, send scroll including search virtualization, task containment and safe rich text passed offline.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
