const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { within, snapshot, collectChanges, collectRoundChanges, canRevert } = require('../builtin/review.cjs');

test('round review captures terminal edits, adds and deletes without tool events and excludes unknown prior content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-round-'));
  try {
    const a = path.join(root, 'a.txt'), b = path.join(root, 'b.txt'), c = path.join(root, 'c.txt'), binary = path.join(root, 'binary.bin');
    fs.writeFileSync(a, 'before'); fs.writeFileSync(b, 'delete'); fs.writeFileSync(binary, Buffer.from([0, 1, 2]));
    const baseline = snapshot(root); fs.writeFileSync(a, 'after'); fs.unlinkSync(b); fs.writeFileSync(c, 'new'); fs.writeFileSync(binary, 'now text');
    const changes = collectRoundChanges(root, baseline, new Map([[process.platform === 'win32' ? a.toUpperCase() : a, 'update'], [binary, 'add']]));
    assert.equal(changes.length, 3); assert.equal(changes.find(change => change.path === c).before, null); assert.equal(changes.find(change => change.path === b).after, null); assert.equal(changes.find(change => change.path.toLowerCase() === a.toLowerCase()).before, 'before');
    assert.equal(changes.some(change => change.path === binary), false); assert.equal(changes.limited, false);
    const limited = { ...baseline, limited: true }; assert.equal(collectRoundChanges(root, limited).some(change => change.path === c), false);
    const skipped = { ...baseline, skipped: new Set([process.platform === 'win32' ? c.toLowerCase() : c]) };
    assert.equal(collectRoundChanges(root, skipped, new Map([[c, 'add']])).some(change => change.path === c), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
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
test('application source directories and relative tool paths are reviewed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-source-'));
  try {
    fs.mkdirSync(path.join(root, 'app')); const file = path.join(root, 'app', 'page.tsx'); fs.writeFileSync(file, 'before');
    const baseline = snapshot(root); fs.writeFileSync(file, 'after');
    assert.equal(collectChanges(root, baseline, new Map([['app/page.tsx', 'update']]))[0].before, 'before');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'gptide-desktop' }));
    assert.equal(snapshot(root).files.has(file.toLowerCase()), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
