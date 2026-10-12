const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { within, snapshot, collectChanges, canRevert } = require('../builtin/review.cjs');
test('review detects edits/additions/deletions and protects later user edits', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-review-'));
  try {
    const changed = path.join(root, 'one.txt'), deleted = path.join(root, 'two.txt'), added = path.join(root, 'three.txt');
    fs.writeFileSync(changed, 'before'); fs.writeFileSync(deleted, 'delete me');
    const baseline = snapshot(root); fs.writeFileSync(changed, 'after'); fs.unlinkSync(deleted); fs.writeFileSync(added, 'new');
    const changes = collectChanges(root, baseline, new Map([[changed, 'update'], [deleted, 'delete'], [added, 'add']]));
    assert.equal(changes.length, 3); assert.equal(changes.find(c => c.path === added).before, null);
    assert.equal(changes.find(c => c.path === deleted).after, null);
    assert.equal(canRevert(changes[0]), true); fs.writeFileSync(changed, 'user edits'); assert.equal(canRevert(changes[0]), false);
    assert.equal(within(root, path.join(root, '..', 'elsewhere.txt')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
