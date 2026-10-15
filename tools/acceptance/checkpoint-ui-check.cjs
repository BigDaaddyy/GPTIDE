const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron } = require('../acceptance-env.cjs').playwright;
(async () => {
  const root = require('../acceptance-env.cjs').root, tag = Date.now(), user = path.join(require('../acceptance-env.cjs').artifacts, 'checkpoint-user-' + tag), project = path.join(require('../acceptance-env.cjs').artifacts, 'checkpoint-project-' + tag);
  fs.mkdirSync(project); fs.mkdirSync(path.join(user, 'User'), { recursive: true });
  fs.writeFileSync(path.join(user, 'User/settings.json'), JSON.stringify({ 'workbench.startupEditor': 'none', 'window.restoreWindows': 'none', 'gptide.connection.autoConnect': false, 'security.workspace.trust.enabled': false }));
  const key = require('../../builtin/project-scope.cjs').key(project), store = new (require('../../builtin/checkpoints.cjs').Checkpoints)(path.join(root, 'data/projects', key + '-checkpoints'), project, key), file = path.join(project, 'a.txt');
  const first = store.create([{ path: file, before: 'A\r\n', after: 'B\r\n' }], 1), second = store.create([{ path: file, before: 'B\r\n', after: 'C\r\n' }], 2);
  fs.writeFileSync(file, 'C\r\n');
  fs.writeFileSync(path.join(root, 'data/projects', key + '.json'), JSON.stringify({ projectKey: key, projectPath: project, activeId: 'qa', openChatIds: ['qa'], chats: [{ id: 'qa', projectKey: key, name: 'QA checkpoints', source: 'gptide', messages: [{ role: 'user', text: 'Offline fixture' }], changes: [], checkpoints: [first, second], activeCheckpointId: second.id }] }));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, 'app/VSCodium.exe'), args: ['--user-data-dir', user, '--extensions-dir', path.join(user, 'extensions'), '--skip-welcome', project], env });
  try {
    const page = await app.firstWindow(); await page.waitForSelector('.monaco-workbench'); let frame;
    for (let i = 0; i < 120 && !frame; i++) { for (const f of page.frames()) { try { if (await f.locator('#checkpoint-select option').count() === 2) { frame = f; break; } } catch {} } if (!frame) await page.waitForTimeout(100); }
    if (!frame) throw new Error('No checkpoint chat');
    await frame.locator('#review-toggle').click();
    async function dismiss() { for (let i = 0; i < 8; i++) { const close = page.locator('.notifications-toasts .codicon-notifications-clear'); if (!await close.count()) break; await close.first().click(); } }
    console.log('Startup notifications:', await page.locator('.notification-list-item-message').allTextContents()); await dismiss();
    await frame.locator('#checkpoint-select').selectOption(first.id);
    await frame.locator('.review-path').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.monaco-editor')].some(e => e.textContent.includes('A')) && [...document.querySelectorAll('.monaco-editor')].some(e => e.textContent.includes('B')));
    assert.equal(fs.readFileSync(file, 'utf8'), 'C\r\n');
    await frame.locator('.review-row button').filter({ hasText: /^Undo$/ }).click(); await frame.locator('#status').filter({ hasText: '文件已有后续修改' }).waitFor(); await dismiss();
    assert.equal(fs.readFileSync(file, 'utf8'), 'C\r\n');
    await frame.locator('#checkpoint-select').selectOption(second.id); await frame.locator('.review-row button').filter({ hasText: /^Undo$/ }).click();
    await frame.waitForFunction(() => document.querySelector('.review-status')?.textContent === '已撤销'); assert.equal(fs.readFileSync(file, 'utf8'), 'B\r\n');
    await frame.locator('#checkpoint-select').selectOption(first.id); await frame.locator('.review-row button').filter({ hasText: /^Undo$/ }).click();
    await frame.waitForFunction(() => document.querySelector('.review-status')?.textContent === '已撤销'); assert.equal(fs.readFileSync(file, 'utf8'), 'A\r\n');
    await frame.locator('.review-row button').filter({ hasText: /^Redo$/ }).click();
    await frame.waitForFunction(() => !document.querySelector('.review-status')); assert.equal(fs.readFileSync(file, 'utf8'), 'B\r\n');
    console.log('Native archived diff, later-edit rejection, two-round restore and redo passed offline. No model request.');
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
