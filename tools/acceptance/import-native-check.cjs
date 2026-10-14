const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { execFile } = require('node:child_process'), { promisify } = require('node:util');
const { root, artifacts } = require('../acceptance-env.cjs');
(async () => {
  const qa = path.join(artifacts,'import-native-'+Date.now()), plugin = path.join(qa,'source'), target = path.join(qa,'extensions'); fs.mkdirSync(plugin,{recursive:true});
  const manifest = { name:'offline-theme',publisher:'gptide-qa',version:'1.0.0',engines:{vscode:'^1.100.0'},displayName:'Offline QA theme',contributes:{themes:[{label:'Offline QA Light',uiTheme:'vs',path:'./theme.json'}]} };
  fs.writeFileSync(path.join(plugin,'package.json'),JSON.stringify(manifest));fs.writeFileSync(path.join(plugin,'theme.json'),JSON.stringify({colors:{'editor.background':'#ffffff'},tokenColors:[]}));fs.writeFileSync(path.join(plugin,'中文.txt'),'UTF8 fixture');
  const file=path.join(qa,'fixture.vsix');await require('../../builtin/vscode-import.cjs').packagePlugin({directory:plugin,manifest},file);
  await promisify(execFile)(path.join(root,'app/VSCodium.exe'),[path.join(root,'app/resources/app/out/cli.js'),'--user-data-dir',path.join(qa,'user'),'--shared-data-dir',path.join(qa,'shared'),'--extensions-dir',target,'--install-extension',file],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',VSCODE_DEV:''},windowsHide:true,timeout:60000});
  const installed=fs.readdirSync(target).find(name=>name.startsWith('gptide-qa.offline-theme-'));assert.ok(installed);assert.equal(fs.readFileSync(path.join(target,installed,'中文.txt'),'utf8'),'UTF8 fixture');assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target,installed,'package.json'))).contributes,manifest.contributes);
  console.log('Actual isolated installer accepts streamed VSIX and preserves UTF8 content and theme manifest; no model connection.');
})().catch(error=>{console.error(error);process.exitCode=1;});
