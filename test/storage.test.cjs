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

test('structurally corrupt history recovers without replacing good backup or losing evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-structure-')), file = path.join(root, 'state.json');
  try {
    const good = { chats: [{ id: 'safe', messages: [{ role: 'user', text: 'safe' }] }] };
    storage.write(file, good); storage.write(file, { chats: [{ id: 'new' }] });
    const broken = JSON.stringify({ chats: [null], openChatIds: {} }); fs.writeFileSync(file, broken);
    const recovered = storage.read(file); assert.equal(recovered.recovered, true); assert.deepEqual(recovered.state, good);
    storage.write(file, recovered.state, recovered.revision); assert.deepEqual(JSON.parse(fs.readFileSync(file + '.bak')), good);
    const evidence = fs.readdirSync(root).find(name => name.includes('.corrupt-')); assert.equal(fs.readFileSync(path.join(root, evidence), 'utf8'), broken);
    assert.throws(() => storage.write(file, { chats: [{ id: 'x', messages: {} }] }), /历史结构/);
    assert.deepEqual(storage.read(file).state, good);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('empty crash lock eventually recovers while a fresh lock remains protected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-lock-')), file = path.join(root, 'state.json');
  try {
    fs.writeFileSync(file + '.lock', ''); assert.throws(() => storage.write(file, { chats: [] }), error => error.code === 'GPTIDE_BUSY');
    const old = new Date(Date.now() - 120000); fs.utimesSync(file + '.lock', old, old); storage.write(file, { chats: [] }); assert.equal(fs.existsSync(file + '.lock'), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('foreign primary history restores only matching backup and preserves both source records', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-owner-backup-')), file = path.join(root, 'state.json');
  try {
    const own = { projectKey: 'own', projectPath: root, chats: [{ id: 'own', projectKey: 'own' }] }, foreign = { projectKey: 'foreign', chats: [{ id: 'foreign', messages: [{ text: 'foreign fixture' }] }] };
    fs.writeFileSync(file, JSON.stringify(foreign)); fs.writeFileSync(file + '.bak', JSON.stringify(own));
    const guard = state => require('../builtin/project-scope.cjs').validateState(state, 'own', root), restored = storage.read(file, guard);
    assert.equal(restored.recovered, true); assert.deepEqual(restored.state, own); storage.write(file, restored.state, restored.revision, guard);
    assert.deepEqual(JSON.parse(fs.readFileSync(file + '.bak')), own);
    const evidence = fs.readdirSync(root).find(name => name.includes('.corrupt-')); assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, evidence))), foreign);
    assert.throws(() => storage.write(file, foreign, undefined, guard), error => error.code === 'GPTIDE_FOREIGN'); assert.deepEqual(storage.read(file, guard).state, own);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
