const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const storage = require('../builtin/storage.cjs');
test('history recovers from backup and preserves corrupt evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-store-')), file = path.join(root, 'state.json');
  try {
    assert.equal(storage.read(file).state, null);
    storage.write(file, { chats: [{ id: 'one' }] }); storage.write(file, { chats: [{ id: 'two' }] });
    fs.writeFileSync(file, '{broken'); const restored = storage.read(file);
    assert.equal(restored.recovered, true); assert.equal(restored.state.chats[0].id, 'one');
    storage.write(file, restored.state); assert.equal(storage.read(file).recovered, false);
    assert.ok(fs.readdirSync(root).some(name => name.includes('.corrupt-')));
    assert.ok(!fs.readdirSync(root).some(name => name.endsWith('.tmp')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('stale windows preserve their work without overwriting newer history', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-conflict-')), file = path.join(root, 'state.json');
  try {
    storage.write(file, { chats: [{ id: 'initial' }] });
    const first = storage.read(file), second = storage.read(file);
    const revision = storage.write(file, { chats: [{ id: 'newer' }] }, first.revision);
    assert.equal(storage.read(file).revision, revision);
    let conflict; try { storage.write(file, { chats: [{ id: 'local-work' }] }, second.revision); } catch (error) { conflict = error; }
    assert.equal(conflict.code, 'GPTIDE_CONFLICT');
    assert.equal(storage.read(file).state.chats[0].id, 'newer');
    assert.equal(storage.read(conflict.conflictFile).state.chats[0].id, 'local-work');
    assert.equal(fs.existsSync(file + '.lock'), false);
    fs.writeFileSync(file + '.lock', String(process.pid));
    assert.throws(() => storage.write(file, { chats: [] }, revision), error => error.code === 'GPTIDE_BUSY');
    assert.equal(storage.read(file).state.chats[0].id, 'newer');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
