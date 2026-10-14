const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron } = require('../acceptance-env.cjs').playwright;
const root = require('../acceptance-env.cjs').root;
(async () => {
  const user = path.join(require('../acceptance-env.cjs').artifacts, 'sidebar-check-user');
  fs.mkdirSync(path.join(user, 'User'), { recursive: true });
  fs.writeFileSync(path.join(user, 'User', 'settings.json'), JSON.stringify({ 'workbench.activityBar.location': 'top', 'workbench.startupEditor': 'none', 'gptide.connection.autoConnect': false, 'security.workspace.trust.enabled': false }));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, 'app', 'VSCodium.exe'), args: ['--user-data-dir', user, '--extensions-dir', path.join(user, 'extensions'), '--disable-extensions', '--skip-welcome', path.join(root, 'example-project')], env, timeout: 30000 });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.part.sidebar > .header-or-footer > .composite-bar-container', { timeout: 30000 });
    console.log(await page.locator('.part.sidebar > .header-or-footer').evaluate(e => e.outerHTML.slice(0, 2500)));
    const measurements = [];
    for (const width of [220, 320, 460]) {
      const measure = await page.evaluate(width => {
        const sidebar = document.querySelector('.part.sidebar');
        sidebar.style.width = width + 'px';
        const container = sidebar.querySelector('.header-or-footer > .composite-bar-container');
        const bar = container.querySelector('.composite-bar');
        const a = container.getBoundingClientRect(), b = bar.getBoundingClientRect();
        return { width, available: a.width, bar: b.width, centerError: Math.abs(a.x + a.width / 2 - b.x - b.width / 2), barX: b.x };
      }, width);
      assert.ok(measure.centerError < 1, JSON.stringify(measure)); measurements.push(measure);
    }
    assert.ok(measurements[2].barX > measurements[0].barX + 50);
    console.log(JSON.stringify(measurements));
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
