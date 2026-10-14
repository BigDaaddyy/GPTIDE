const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron } = require('../acceptance-env.cjs').playwright;
(async () => {
  const root = require('../acceptance-env.cjs').root, qa = path.join(require('../acceptance-env.cjs').artifacts, 'queue-' + Date.now()), user = path.join(qa, 'user'), project = path.join(qa, 'project'); fs.mkdirSync(project, { recursive: true }); fs.mkdirSync(path.join(user, 'User'), { recursive: true });
  fs.writeFileSync(path.join(user, 'User/settings.json'), JSON.stringify({ 'workbench.startupEditor': 'none', 'window.restoreWindows': 'none', 'gptide.connection.autoConnect': false, 'security.workspace.trust.enabled': false, 'git.openRepositoryInParentFolders': 'never', 'workbench.colorTheme': 'Default Light Modern' }));
  const key = require('../../builtin/project-scope.cjs').key(project), file = path.join(root, 'data/projects', key + '.json'), make = text => require('../../builtin/message-queue.cjs').create(text, 'ask', [], key, 'chat');
  const first = make('QA first'), second = make('QA second'); first.status = 'starting';
  fs.writeFileSync(file, JSON.stringify({ projectKey: key, projectPath: project, activeId: 'chat', openChatIds: ['chat'], chats: [{ id: 'chat', projectKey: key, source: 'gptide', name: 'Queue QA', messages: [{ role: 'user', text: 'QA previous request' }], tasks: [], changes: [], queue: [first, second] }] }));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; const launch = () => _electron.launch({ executablePath: path.join(root, 'app/VSCodium.exe'), args: ['--user-data-dir', user, '--extensions-dir', path.join(user, 'extensions'), '--skip-welcome', project], env }); let app;
  const frame = async page => { for(let i=0;i<160;i++){for(const value of page.frames()){try{if(await value.locator('#input').count()&&!await value.locator('#input').isDisabled())return value;}catch{}}await page.waitForTimeout(100);}throw new Error('No chat frame');};
  try {
    app = await launch(); let page = await app.firstWindow(); await page.waitForSelector('.monaco-workbench'); let chat = await frame(page);
    await chat.locator('#queue-panel > summary').click(); assert.equal(await chat.locator('#queue-status').innerText(), '已暂停'); assert.equal(await chat.locator('.queue-row').count(), 2); assert.equal(await chat.locator('.queue-row').first().locator('.queue-item-status').innerText(), '未确认');
    await chat.locator('.queue-row').nth(1).getByRole('button', { name: '↑', exact: true }).click(); await chat.waitForFunction(() => document.querySelector('.queue-text').textContent === 'QA second');
    await chat.locator('.queue-row').first().getByRole('button', { name: '编辑', exact: true }).click(); await page.locator('.quick-input-title').filter({ hasText: '编辑排队指令' }).waitFor(); await page.locator('.quick-input-widget input').fill('QA edited'); await page.keyboard.press('Enter'); await chat.waitForFunction(() => document.querySelector('.queue-text').textContent === 'QA edited');
    await chat.locator('.queue-row').nth(1).getByRole('button', { name: '×', exact: true }).click(); await chat.waitForFunction(() => document.querySelectorAll('.queue-row').length === 1); assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).chats[0].queue[0].text,'QA edited');
    await app.close(); app = null; app = await launch(); page = await app.firstWindow(); await page.waitForSelector('.monaco-workbench'); chat = await frame(page); await chat.locator('#queue-panel > summary').click(); assert.equal(await chat.locator('.queue-text').innerText(),'QA edited'); assert.equal(await chat.locator('#queue-status').innerText(),'已暂停'); assert.ok((await chat.locator('#status').innerText()).includes('未连接'));
    console.log('Native queue pause on restart, unconfirmed status, reorder/edit/remove and persistence passed offline; no model request.');
  } finally { if(app)await app.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
