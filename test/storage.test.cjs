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
