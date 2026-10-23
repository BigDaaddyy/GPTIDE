const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const env = require('../acceptance-env.cjs');
(async () => {
  const qa = path.join(env.artifacts, 'codex-history-' + Date.now()), project = path.join(qa, 'project'), user = path.join(qa, 'user'), data = path.join(qa, 'data'), codex = path.join(qa, 'codex');
  fs.mkdirSync(project, { recursive: true }); fs.mkdirSync(path.join(user, 'User'), { recursive: true }); fs.mkdirSync(path.join(codex, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(user, 'User/settings.json'), JSON.stringify({ 'workbench.startupEditor': 'none', 'window.restoreWindows': 'none', 'gptide.connection.autoConnect': false, 'gptide.codexPath': path.join(qa, 'unused.exe'), 'gptide.cursorUserPath': path.join(qa, 'empty-cursor'), 'security.workspace.trust.enabled': false, 'git.openRepositoryInParentFolders': 'never' }));
  const record = (type, payload) => JSON.stringify({ type, timestamp: new Date().toISOString(), payload }) + '\n';
  const message = (role, text) => record('response_item', { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] });
  const file = path.join(codex, 'sessions', 'own.jsonl');
  fs.writeFileSync(file, record('session_meta', { id: 'native-qa', cwd: project, source: 'cli' }) + message('user', 'Codex imported request') + message('assistant', '**Codex progress**'));
  fs.writeFileSync(path.join(codex, 'sessions', 'foreign.jsonl'), record('session_meta', { id: 'foreign-qa', cwd: path.join(qa, 'other-project') }) + message('user', 'FOREIGN MUST STAY HIDDEN'));
  fs.writeFileSync(path.join(codex, 'session_index.jsonl'), JSON.stringify({ id: 'native-qa', thread_name: 'Codex QA project' }) + '\n');
  const original = fs.readFileSync(file, 'utf8'), processEnv = { ...process.env, GPTIDE_DATA_HOME: data, CODEX_HOME: codex }; delete processEnv.ELECTRON_RUN_AS_NODE;
  let app;
  const launch = () => env.playwright._electron.launch({ executablePath: path.join(env.root, 'app/GPTIDE.exe'), args: ['--user-data-dir', user, '--extensions-dir', path.join(qa, 'extensions'), '--skip-welcome', project], env: processEnv });
  async function chatFrame(page) {
    await page.waitForSelector('.monaco-workbench');
    for (let i = 0; i < 200; i++) { for (const frame of page.frames()) try { if (await frame.locator('#input').count() && !await frame.locator('#input').isDisabled()) return frame; } catch {} await page.waitForTimeout(100); }
    throw Error('Chat not loaded');
  }
  try {
    app = await launch(); let page = await app.firstWindow(), chat = await chatFrame(page);
    await chat.locator('.source').filter({ hasText: 'Codex' }).waitFor();
    assert.ok((await chat.locator('#messages').innerText()).includes('Codex imported request'));
    assert.equal(await chat.locator('#messages strong').filter({ hasText: 'Codex progress' }).count(), 1);
    await chat.locator('#history').click();
    let row = chat.locator('.history-row').filter({ hasText: 'Codex QA project' }); await row.waitFor();
    assert.ok((await row.innerText()).includes('Codex')); assert.ok(!(await chat.locator('#history-list').innerText()).includes('FOREIGN'));
    await row.getByRole('button', { name: 'Pin', exact: true }).click();
    const key = require('../../builtin/project-scope.cjs').key(project), stateFile = path.join(data, 'projects', key + '.json');
    await chat.waitForFunction(() => document.querySelector('.history-open').textContent.includes('⌖'));
    assert.equal(JSON.parse(fs.readFileSync(stateFile)).codexChatMetadata['codex:native-qa'].pinned, true);
    await chat.locator('#close-history').click();
    const appended = message('assistant', 'Updated in Codex'); fs.appendFileSync(file, appended);
    await chat.locator('#more').click(); await chat.locator('#refresh').click();
    await chat.locator('.message').filter({ hasText: 'Updated in Codex' }).waitFor();
    await page.screenshot({ path: path.join(qa, 'codex-history.png') });
    await app.close(); app = await launch(); page = await app.firstWindow(); chat = await chatFrame(page);
    await chat.locator('#history').click(); row = chat.locator('.history-row').filter({ hasText: 'Codex QA project' }); await row.waitFor();
    assert.ok((await row.innerText()).includes('⌖')); assert.equal(fs.readFileSync(file, 'utf8'), original + appended);
    console.log(JSON.stringify({ passed: true, offline: true, imported: true, projectIsolation: true, markdown: true, refreshed: true, pinSurvivesRestart: true, sourceUnchanged: true, screenshot: path.join(qa, 'codex-history.png') }));
  } finally { if (app) await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
