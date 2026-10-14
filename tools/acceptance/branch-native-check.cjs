const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron } = require('../acceptance-env.cjs').playwright;
(async () => {
  const root = require('../acceptance-env.cjs').root, qa = path.join(require('../acceptance-env.cjs').artifacts, 'branch-' + Date.now()), user = path.join(qa, 'user'), project = path.join(qa, 'project'); fs.mkdirSync(project, { recursive: true }); fs.mkdirSync(path.join(user, 'User'), { recursive: true });
  fs.writeFileSync(path.join(user, 'User/settings.json'), JSON.stringify({ 'workbench.startupEditor': 'none', 'window.restoreWindows': 'none', 'gptide.connection.autoConnect': false, 'security.workspace.trust.enabled': false, 'git.openRepositoryInParentFolders': 'never', 'workbench.colorTheme': 'Default Light Modern' }));
  const key = require('../../builtin/project-scope.cjs').key(project), file = path.join(root, 'data/projects', key + '.json');
  fs.writeFileSync(file, JSON.stringify({ projectKey: key, projectPath: project, activeId: 'origin', openChatIds: ['origin'], chats: [{ id: 'origin', projectKey: key, source: 'gptide', name: 'QA origin', threadId: 'qa-original-thread', draft: 'original draft', messages: [{ role: 'user', text: 'QA prefix' }, { role: 'assistant', text: 'QA first answer' }, { role: 'user', text: 'QA later request' }], tasks: [], changes: [], checkpoints: [] }] }));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; let app;
  const launch = () => _electron.launch({ executablePath: path.join(root, 'app/VSCodium.exe'), args: ['--user-data-dir', user, '--extensions-dir', path.join(user, 'extensions'), '--skip-welcome', project], env });
  const chatFrame = async page => { for (let i = 0; i < 160; i++) { for (const frame of page.frames()) { try { if (await frame.locator('#input').count() && !await frame.locator('#input').isDisabled()) return frame; } catch {} } await page.waitForTimeout(100); } throw new Error('No loaded chat frame'); };
  try {
    app = await launch(); let page = await app.firstWindow(); await page.waitForSelector('.monaco-workbench'); let frame = await chatFrame(page);
    assert.equal(await frame.locator('#input').inputValue(), 'original draft'); await frame.locator('.message').nth(1).hover(); await frame.locator('.message').nth(1).locator('.branch-message').click();
    await frame.waitForFunction(() => document.querySelectorAll('[role=tab]').length === 2 && !document.querySelector('#input').disabled); assert.equal(await frame.locator('.message').count(), 2); assert.equal(await frame.locator('#input').inputValue(), ''); assert.ok((await frame.locator('.branch-source').innerText()).includes('QA origin'));
    let stored = JSON.parse(fs.readFileSync(file, 'utf8')), branch = stored.chats.find(chat => chat.branch); assert.equal(branch.messages.length, 2); assert.equal(branch.threadId, undefined); assert.equal(branch.backgroundPending, true); assert.equal(stored.chats.find(chat => chat.id === 'origin').threadId, 'qa-original-thread');
    await frame.locator('[role=tab]').filter({ hasText: 'QA origin' }).filter({ hasNotText: '分支' }).click(); await frame.waitForFunction(() => document.querySelectorAll('.message').length === 3); assert.equal(await frame.locator('#input').inputValue(), 'original draft');
    await frame.locator('[role=tab]').filter({ hasText: '分支' }).click(); await frame.waitForFunction(() => document.querySelectorAll('.message').length === 2); await page.screenshot({ path: path.join(require('../acceptance-env.cjs').artifacts, 'branch-native.png') });
    await app.close(); app = null; app = await launch(); page = await app.firstWindow(); await page.waitForSelector('.monaco-workbench'); frame = await chatFrame(page); assert.equal(await frame.locator('.message').count(), 2); assert.equal(await frame.locator('.branch-source').count(), 1); assert.ok((await frame.locator('#status').innerText()).includes('未连接'));
    console.log('Native branch button/new Tab, exact prefix, original draft/thread preservation and restart restore passed offline; no model request.');
  } finally { if (app) await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
