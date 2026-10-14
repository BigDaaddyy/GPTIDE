const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const env = require('../acceptance-env.cjs'), scope = require('../../builtin/project-scope.cjs'), { _electron } = env.playwright;
(async () => {
  const qa = path.join(env.artifacts, 'isolation-' + Date.now()); fs.mkdirSync(qa, { recursive: true });
  const projects = ['alpha','beta'].map(name => { const project = path.join(qa, name), user = path.join(qa, name + '-user'); fs.mkdirSync(project); fs.mkdirSync(path.join(user,'User'), { recursive: true });
    fs.writeFileSync(path.join(user,'User/settings.json'), JSON.stringify({ 'workbench.startupEditor': 'none', 'window.restoreWindows': 'none', 'gptide.connection.autoConnect': false, 'gptide.codexPath': path.join(qa,'disabled-codex.exe'), 'security.workspace.trust.enabled': false, 'git.openRepositoryInParentFolders': 'never' }));
    const key = scope.key(project), chat = { id: name, projectKey: key, source: 'gptide', name: name + ' only', messages: [{ role: 'user', text: name + ' PRIVATE QA' }], draft: name + ' DRAFT', tasks: [{ id: 't', turnId: 'old', turn: 1, kind: 'command', status: 'completed', title: name + ' TASK' }], queue: [require('../../builtin/message-queue.cjs').create(name + ' QUEUE','ask',[],key,name)] };
    fs.writeFileSync(path.join(env.root,'data/projects',key+'.json'), JSON.stringify({ projectKey:key, projectPath:project, activeId:name, openChatIds:[name], chats:[chat] })); return { name,project,user };
  });
  const launch = async (project,user) => { const processEnv = { ...process.env }; delete processEnv.ELECTRON_RUN_AS_NODE; return _electron.launch({ executablePath:path.join(env.root,'app/VSCodium.exe'), args:['--user-data-dir',user,'--extensions-dir',path.join(user,'extensions'),'--skip-welcome',project], env:processEnv }); };
  let app;
  try {
    for (const item of projects) {
      app = await launch(item.project,item.user); const page = await app.firstWindow(); await page.waitForSelector('.monaco-workbench'); let frame;
      for(let i=0;i<160&&!frame;i++){for(const f of page.frames())try{if(await f.locator('#input').count()&&await f.locator('#input').isVisible())frame=f;}catch{}if(!frame)await page.waitForTimeout(100);}
      assert.ok(frame); await frame.waitForFunction(()=>!document.querySelector('#input').disabled);
      assert.equal(await frame.locator('#input').inputValue(),item.name+' DRAFT'); assert.ok((await frame.locator('#messages').innerText()).includes(item.name+' PRIVATE QA'));
      await frame.locator('#history').click(); assert.ok((await frame.locator('#history-list').innerText()).includes(item.name+' only')); await page.keyboard.press('Escape');
      await frame.locator('#queue-panel').evaluate(e=>e.open=true); assert.ok((await frame.locator('#queue-list').innerText()).includes(item.name+' QUEUE'));
      const other = item.name==='alpha'?'beta':'alpha'; assert.ok(!(await frame.locator('body').innerText()).includes(other+' '));
      assert.ok((await frame.locator('#status').innerText()).includes('未连接')); await app.close(); app=null;
    }
    const workspace=path.join(qa,'multi.code-workspace'); fs.writeFileSync(workspace,JSON.stringify({folders:projects.map(p=>({path:p.project}))}));
    app=await launch(workspace,projects[0].user);const page=await app.firstWindow();await page.waitForSelector('.monaco-workbench');await page.waitForTimeout(1200);
    for(const frame of page.frames())assert.equal(await frame.locator('#input').count(),0,'Multi-root workspace must not bind a project chat');
    console.log('Independent project histories, drafts, queues and task markers never cross; multi-root workspace has no chat. Offline only.');
  } finally { if(app)await app.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
