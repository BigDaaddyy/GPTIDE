const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { pathToFileURL } = require('node:url'); const { DatabaseSync } = require('node:sqlite');
const { importProject } = require('../tools/cursor-import.cjs');

test('modern global headers import only exact project roots without a local index', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-modern-'));
  try {
    const a = path.join(root, 'a'), b = path.join(root, 'b');
    const global = path.join(root, 'globalStorage'); fs.mkdirSync(global);
    const file = path.join(global, 'state.vscdb'), db = new DatabaseSync(file);
    db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY,value BLOB); CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY,value BLOB); CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, workspaceId TEXT, createdAt INTEGER, lastUpdatedAt INTEGER, isSubagent INTEGER, value TEXT)');
    const entries = [
      { workspaceId: 'a', folderUri: pathToFileURL(a).href, paths: [{ uri: { fsPath: a } }] },
      { workspaceId: 'b', paths: [{ uri: pathToFileURL(b).href }] },
      { workspaceId: 'shared', paths: [{ uri: { fsPath: a } }, { uri: { fsPath: b } }] }
    ];
    db.prepare('INSERT INTO ItemTable VALUES (?,?)').run('workspaceMetadata.entries', JSON.stringify({ entries }));
    const header = db.prepare('INSERT INTO composerHeaders VALUES (?,?,?,?,?,?)');
    const payload = db.prepare('INSERT INTO cursorDiskKV VALUES (?,?)');
    for (const [id, workspace, subagent, owner] of [['a1', 'a', 0, a], ['b1', 'b', 0, b], ['sub', 'a', 1, a], ['shared1', 'shared', 0, undefined], ['foreign', 'a', 0, b]]) {
      header.run(id, workspace, 10, 20, subagent, JSON.stringify({ name: id }));
      payload.run('composerData:' + id, JSON.stringify({ projectPath: owner, fullConversationHeadersOnly: [{ bubbleId: 'u' }, { bubbleId: 'r' }] }));
      payload.run('bubbleId:' + id + ':u', JSON.stringify({ type: 1, text: id }));
      payload.run('bubbleId:' + id + ':r', JSON.stringify({ type: 2, text: 'reply' }));
    }
    db.close(); const original = fs.readFileSync(file);
    assert.deepEqual(importProject(a, root).chats.map(c => c.name), ['a1']);
    assert.deepEqual(importProject(b, root).chats.map(c => c.name), ['b1']);
    assert.equal(importProject(a + '-other', root).chats.length, 0);
    assert.deepEqual(fs.readFileSync(file), original);
    // A real workspace descriptor wins over stale global directory metadata.
    const local = path.join(root, 'workspaceStorage', 'a'); fs.mkdirSync(local, { recursive: true });
    fs.writeFileSync(path.join(local, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(b).href }));
    assert.equal(importProject(a, root).chats.length, 0);
    fs.writeFileSync(path.join(local, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(a).href }));
    assert.deepEqual(importProject(a, root).chats.map(c => c.name), ['a1']);
    const config = path.join(root, 'shared.code-workspace');
    fs.writeFileSync(config, JSON.stringify({ folders: [{ path: a }, { path: b }] }));
    fs.writeFileSync(path.join(local, 'workspace.json'), JSON.stringify({ workspace: pathToFileURL(config).href }));
    assert.equal(importProject(a, root).chats.length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('exact project match, ordered messages and source database remains unchanged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-fixture-'));
  try {
    const workspace = path.join(root, 'workspaceStorage', 'fixture'); const global = path.join(root, 'globalStorage');
    fs.mkdirSync(workspace, { recursive: true }); fs.mkdirSync(global);
    const project = path.join(root, 'my-project');
    fs.writeFileSync(path.join(workspace, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(project).href }));
    const local = new DatabaseSync(path.join(workspace, 'state.vscdb'));
    local.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY,value BLOB)');
    local.prepare('INSERT INTO ItemTable VALUES (?,?)').run('composer.composerData', JSON.stringify({ allComposers: [{ composerId: 'chat1', name: 'Test', lastUpdatedAt: 100 }] })); local.close();
    const file = path.join(global, 'state.vscdb'); const db = new DatabaseSync(file);
    db.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY,value BLOB)'); const insert = db.prepare('INSERT INTO cursorDiskKV VALUES (?,?)');
    insert.run('composerData:chat1', Buffer.from(JSON.stringify({ fullConversationHeadersOnly: [{ bubbleId: 'u' }, { bubbleId: 'a' }] })));
    insert.run('bubbleId:chat1:u', Buffer.from(JSON.stringify({ type: 1, text: 'hello' })));
    insert.run('bubbleId:chat1:a', Buffer.from(JSON.stringify({ type: 2, text: 'world' }))); db.close();
    const original = fs.readFileSync(file); const result = importProject(project, root);
    assert.equal(result.chats.length, 1); assert.deepEqual(result.chats[0].messages.map(m => [m.role, m.text]), [['user', 'hello'], ['assistant', 'world']]);
    assert.equal(importProject(project + '-other', root).chats.length, 0);
    assert.deepEqual(fs.readFileSync(file), original);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('shared multi-root Cursor history and explicit foreign owners are excluded', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-isolated-'));
  try {
    const a = path.join(root, 'a'), b = path.join(root, 'b'), storage = path.join(root, 'workspaceStorage');
    const config = path.join(root, 'shared.code-workspace');
    fs.writeFileSync(config, JSON.stringify({ folders: [{ path: 'a' }, { path: 'b' }] }));
    function fixture(name, workspace, owner) {
      const directory = path.join(storage, name); fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'workspace.json'), JSON.stringify(workspace));
      const db = new DatabaseSync(path.join(directory, 'state.vscdb')); db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY,value BLOB)');
      db.prepare('INSERT INTO ItemTable VALUES (?,?)').run('composer.composerData', JSON.stringify({ allComposers: [{ composerId: name, projectPath: owner, conversation: [{ type: 1, text: name }] }] })); db.close();
    }
    fixture('shared', { workspace: pathToFileURL(config).href }, undefined);
    fixture('foreign-owner', { folder: pathToFileURL(a).href }, b);
    fixture('owned-a', { folder: pathToFileURL(a).href }, a);
    fixture('owned-b', { folder: pathToFileURL(b).href }, b);
    assert.deepEqual(importProject(a, root).chats.map(c => c.messages[0].text), ['owned-a']);
    assert.deepEqual(importProject(b, root).chats.map(c => c.messages[0].text), ['owned-b']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
