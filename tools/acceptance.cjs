const fs = require('node:fs'), path = require('node:path'), { execFile } = require('node:child_process'), { promisify } = require('node:util');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'downloads', 'acceptance', Date.now() + '-' + process.pid); fs.mkdirSync(output, { recursive: true });
const scenarios = [
  ['messages', 'find-task-ui-check.cjs', [], 'web'], ['usability', 'usability-ui-check.cjs', [], 'web'],
  ['settings-usability', 'settings-usability-ui-check.cjs', [], 'web'],
  ['home', 'home-check.cjs'], ['offline', 'offline-check.cjs'], ['sidebar', 'sidebar-check.cjs'],
  ['isolation', 'project-isolation-native-check.cjs'],
  ['import', 'import-native-check.cjs'],
  ['settings', 'settings-context-native-check.cjs'], ['drafts', 'draft-ui-check.cjs'], ['branches', 'branch-native-check.cjs'],
  ['queue', 'queue-native-check.cjs'], ['inline', 'inline-widget-native-check.cjs'], ['recovery', 'recovery-native-check.cjs'],
  ['checkpoints', 'checkpoint-ui-check.cjs'], ['menus-light', 'menu-audit.cjs', ['--after']], ['menus-dark', 'menu-audit.cjs', ['--after', '--dark']]
];
const selected = process.argv.slice(2), report = { version: require('../package.json').version, offline: true, startedAt: new Date().toISOString(), scenarios: [] };
if (selected.some(name => !['--web','--native',...scenarios.map(s => s[0])].includes(name))) throw Error('未知验收项：' + selected.join(' '));
(async () => {
  for (const [name, file, args = [], kind = 'native'] of scenarios) {
    if (selected.length && !(selected.includes(name) || selected.includes('--' + kind))) continue;
    const start = Date.now(); let status = 'passed', stdout = '', stderr = '';
    try { ({ stdout, stderr } = await promisify(execFile)(process.execPath, [path.join(__dirname, 'acceptance', file), ...args], { cwd: root, env: { ...process.env, GPTIDE_ACCEPTANCE_OUTPUT: output }, windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024 })); }
    catch (error) { status = 'failed'; stdout = error.stdout || ''; stderr = error.stderr || error.message; process.exitCode = 1; }
    report.scenarios.push({ name, status, durationMs: Date.now() - start, stdout: stdout.trim(), stderr: stderr.trim() });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(name + ': ' + status + ' (' + Math.round((Date.now() - start) / 1000) + 's)');
    if (status === 'failed') console.error(stderr.slice(-1800));
  }
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log('验收报告：' + path.join(output, 'report.json'));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
