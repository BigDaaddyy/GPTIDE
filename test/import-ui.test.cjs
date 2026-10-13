const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { run } = require('../builtin/vscode-import-ui.cjs');
function setup(root, canceled = false) {
  const source = path.join(root, 'source'), extensions = path.join(root, 'extensions'), target = path.join(root, 'customUser', 'profiles', 'QA');
  for (const directory of [source, extensions, target]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(source, 'settings.json'), '{"editor.fontSize":19,"gptide.model":"wrong"}'); fs.writeFileSync(path.join(source, 'keybindings.json'), '[{"key":"ctrl+j","command":"new"}]');
  fs.writeFileSync(path.join(target, 'settings.json'), '{"editor.fontSize":14,"gptide.model":"member"}');
  let picks = 0, dialogs = 0;
  const vscode = { window: {
    showQuickPick: async choices => ++picks === 1 ? '选择自定义目录' : picks === 2 ? choices : '同名设置使用 VS Code 的值',
    showOpenDialog: async () => [{ fsPath: ++dialogs === 1 ? source : extensions }],
    withProgress: async (options, action) => action({ report: () => {} }, { isCancellationRequested: canceled, onCancellationRequested: () => ({ dispose() {} }) }),
    showInformationMessage: async () => undefined
  }, ProgressLocation: { Notification: 1 }, extensions: { getExtension: () => undefined }, commands: { executeCommand: () => { throw new Error('No plugins selected'); } } };
  return { vscode, target, globalStorageUri: { fsPath: path.join(target, 'globalStorage', 'gptide.chat') } };
}
test('import UI targets active profile instead of default profile and records actual outcome', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-import-ui-'));
  try {
    const { vscode, target, globalStorageUri } = setup(root); await run(vscode, root, globalStorageUri);
    const settings = JSON.parse(fs.readFileSync(path.join(target, 'settings.json'))); assert.equal(settings['editor.fontSize'], 19); assert.equal(settings['gptide.model'], 'member');
    assert.equal(fs.existsSync(path.join(root, 'data/user/User/settings.json')), false);
    const backup = fs.readdirSync(path.join(root, 'data/imports')).find(name => !name.endsWith('.lock')), result = JSON.parse(fs.readFileSync(path.join(root, 'data/imports', backup, 'result.json')));
    assert.equal(result.settingCount, 1); assert.equal(result.keyCount, 1); assert.equal(result.targetDirectory, target); assert.deepEqual(result.failures, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('canceled imports preserve configuration and duplicate command does not open another flow', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-import-cancel-'));
  try {
    const { vscode, target, globalStorageUri } = setup(root, true); await run(vscode, root, globalStorageUri);
    assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'settings.json')))['editor.fontSize'], 14);
    const backup = fs.readdirSync(path.join(root, 'data/imports'))[0], result = JSON.parse(fs.readFileSync(path.join(root, 'data/imports', backup, 'result.json'))); assert.equal(result.canceled, true);
    let resolve, prompts = 0, duplicate;
    vscode.window.showQuickPick = () => { prompts++; return new Promise(done => { resolve = done; }); }; vscode.window.showInformationMessage = message => { duplicate = message; };
    const pending = run(vscode, root, globalStorageUri); await run(vscode, root, globalStorageUri); assert.equal(prompts, 1); assert.equal(duplicate, '配置导入正在运行'); resolve(undefined); await pending;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
