const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { pathToFileURL } = require('node:url'); const { DatabaseSync } = require('node:sqlite');
const { importProject } = require('../tools/cursor-import.cjs');
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
