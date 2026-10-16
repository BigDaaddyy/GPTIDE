const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
test('launcher opens the GUI even when invoked from an Electron Node environment', () => {
  let invoked, unreferenced = false;
  const environment = { ELECTRON_RUN_AS_NODE: '1', PATH: 'retained' };
  const fakeProcess = { env: environment, argv: ['node', 'launch.cjs', 'C:/project with spaces'] };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../tools/launch.cjs'),'utf8'), {
    __dirname: path.join(__dirname,'../tools'), process: fakeProcess, console,
    require: name => name === 'node:child_process' ? { spawn: (...args) => { invoked = args; return { on() {}, unref() { unreferenced = true; } }; } } : require(name)
  });
  assert.equal(path.basename(invoked[0]), 'GPTIDE.exe');
  assert.equal(invoked[2].env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(invoked[2].env.PATH, 'retained');
  assert.equal(environment.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(invoked[1].at(-1), 'C:/project with spaces');
  assert.ok(unreferenced);
});
