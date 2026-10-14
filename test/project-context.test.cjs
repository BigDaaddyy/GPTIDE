const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { ProjectContext } = require('../builtin/project-context.cjs');
test('project context restores paths and rules, reads fresh files and respects exclusions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-pinned-'));
  try {
    fs.mkdirSync(path.join(root, 'src')); const file = path.join(root, 'src', 'a.js'), state = path.join(root, 'context.json'); fs.writeFileSync(file, 'before');
    const context = new ProjectContext(state, root, 'owner'); context.save({ files: ['src/a.js'], excluded: [], rules: 'Use tests' });
    fs.writeFileSync(file, 'after'); const restored = new ProjectContext(state, root, 'owner'); const read = restored.read();
    assert.ok(read.text.includes('after')); assert.ok(!read.text.includes('before')); assert.ok(read.text.includes('Use tests')); assert.deepEqual(restored.labels(), ['项目规则', 'src/a.js']);
    assert.ok(!fs.readFileSync(state, 'utf8').includes('after'));
    restored.save({ excluded: ['src/'] }); assert.ok(!restored.read().text.includes('after')); assert.deepEqual(restored.labels(), ['项目规则']);
    restored.save({ excluded: [] }); fs.unlinkSync(file); assert.ok(restored.read().warnings[0].includes('src/a.js'));
    assert.ok(restored.read(5).text.length <= 5);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('project context rejects foreign ownership, traversal and stale window overwrites', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-pinned-safe-'));
  try {
    const file = path.join(root, 'context.json'), first = new ProjectContext(file, root, 'owner'), stale = new ProjectContext(file, root, 'owner');
    assert.throws(() => first.save({ files: ['../foreign'] }), /路径无效/); assert.throws(() => first.save({ rules: 'x'.repeat(30001) }), /30000/);
    first.save({ rules: 'new rules' }); assert.throws(() => stale.save({ rules: 'stale rules' }), /另一窗口/); assert.equal(new ProjectContext(file, root, 'owner').state.rules, 'new rules');
    assert.throws(() => new ProjectContext(file, root, 'foreign'), /当前项目/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
