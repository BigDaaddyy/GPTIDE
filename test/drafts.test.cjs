const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { Drafts } = require('../builtin/drafts.cjs');
test('project drafts recover independently of old main history and preserve explicit clearing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-draft-'));
  try {
    const file = path.join(root, 'drafts.json'), drafts = new Drafts(file, 'project-a');
    drafts.set('one', 'latest draft', 100); drafts.set('two', '', 101);
    const chats = [{ id: 'one', draft: 'old', draftUpdatedAt: 20 }, { id: 'two', draft: 'old API value', draftUpdatedAt: 10 }, { id: 'foreign', draft: 'untouched' }];
    new Drafts(file, 'project-a').apply(chats);
    assert.equal(chats[0].draft, 'latest draft'); assert.equal(chats[1].draft, ''); assert.equal(chats[2].draft, 'untouched');
    assert.throws(() => new Drafts(file, 'project-b'), /不属于/);
    fs.writeFileSync(file, '{ corrupt');
    const restored = new Drafts(file, 'project-a'); assert.ok(restored.recovered); assert.equal(restored.records.get('one').draft, 'latest draft');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('stale draft windows preserve one conflict file and do not overwrite newer drafts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-draft-conflict-'));
  try {
    const file = path.join(root, 'drafts.json'), first = new Drafts(file, 'project'); first.set('chat', 'initial', 10);
    const second = new Drafts(file, 'project'); first.set('chat', 'newer', 20);
    assert.throws(() => second.set('chat', 'local edit', 21)); const conflict = second.conflictFile; assert.ok(conflict);
    assert.throws(() => second.set('chat', 'continued local edit', 22), /冲突副本/);
    assert.equal(new Drafts(file, 'project').records.get('chat').draft, 'newer');
    assert.equal(JSON.parse(fs.readFileSync(conflict)).chats[0].draft, 'continued local edit');
    assert.equal(fs.readdirSync(root).filter(n => n.includes('.conflict-') && n.endsWith('.json')).length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
