const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const context = require('../builtin/context.cjs');
test('diagnostics stay inside project and include useful source locations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-context-'));
  try {
    const project = path.join(root, 'a'); fs.mkdirSync(project);
    const item = { severity: 0, message: 'Expected expression', range: { start: { line: 2, character: 4 } }, code: 1000 };
    const text = context.diagnostics(project, [[{ scheme: 'file', fsPath: path.join(project, 'app.js') }, [item]], [{ scheme: 'file', fsPath: path.join(root, 'foreign.js') }, [{ ...item, message: 'private sibling' }]]]);
    assert.ok(text.includes('app.js:3:5')); assert.ok(text.includes('Expected expression')); assert.ok(!text.includes('private sibling'));
    const long = context.diagnostics(project, [[{ scheme: 'file', fsPath: path.join(project, 'app.js') }, Array(80).fill(item)]]);
    assert.equal(long.split('\n').length, 51);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('folder references enforce folder scope, exclude binary and bound context', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-folder-'));
  try {
    const folder = path.join(root, 'folder'); fs.mkdirSync(folder);
    const text = path.join(folder, 'file.js'), binary = path.join(folder, 'binary'), sibling = path.join(root, 'other.js');
    fs.writeFileSync(text, 'hello '.repeat(1000)); fs.writeFileSync(binary, Buffer.from([0, 1, 2])); fs.writeFileSync(sibling, 'outside folder');
    const result = context.folderText(root, folder, [text, binary, sibling], 100);
    assert.equal(result.count, 1); assert.ok(result.text.length <= 100); assert.ok(!result.text.includes('outside folder')); assert.ok(result.limited);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('Git context covers only the selected project even when repository root is its parent', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-git-'));
  try {
    const run = args => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });
    const project = path.join(root, 'owned'); fs.mkdirSync(project); fs.writeFileSync(path.join(project, 'app.txt'), 'before\n'); fs.writeFileSync(path.join(root, 'sibling.txt'), 'outside\n');
    run(['init', '--quiet']); run(['add', '.']); run(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'fixture']);
    fs.writeFileSync(path.join(project, 'app.txt'), 'after\n'); fs.writeFileSync(path.join(root, 'sibling.txt'), 'private sibling changed\n');
    const diff = await context.gitDiff(project); assert.ok(diff.includes('+after')); assert.ok(!diff.includes('private sibling'));
    assert.equal(await context.gitDiff(project, true), '');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
