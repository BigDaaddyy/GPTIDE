const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), zlib = require('node:zlib');
const core = require('../builtin/vscode-import.cjs');
test('VS Code JSONC and merge preserve conflicting settings and protected defaults', () => {
  const source = core.jsonc('\uFEFF{ // comment\n "url": "https://x/", "literal": ",}", "editor.fontSize": 18, /* end */ }');
  assert.equal(source.literal, ',}'); assert.equal(source.url, 'https://x/');
  const current = { 'editor.fontSize': 14, 'gptide.model': 'member', 'update.mode': 'none' };
  source['gptide.model'] = 'other'; source['update.mode'] = 'default';
  assert.equal(core.mergeSettings(current, source, false)['editor.fontSize'], 14);
  assert.equal(core.mergeSettings(current, source, true)['editor.fontSize'], 18);
  assert.equal(core.mergeSettings(current, source, true)['gptide.model'], 'member');
  assert.equal(core.mergeSettings(current, source, true)['update.mode'], 'none');
  assert.equal(current['editor.fontSize'], 14);
  assert.throws(() => core.jsonc('{ invalid }'));
  const keys = [{ key: 'ctrl+k', command: 'gptide.inlineEdit' }, { key: 'ctrl+j', command: 'old' }];
  const imported = [{ key: 'ctrl+k', command: 'other' }, { key: 'ctrl+j', command: 'new' }, { key: 'ctrl+q', command: 'added' }];
  assert.deepEqual(core.mergeKeybindings(keys, imported, true).map(k => k.command), ['gptide.inlineEdit', 'new', 'added']);
  assert.deepEqual(core.mergeKeybindings(keys, imported, false).map(k => k.command), ['gptide.inlineEdit', 'old', 'added']);
});
test('local extension inventory and VSIX preserve installed files without touching source', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-vscode-'));
  try {
    const user = path.join(root, 'User'), extensions = path.join(root, 'extensions'), plugin = path.join(extensions, 'fixture');
    fs.mkdirSync(user); fs.mkdirSync(plugin, { recursive: true });
    fs.writeFileSync(path.join(user, 'settings.json'), '{"editor.fontSize": 17,}');
    fs.writeFileSync(path.join(plugin, 'package.json'), JSON.stringify({ name: 'fixture', publisher: 'gptide-test', version: '1.0.0', engines: { vscode: '^1.100.0' } }));
    fs.writeFileSync(path.join(plugin, '中文.txt'), 'fixture');
    fs.writeFileSync(path.join(extensions, 'extensions.json'), JSON.stringify([{ relativeLocation: 'fixture' }]));
    const plan = core.scan(user, extensions); assert.equal(plan.plugins.length, 1); assert.equal(plan.settings['editor.fontSize'], 17);
    const zip = path.join(root, 'fixture.vsix'); core.packagePlugin(plan.plugins[0], zip);
    const buffer = fs.readFileSync(zip), files = {}; let offset = 0;
    while (buffer.readUInt32LE(offset) === 0x04034b50) {
      const size = buffer.readUInt32LE(offset + 18), length = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28);
      const name = buffer.subarray(offset + 30, offset + 30 + length).toString(); const start = offset + 30 + length + extra;
      files[name] = zlib.inflateRawSync(buffer.subarray(start, start + size)).toString(); offset = start + size;
    }
    assert.equal(files['extension/中文.txt'], 'fixture'); assert.ok(files['extension.vsixmanifest'].includes('gptide-test'));
    assert.deepEqual(JSON.parse(files['extension/package.json']), plan.plugins[0].manifest);
    assert.equal(fs.readFileSync(path.join(plugin, '中文.txt'), 'utf8'), 'fixture');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
