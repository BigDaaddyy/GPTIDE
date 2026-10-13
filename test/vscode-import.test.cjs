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

test('empty/comment-only configs and malformed key entries do not break valid imports', () => {
  assert.deepEqual(core.configuration('// empty settings\n', 'settings'), {}); assert.deepEqual(core.configuration('/* empty keys */', 'keys'), []);
  assert.throws(() => core.configuration('{} /* unfinished', 'settings'), /未结束/);
  assert.throws(() => core.configuration('[]', 'settings'), /对象/);
  const malformed = [null, {}, { key: 1, command: 'bad' }, { key: 'ctrl+j' }, { key: 'ctrl+k', command: '-gptide.inlineEdit' }];
  const merged = core.mergeKeybindings(malformed, [{ key: 'ctrl+k', command: 'bad' }, { key: 'ctrl+j', command: 'new' }], true);
  assert.ok(merged.some(b => b?.command === '-gptide.inlineEdit')); assert.ok(merged.some(b => b?.command === 'new')); assert.ok(!merged.some(b => b?.command === 'bad' && b?.key === 'ctrl+k'));
});

test('malformed and traversal extension index records cannot import outside selected directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-index-'));
  try {
    const user = path.join(root, 'User'), extensions = path.join(root, 'extensions'), outside = path.join(root, 'outside');
    for (const dir of [user, extensions, outside]) fs.mkdirSync(dir);
    fs.writeFileSync(path.join(outside, 'package.json'), JSON.stringify({ name: 'outside', publisher: 'test', version: '1.0.0' }));
    fs.writeFileSync(path.join(extensions, 'extensions.json'), JSON.stringify([null, 1, {}, { relativeLocation: '../outside' }, { location: { fsPath: outside } }]));
    const result = core.scan(user, extensions); assert.deepEqual(result.plugins, []); assert.equal(result.warnings.length, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('plugin limits are enforced before reads and aborted streams remove only their partial output', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-stream-'));
  try {
    const plugin = { directory: root, manifest: { publisher: 'test', name: 'fixture', version: '1.0.0' } }, output = path.join(root, '..', path.basename(root) + '.vsix');
    const file = path.join(root, 'large.bin'), descriptor = fs.openSync(file, 'w'); try { for (let i = 0; i < 128; i++) fs.writeSync(descriptor, Buffer.alloc(65536, i)); } finally { fs.closeSync(descriptor); }
    await assert.rejects(core.packagePlugin(plugin, output, { maximumBytes: 1024 }), /过大/); assert.equal(fs.existsSync(output), false);
    const controller = new AbortController(); const packaging = core.packagePlugin(plugin, output, { signal: controller.signal });
    while (!fs.existsSync(output)) await new Promise(resolve => setImmediate(resolve)); controller.abort();
    await assert.rejects(packaging, /abort/i); assert.equal(fs.existsSync(output), false); assert.equal(fs.statSync(file).size, 8 * 1024 * 1024);
    fs.writeFileSync(output, 'existing'); await assert.rejects(core.packagePlugin(plugin, output), /EEXIST/); assert.equal(fs.readFileSync(output, 'utf8'), 'existing'); fs.unlinkSync(output);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('local extension inventory and VSIX preserve installed files without touching source', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-vscode-'));
  try {
    const user = path.join(root, 'User'), extensions = path.join(root, 'extensions'), plugin = path.join(extensions, 'fixture');
    fs.mkdirSync(user); fs.mkdirSync(plugin, { recursive: true });
    fs.writeFileSync(path.join(user, 'settings.json'), '{"editor.fontSize": 17,}');
    fs.writeFileSync(path.join(plugin, 'package.json'), JSON.stringify({ name: 'fixture', publisher: 'gptide-test', version: '1.0.0', engines: { vscode: '^1.100.0' } }));
    fs.writeFileSync(path.join(plugin, '中文.txt'), 'fixture');
    fs.writeFileSync(path.join(extensions, 'extensions.json'), JSON.stringify([{ relativeLocation: 'fixture' }]));
    const plan = core.scan(user, extensions); assert.equal(plan.plugins.length, 1); assert.equal(plan.settings['editor.fontSize'], 17);
    const zip = path.join(root, 'fixture.vsix'); await core.packagePlugin(plan.plugins[0], zip);
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

test('VSIX root and entries use one canonical resolver even when the sync resolver exposes an alias', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-path-alias-')), output = path.join(root, '..', path.basename(root) + '.vsix');
  const original = fs.realpathSync; let syncRootReads = 0;
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}');
    fs.realpathSync = function(file, ...args) { if (path.resolve(file) === root) { syncRootReads++; return path.join(root, 'different-alias'); } return original.call(this, file, ...args); };
    await core.packagePlugin({ directory: root, manifest: { publisher: 'test', name: 'fixture', version: '1.0.0' } }, output);
    assert.equal(syncRootReads, 0); assert.ok(fs.statSync(output).size > 0);
  } finally { fs.realpathSync = original; fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(output, { force: true }); }
});
