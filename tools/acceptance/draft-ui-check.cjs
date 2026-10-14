const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron } = require('../acceptance-env.cjs').playwright;
const projectScope = require('../../builtin/project-scope.cjs');
(async () => {
  const root = require('../acceptance-env.cjs').root, project = path.join(require('../acceptance-env.cjs').artifacts, 'draft-qa-' + Date.now()); fs.mkdirSync(project);
  const key = projectScope.key(project), state = path.join(root, 'data/projects', key + '.json'), draftsFile = path.join(root, 'data/projects', key + '.drafts.json');
  const launch = async suffix => {
    const user = path.join(require('../acceptance-env.cjs').artifacts, 'draft-check-' + suffix); fs.mkdirSync(path.join(user, 'User'), { recursive: true });
    fs.writeFileSync(path.join(user, 'User/settings.json'), JSON.stringify({ 'workbench.startupEditor': 'none', 'window.restoreWindows': 'none', 'security.workspace.trust.enabled': false, 'gptide.connection.autoConnect': false }));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({ executablePath: path.join(root, 'app/VSCodium.exe'), args: ['--user-data-dir', user, '--extensions-dir', path.join(user, 'extensions'), '--skip-welcome', project], env });
    try {
      const page = await app.firstWindow(); await page.waitForSelector('.monaco-workbench');
      let frame; for (let i = 0; i < 80 && !frame; i++) { for (const f of page.frames()) { try { if (await f.locator('#input').count() && await f.locator('#status').filter({ hasText: '未连接' }).count()) { frame = f; break; } } catch {} } if (!frame) await page.waitForTimeout(100); }
      if (!frame) throw new Error('No chat frame');
      return { app, page, frame };
    } catch (e) { await app.close(); throw e; }
  };
  let current = await launch('one'); let original;
  try {
    original = fs.readFileSync(state, 'utf8');
    await current.frame.locator('#input').fill('durable draft');
    try { await current.frame.locator('#draft-state').filter({ hasText: '草稿已保存' }).waitFor({ timeout: 8000 }); }
    catch (e) { console.log(await current.frame.evaluate(() => ({ draftStatus: document.querySelector('#draft-state').textContent, input: document.querySelector('#input').value, warning: document.querySelector('#warning').textContent, sequence: draftSequence, key: draftKey }))); throw e; }
    assert.ok(JSON.parse(fs.readFileSync(draftsFile)).chats.some(c => c.draft === 'durable draft'));
    await current.frame.locator('#new').click(); await current.frame.locator('#input').fill('second tab');
    await current.frame.locator('#draft-state').filter({ hasText: '草稿已保存' }).waitFor();
    await current.frame.locator('[role="tab"][aria-selected="true"]').focus(); await current.frame.locator('[role="tab"][aria-selected="true"]').press('ArrowLeft');
    await current.frame.waitForFunction(() => document.querySelector('#input').value === 'durable draft');
    await current.frame.evaluate(() => { submittedDraft = document.querySelector('#input').value; document.querySelector('#input').value = 'typed after send'; document.querySelector('#input').dispatchEvent(new Event('input')); window.dispatchEvent(new MessageEvent('message', { data: { type: 'sent', projectKey: document.body.dataset.projectKey } })); });
    assert.equal(await current.frame.locator('#input').inputValue(), 'typed after send');
    await current.frame.evaluate(() => { const input = document.querySelector('#input'); submittedDraft = input.value; submittedInputRevision = inputRevision; submittedSendId = 'qa-same'; input.value = 'changed temporarily'; input.dispatchEvent(new Event('input')); input.value = submittedDraft; input.dispatchEvent(new Event('input')); window.dispatchEvent(new MessageEvent('message', { data: { type: 'sent', clientSendId: 'qa-same', id: draftKey, projectKey: document.body.dataset.projectKey } })); });
    assert.equal(await current.frame.locator('#input').inputValue(), 'typed after send');
    await current.frame.locator('#draft-state').filter({ hasText: '草稿已保存' }).waitFor();
  } finally { await current.app.close(); }
  // Simulate main history lag while keeping independently persisted drafts.
  fs.writeFileSync(state, original);
  current = await launch('two');
  try { await current.frame.waitForFunction(() => document.querySelector('#input').value === 'typed after send', null, { timeout: 5000 }); assert.equal(await current.frame.locator('#input').inputValue(), 'typed after send'); console.log('Draft sidecar survives lagged history and fresh window; Tab keyboard and late send acknowledgment passed offline.'); }
  finally { await current.app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
