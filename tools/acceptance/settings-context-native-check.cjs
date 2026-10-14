const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron } = require('../acceptance-env.cjs').playwright;
(async () => {
  const root = require('../acceptance-env.cjs').root, qa = path.join(require('../acceptance-env.cjs').artifacts, 'settings-context-' + Date.now()), user = path.join(qa, 'user'), project = path.join(qa, 'project');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true }); fs.mkdirSync(path.join(user, 'User'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src/main.js'), 'const QA = "before";'); fs.writeFileSync(path.join(project, 'notes.txt'), 'excluded QA');
  fs.writeFileSync(path.join(user, 'User/settings.json'), JSON.stringify({ 'workbench.startupEditor': 'none', 'window.restoreWindows': 'none', 'gptide.connection.autoConnect': false, 'security.workspace.trust.enabled': false, 'git.openRepositoryInParentFolders': 'never', 'workbench.colorTheme': 'Default Light Modern' }));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; let app;
  const launch = () => _electron.launch({ executablePath: path.join(root, 'app/VSCodium.exe'), args: ['--user-data-dir', user, '--extensions-dir', path.join(user, 'extensions'), '--skip-welcome', project], env });
  const findFrame = async (page, selector) => { for (let i = 0; i < 160; i++) { for (const frame of page.frames()) { try { if (await frame.locator(selector).count() && await frame.locator(selector).isVisible()) return frame; } catch {} } await page.waitForTimeout(100); } throw new Error('No frame: ' + selector); };
  try {
    app = await launch(); let page = await app.firstWindow(); await page.waitForSelector('.monaco-workbench'); let chat = await findFrame(page, '#input');
    await chat.locator('#input').waitFor({ state: 'visible' }); await chat.waitForFunction(() => !document.querySelector('#input').disabled);
    await chat.locator('#more').click(); await chat.locator('#settings').click(); let settings = await findFrame(page, '#scope'); await settings.locator('#setting-model').waitFor();
    await settings.locator('#files').fill('src/main.js\nnotes.txt'); await settings.locator('#rules').fill('QA project rules\nUse tests'); await settings.locator('#excluded').fill('notes.txt'); await settings.locator('#save').click();
    await settings.locator('#status').filter({ hasText: '项目上下文已保存' }).waitFor();
    const key = require('../../builtin/project-scope.cjs').key(project), file = path.join(root, 'data/projects', key + '.context.json');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8')); assert.deepEqual(stored.files, ['src/main.js', 'notes.txt']); assert.equal(stored.rules, 'QA project rules\nUse tests'); assert.ok(!fs.readFileSync(file, 'utf8').includes('before'));
    await settings.locator('#scope').selectOption('project'); await settings.locator('[id="setting-chat.submitKey"]').selectOption('ctrlEnter'); await settings.locator('#status').filter({ hasText: /^已保存$/ }).waitFor();
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, '.vscode/settings.json'), 'utf8'))['gptide.chat.submitKey'], 'ctrlEnter');
    const metrics = await settings.locator('main').evaluate(element => ({ width: element.getBoundingClientRect().width, viewport: innerWidth })); assert.ok(metrics.width <= metrics.viewport);
    if (process.argv.includes('--visual')) { await page.screenshot({ path: path.join(require('../acceptance-env.cjs').artifacts, 'settings-context-visual.png') }); return; }
    await app.close(); app = null; fs.writeFileSync(path.join(project, 'src/main.js'), 'const QA = "after";');
    app = await launch(); page = await app.firstWindow(); await page.waitForSelector('.monaco-workbench'); chat = await findFrame(page, '#input'); await chat.waitForFunction(() => !document.querySelector('#input').disabled);
    assert.ok((await chat.locator('#attachments').innerText()).includes('src/main.js')); assert.ok(!(await chat.locator('#attachments').innerText()).includes('notes.txt'));
    const restored = new (require('../../builtin/project-context.cjs').ProjectContext)(file, project, key).read(); assert.ok(restored.text.includes('after')); assert.ok(!restored.text.includes('excluded QA'));
    await chat.locator('#more').click(); await chat.locator('#settings').click(); settings = await findFrame(page, '#scope'); await settings.locator('#setting-model').waitFor(); assert.equal(await settings.locator('#rules').inputValue(), 'QA project rules\nUse tests');
    console.log('Native configuration tab, project scope persistence, pinned paths/rules, excluded files and fresh reads after restart passed offline; no model request.');
  } finally { if (app) await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
