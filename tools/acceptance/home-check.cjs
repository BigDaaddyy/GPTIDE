const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite'), { pathToFileURL } = require('node:url');
const { _electron } = require('../acceptance-env.cjs').playwright;
(async () => {
  const root = require('../acceptance-env.cjs').root, user = path.join(require('../acceptance-env.cjs').artifacts, 'home-check-user');
  fs.mkdirSync(path.join(user, 'shared/sharedStorage'), { recursive: true });
  fs.mkdirSync(path.join(user, 'User'), { recursive: true });
  fs.writeFileSync(path.join(user, 'User/settings.json'), JSON.stringify({ 'workbench.colorTheme': 'Default Light Modern', 'workbench.startupEditor': 'none', 'gptide.connection.autoConnect': false, 'window.restoreWindows': 'none', 'window.menuBarVisibility':'classic', 'security.workspace.trust.enabled':false, 'extensions.ignoreRecommendations':true, 'git.openRepositoryInParentFolders':'never' }));
  const project=path.join(require('../acceptance-env.cjs').artifacts,'home-project');fs.mkdirSync(project);fs.writeFileSync(path.join(project,'index.js'),'const homeTest = true;\n');
  const db = new DatabaseSync(path.join(user, 'shared/sharedStorage/state.vscdb'));
  db.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
  db.prepare('INSERT OR REPLACE INTO ItemTable VALUES (?,?)').run('history.recentlyOpenedPathsList', JSON.stringify({ entries: [{ folderUri: pathToFileURL(project).href }] })); db.close();
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, 'app/VSCodium.exe'), args: ['--user-data-dir', user, '--extensions-dir', path.join(user, 'extensions'), '--skip-welcome', '--new-window'], env });
  let currentPage;const pageInfo=async()=>{const page=currentPage;if(!page)return {};await page.screenshot({path:path.join(require('../acceptance-env.cjs').artifacts,'home-failure.png')});return page.evaluate(()=>({title:document.title,home:document.querySelectorAll('.gptide-home').length,hidden:document.querySelectorAll('.gptide-project-open').length,explorer:document.querySelector('.explorer-viewlet')?.innerText,body:document.body.innerText.slice(-1200)}));};
  try {
    const page = currentPage = await app.firstWindow(); await page.waitForSelector('.gptide-home');
    for (const frame of page.frames()) assert.equal(await frame.locator('#input').count(), 0, 'Folderless window must not have a chat input');
    await page.locator('.gptide-home-recent').first().waitFor({ timeout: 10000 });
    assert.equal(await page.locator('.gptide-home-tile').count(), 4);
    assert.equal(await page.locator('.watermark-box').count(), 0);
    assert.ok((await page.locator('.gptide-home-recent').first().innerText()).includes('home-project'));
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
    await page.locator('.gptide-home-recent').first().click();await page.locator('.gptide-home').waitFor({state:'detached',timeout:30000});await page.locator('.explorer-viewlet').getByText('index.js',{exact:true}).waitFor();
    assert.equal(await page.locator('.gptide-home').count(),0);await page.locator('.explorer-viewlet').getByText('index.js',{exact:true}).dblclick();await page.locator('.monaco-editor .view-line').filter({hasText:'homeTest'}).first().waitFor();await page.keyboard.press('Control+w');assert.equal(await page.locator('.gptide-home').count(),0);await page.screenshot({path:path.join(require('../acceptance-env.cjs').artifacts,'home-project-open.png')});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,900));await page.setViewportSize({width:1440,height:900});for(let i=0;i<100;i++){let ready=false;for(const frame of page.frames())try{if(await frame.locator('#input').count())ready=ready||await frame.locator('#input').isEnabled();}catch{}if(ready)break;await page.waitForTimeout(100);}await page.locator('.menubar-menu-button').filter({hasText:/^File$/}).first().click();await page.locator('.monaco-menu .action-label').filter({hasText:/^Close Folder$/}).first().waitFor();await page.keyboard.press('End');await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');await page.locator('.gptide-home').waitFor({timeout:30000});assert.equal(await page.locator('.gptide-home-tile').count(),4);for(const frame of page.frames())assert.equal(await frame.locator('#input').count(),0);
    console.log('Actual recent-project click removes home, closing all files keeps home hidden, closing folder restores home. Native project home, real recent storage, account action and compact window passed. No model connection.');
  } catch(error){console.error(await pageInfo());throw error;} finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
