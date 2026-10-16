const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron } = require('../acceptance-env.cjs').playwright;
(async () => {
  const root = require('../acceptance-env.cjs').root, user = path.join(require('../acceptance-env.cjs').artifacts, 'offline-check-user'), project = path.join(require('../acceptance-env.cjs').artifacts, 'offline-qa-project');
  fs.mkdirSync(project, { recursive: true }); fs.mkdirSync(path.join(user, 'User'), { recursive: true });
  fs.writeFileSync(path.join(user, 'User/settings.json'), JSON.stringify({ 'workbench.colorTheme': 'Default Light Modern', 'workbench.startupEditor': 'none', 'window.restoreWindows': 'none', 'security.workspace.trust.enabled': false, 'gptide.codexPath': path.join(user,'disabled-codex.exe'), 'gptide.chat.submitKey': 'ctrlEnter' }));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, 'app/VSCodium.exe'), args: ['--user-data-dir', user, '--extensions-dir', path.join(user, 'extensions'), '--skip-welcome', project], env });
  try {
    const page = await app.firstWindow(); await page.waitForSelector('.monaco-workbench');
    await page.keyboard.press('Control+Shift+P'); await page.locator('.quick-input-widget input').fill('>GPTIDE: 快速查看用量');
    await page.getByRole('option').filter({ hasText: '快速查看用量' }).first().click();
    await page.locator('.quick-input-title').filter({ hasText: 'ChatGPT 用量' }).waitFor();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Shift+P'); await page.locator('.quick-input-widget input').fill('>GPTIDE: 本机诊断');
    await page.getByRole('option').filter({ hasText: '本机诊断' }).first().click();
    await page.locator('.view-line').filter({ hasText: 'disconnected' }).first().waitFor();
    console.log('Offline project starts disconnected; quota and diagnostics commands passed. No model request.');
    const logs = path.join(user, 'logs');
    for (const dir of fs.readdirSync(logs)) {
      const log = path.join(logs, dir, 'window1/exthost/exthost.log');
      if (fs.existsSync(log)) assert.ok(!fs.readFileSync(log, 'utf8').includes('gptide-chat') || !fs.readFileSync(log, 'utf8').includes('ReferenceError'));
    }
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
