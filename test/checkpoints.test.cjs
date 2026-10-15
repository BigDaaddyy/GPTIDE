const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { Checkpoints } = require('../builtin/checkpoints.cjs');
function fixture(action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-checkpoint-'));
  try { const project = path.join(root, 'project'); fs.mkdirSync(project); return action(new Checkpoints(path.join(root, 'cache'), project, 'owner'), project); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('multi-round content is immutable, deduplicated and recoverable after restart', () => fixture((store, project) => {
  const file = path.join(project, 'a.txt');
  const first = store.create([{ path: file, before: 'A\r\n', after: 'B\r\n' }], 1);
  const second = store.create([{ path: file, before: 'B\r\n', after: 'C\r\n' }], 2);
  assert.equal(first.changes[0].afterRef, second.changes[0].beforeRef);
  assert.equal(fs.readdirSync(store.blobs).length, 3);
  fs.writeFileSync(file, 'unrelated live edit');
  const restarted = new Checkpoints(store.directory, project, 'owner');
  const metadata = restarted.load(first)[0]; assert.equal(metadata.before, undefined);
  assert.equal(restarted.materialize(metadata).after, 'B\r\n');
  assert.equal(restarted.materialize(restarted.load(second)[0]).after, 'C\r\n');
}));
test('foreign owners, traversal paths and corrupt blobs cannot be read', () => fixture((store, project) => {
  const checkpoint = store.create([{ path: path.join(project, 'a'), before: null, after: 'new' }]);
  assert.throws(() => store.load({ ...checkpoint, projectKey: 'foreign' }), /当前项目/);
  assert.throws(() => store.load({ ...checkpoint, changes: [{ ...checkpoint.changes[0], relative: '../escape' }] }), /越界/);
  fs.writeFileSync(path.join(store.blobs, checkpoint.changes[0].afterRef), 'corrupt');
  assert.throws(() => store.materialize(store.load(checkpoint)[0]), /缺失或损坏/);
}));
test('creation and deletion preserve null content, cache budget and writer lock', () => fixture((store, project) => {
  const created = store.create([{ path: path.join(project, 'new'), before: null, after: 'new' }]);
  const deleted = store.create([{ path: path.join(project, 'old'), before: 'old', after: null }]);
  assert.equal(store.materialize(store.load(created)[0]).before, null);
  assert.equal(store.materialize(store.load(deleted)[0]).after, null);
  store.maximumBytes = store.usage();
  assert.throws(() => store.create([{ path: path.join(project, 'large'), before: null, after: 'large' }]), /上限/);
  assert.throws(() => store.withLock(() => store.create([])), /另一窗口/);
  assert.equal(fs.existsSync(path.join(store.directory, 'write.lock')), false);
}));
test('cache cleanup protects retained and recent content and only removes old unreferenced blobs', () => fixture((store, project) => {
  const keep = store.create([{ path: path.join(project, 'keep'), before: null, after: 'keep' }]);
  const old = store.create([{ path: path.join(project, 'old'), before: null, after: 'old' }]);
  const recent = store.create([{ path: path.join(project, 'recent'), before: null, after: 'recent' }]);
  const time = new Date(Date.now() - 120000);
  fs.utimesSync(path.join(store.blobs, old.changes[0].afterRef), time, time);
  fs.utimesSync(path.join(store.blobs, keep.changes[0].afterRef), time, time);
  assert.deepEqual(store.gc([keep]), { removed: 1, bytes: 3 });
  assert.equal(store.get(keep.changes[0].afterRef), 'keep');
  assert.equal(store.get(recent.changes[0].afterRef), 'recent');
}));

test('legacy total-file line counts are recalculated without changing stored checkpoint data',()=>fixture((store,project)=>{
 const record=store.create([{path:path.join(project,'a.txt'),before:'same\nold\nsame\n',after:'same\nnew\nsame\n'}]);delete record.changes[0].statsVersion;record.changes[0].added=100;record.changes[0].removed=100;const loaded=store.load(record)[0];assert.equal(loaded.added,1);assert.equal(loaded.removed,1);assert.equal(loaded.statsVersion,1);assert.equal(record.changes[0].added,100);
}));
