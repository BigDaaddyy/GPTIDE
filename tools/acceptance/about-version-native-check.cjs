const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const env = require('../acceptance-env.cjs');
(async () => {
  const qa = path.join(env.artifacts, 'about-version-' + Date.now()), user = path.join(qa, 'user'), data = path.join(qa, 'data');
  fs.mkdirSync(path.join(user, 'User'), { recursive: true });
  fs.writeFileSync(path.join(user, 'User/settings.json'), JSON.stringify({ 'window.dialogStyle': 'custom', 'gptide.connection.autoConnect': false, 'gptide.updates.checkOnStartup': false, 'window.restoreWindows': 'none' }));
  const processEnv = { ...process.env, GPTIDE_DATA_HOME: data, CODEX_HOME: path.join(qa, 'empty-codex') }; delete processEnv.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await env.playwright._electron.launch({ executablePath: path.join(env.root, 'app/GPTIDE.exe'), args: ['--user-data-dir', user, '--extensions-dir', path.join(qa, 'extensions'), '--new-window', '--skip-welcome'], env: processEnv });
    const page = await app.firstWindow(); await page.waitForSelector('.monaco-workbench');
    await page.keyboard.press('F1'); const input = page.locator('.quick-input-widget:visible input'); await input.fill('>Help: About');
    await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'About' }).first().waitFor(); await page.keyboard.press('Enter');
    const dialog = page.locator('.monaco-dialog-box'); await dialog.waitFor();
    const version = require('../../package.json').version, engine = JSON.parse(fs.readFileSync(path.join(env.root, 'app/resources/app/package.json'))).version;
    const text = await dialog.innerText(); assert.ok(text.includes('Version: ' + version), text); assert.ok(text.includes('VSCodium: ' + engine), text);
    await page.screenshot({ path: path.join(qa, 'about-version.png') });
    await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText()); assert.ok(copied.includes('Version: ' + version)); assert.ok(copied.includes('VSCodium: ' + engine));
    console.log(JSON.stringify({ passed: true, version, engine, copiedBothVersions: true, screenshot: path.join(qa, 'about-version.png') }));
  } finally { if (app) await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
