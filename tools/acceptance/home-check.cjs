const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite'), { pathToFileURL } = require('node:url');
const { _electron } = require('../acceptance-env.cjs').playwright;
(async () => {
  const root = require('../acceptance-env.cjs').root, user = path.join(require('../acceptance-env.cjs').artifacts, 'home-check-user');
  fs.mkdirSync(path.join(user, 'shared/sharedStorage'), { recursive: true });
  fs.mkdirSync(path.join(user, 'User'), { recursive: true });
  fs.writeFileSync(path.join(user, 'User/settings.json'), JSON.stringify({ 'workbench.colorTheme': 'Default Light Modern', 'workbench.startupEditor': 'none', 'gptide.connection.autoConnect': false, 'window.restoreWindows': 'none' }));
  const db = new DatabaseSync(path.join(user, 'shared/sharedStorage/state.vscdb'));
  db.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
  db.prepare('INSERT OR REPLACE INTO ItemTable VALUES (?,?)').run('history.recentlyOpenedPathsList', JSON.stringify({ entries: [{ folderUri: pathToFileURL(path.join(root, 'example-project')).href }] })); db.close();
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, 'app/VSCodium.exe'), args: ['--user-data-dir', user, '--extensions-dir', path.join(user, 'extensions'), '--skip-welcome', '--new-window'], env });
  try {
    const page = await app.firstWindow(); await page.waitForSelector('.gptide-home');
    for (const frame of page.frames()) assert.equal(await frame.locator('#input').count(), 0, 'Folderless window must not have a chat input');
    await page.locator('.gptide-home-recent').first().waitFor({ timeout: 10000 });
    assert.equal(await page.locator('.gptide-home-tile').count(), 4);
    assert.equal(await page.locator('.watermark-box').count(), 0);
    assert.ok((await page.locator('.gptide-home-recent').first().innerText()).includes('example-project'));
    await page.waitForSelector('.monaco-workbench.vs');
    await page.waitForFunction(() => /本机|未登录/.test(document.querySelector('.gptide-home-meta')?.textContent || ''));
    await page.screenshot({ path: path.join(require('../acceptance-env.cjs').artifacts, 'home-preview.png') });
    await page.locator('.gptide-home-tile.primary').click({ force: true });
    await page.getByRole('option').filter({ hasText: '登录 / 切换 ChatGPT 账户' }).waitFor();
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 760, height: 500 });
    await page.waitForFunction(() => document.querySelector('.gptide-home').getBoundingClientRect().right <= innerWidth, { timeout: 5000 });
    const size = await page.locator('.gptide-home').evaluate(e => ({ width: e.getBoundingClientRect().width, right: e.getBoundingClientRect().right, screen: innerWidth }));
    assert.ok(size.right <= size.screen); assert.ok(size.width > 250);
    console.log('Native project home, real recent storage, account action and compact window passed. No model connection.');
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
