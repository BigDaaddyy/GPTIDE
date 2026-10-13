const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const core = require('../builtin/import-config.cjs');
function fixture(action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-config-'));
  try { const user = path.join(root, 'User'); fs.mkdirSync(user); fs.writeFileSync(path.join(user, 'settings.json'), '{ // original\n "editor.fontSize": 14\n}'); fs.writeFileSync(path.join(user, 'keybindings.json'), '[{"key":"ctrl+j","command":"old"}]'); return action(root, user); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
const plan = { settings: { 'editor.fontSize': 18 }, keybindings: [{ key: 'ctrl+j', command: 'new' }] };
test('configuration preflight rejects invalid second file without changing settings', () => fixture((root, user) => {
  const before = fs.readFileSync(path.join(user, 'settings.json'), 'utf8'); fs.writeFileSync(path.join(user, 'keybindings.json'), '{}');
  assert.throws(() => core.prepare(user, plan, ['settings', 'keys'], true), /必须为数组/);
  assert.equal(fs.readFileSync(path.join(user, 'settings.json'), 'utf8'), before);
}));
test('failed second write rolls back first and preserves exact original JSONC backup', () => fixture((root, user) => {
  const records = core.prepare(user, plan, ['settings', 'keys'], true), backup = path.join(root, 'backup'); let calls = 0;
  assert.throws(() => core.apply(records, backup, { rename: (a, b) => { if (++calls === 2) throw new Error('disk failure'); fs.renameSync(a, b); } }), /已还原/);
  for (const record of records) { assert.equal(fs.readFileSync(record.file, 'utf8'), record.before); assert.equal(fs.readFileSync(path.join(backup, record.name), 'utf8'), record.before); }
  assert.equal(fs.readdirSync(user).filter(name => name.endsWith('.tmp')).length, 0);
}));
test('rollback never replaces edits made after the first configuration write', () => fixture((root, user) => {
  const records = core.prepare(user, plan, ['settings', 'keys'], true); let calls = 0;
  assert.throws(() => core.apply(records, path.join(root, 'backup'), { rename: (a, b) => { if (++calls === 2) { fs.writeFileSync(records[0].file, '{"editor.fontSize":25}'); throw new Error('disk failure'); } fs.renameSync(a, b); } }), /无法自动还原/);
  assert.equal(JSON.parse(fs.readFileSync(records[0].file))['editor.fontSize'], 25); assert.equal(fs.readFileSync(records[1].file, 'utf8'), records[1].before);
}));
test('stale configuration plans refuse overwrite and profile locks serialize writes', () => fixture((root, user) => {
  const records = core.prepare(user, plan, ['settings', 'keys'], true); fs.writeFileSync(records[0].file, '{"editor.fontSize":22}');
  assert.throws(() => core.apply(records, path.join(root, 'backup')), /其他窗口/);
  assert.equal(JSON.parse(fs.readFileSync(records[0].file))['editor.fontSize'], 22);
  core.withLock(user, path.join(root, 'locks'), () => assert.throws(() => core.withLock(user, path.join(root, 'locks'), () => {}), /另一窗口/));
  assert.equal(fs.readdirSync(path.join(root, 'locks')).length, 0);
}));
test('successful import counts actual changes and leaves unchanged comments intact', () => fixture((root, user) => {
  const before = fs.readFileSync(path.join(user, 'settings.json'), 'utf8');
  let records = core.prepare(user, plan, ['settings'], false); assert.deepEqual(core.apply(records, path.join(root, 'backup')), { settingCount: 0, keyCount: 0 }); assert.equal(fs.readFileSync(records[0].file, 'utf8'), before);
  records = core.prepare(user, plan, ['settings', 'keys'], true); assert.deepEqual(core.apply(records, path.join(root, 'backup2')), { settingCount: 1, keyCount: 1 });
}));
