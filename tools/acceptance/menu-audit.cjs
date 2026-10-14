const fs = require('node:fs'), path = require('node:path');
const { _electron } = require('../acceptance-env.cjs').playwright;
(async () => {
  const root = require('../acceptance-env.cjs').root, user = path.join(require('../acceptance-env.cjs').artifacts, 'menu-audit-user');
  fs.mkdirSync(path.join(user, 'User'), { recursive: true });
  fs.writeFileSync(path.join(user, 'User/settings.json'), JSON.stringify({ 'workbench.colorTheme': process.argv.includes('--dark') ? 'Default Dark Modern' : 'Default Light Modern', 'workbench.startupEditor': 'none', 'window.restoreWindows': 'none', 'window.menuBarVisibility': 'classic', 'gptide.connection.autoConnect': false }));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, 'app/VSCodium.exe'), args: ['--user-data-dir', user, '--extensions-dir', path.join(user, 'extensions'), '--skip-welcome'], env });
  try {
    const page = await app.firstWindow(); await page.waitForSelector(process.argv.includes('--dark') ? '.monaco-workbench.vs-dark' : '.monaco-workbench.vs'); await page.waitForSelector('.menubar-menu-button');
    await page.locator('.menubar-menu-button').first().click();
    await page.waitForSelector('.monaco-menu');
    console.log(await page.evaluate(() => { let e = document.querySelector('.monaco-menu'); const a = []; while(e) { const s = getComputedStyle(e); a.push({class:e.className, overflow:s.overflow}); e=e.parentElement; } return a; }));
    console.log(await page.evaluate(() => [...document.querySelectorAll('.monaco-menu-container, .monaco-menu, .monaco-menu .monaco-action-bar')].map(e => { const s = getComputedStyle(e); return { classes: e.className, border: s.border, shadow: s.boxShadow, background: s.backgroundColor, radius: s.borderRadius }; })));
    await page.screenshot({ path: path.join(require('../acceptance-env.cjs').artifacts, process.argv.includes('--after') ? 'menu-after.png' : 'menu-before.png') });
    if (process.argv.includes('--after')) {
      const assert = require('node:assert/strict');
      const check = () => [...document.querySelectorAll('.monaco-menu')].map(e => ({ border: getComputedStyle(e).borderWidth, radius: getComputedStyle(e).borderRadius }));
      assert.ok((await page.evaluate(check)).every(m => m.border === '1px' && m.radius === '8px'));
      if (!await page.locator('.monaco-menu').count()) await page.locator('.menubar-menu-button').first().click();
      await page.locator('.monaco-menu .action-label').filter({ hasText: /^Preferences$/ }).first().click({ force: true, timeout: 5000 });
      await page.waitForFunction(() => document.querySelectorAll('.monaco-menu').length > 1, null, { timeout: 5000 });
      assert.ok((await page.evaluate(check)).every(m => m.border === '1px'));
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
      await page.keyboard.press('Control+Shift+P'); await page.waitForSelector('.quick-input-widget');
      const picker = await page.locator('.quick-input-widget').evaluate(e => ({ border: getComputedStyle(e).borderWidth, shadow: getComputedStyle(e).boxShadow }));
      assert.equal(picker.border, '1px'); assert.notEqual(picker.shadow, 'none');
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape');
      console.log('Menus, submenu, command palette elevation and keyboard dismissal passed');
    }
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
