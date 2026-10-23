const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const core=require('../tools/update-core.cjs'),network=require('../builtin/update-network.cjs'),service=require('../builtin/updates.cjs');
test('startup asks before downloading or installing; later is quiet and explicit approval upgrades once',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gptide-update-ui-')),root=path.join(dir,'install'),fresh=path.join(dir,'fresh'),data=path.join(dir,'data');for(const folder of [root,fresh,data])fs.mkdirSync(folder);t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  function file(folder,name,text){fs.mkdirSync(path.dirname(path.join(folder,name)),{recursive:true});fs.writeFileSync(path.join(folder,name),text);return {name,bytes:Buffer.byteLength(text),sha256:core.hash(path.join(folder,name))};}
  const current=require('../builtin/package.json').version,base={schema:1,version:current,files:[file(root,'app/editor.js','old'),...core.REQUIRED_FILES.map(name=>file(root,name,name==='tools/update-core.cjs'?fs.readFileSync(path.resolve(__dirname,'../tools/update-core.cjs'),'utf8'):'fixture'))]},next={schema:1,version:'99.0.0',files:[file(fresh,'app/editor.js','updated'),...base.files.slice(1)]};file(root,'gptide-release.json',JSON.stringify(base));file(root,'installation.ini','Version='+current);
  const archive=path.join(dir,`GPTIDE-Update-${current}-to-99.0.0.bin.gz`),info=await core.bundle(fresh,core.delta(base,next).changed,archive),update={schema:1,version:next.version,manifest:next,deltas:[{from:current,baseSha256:crypto.createHash('sha256').update(JSON.stringify(base)).digest('hex'),...info}]},bytes=Buffer.from(JSON.stringify(update));
  const release={tag_name:'v99.0.0',assets:[{id:1,name:'update-manifest.json',size:bytes.length,digest:'sha256:'+crypto.createHash('sha256').update(bytes).digest('hex')},{id:2,name:info.name,size:info.bytes,digest:'sha256:'+info.sha256}]};
  const oldJson=network.json,oldDownload=network.download,oldData=process.env.GPTIDE_DATA_HOME;process.env.GPTIDE_DATA_HOME=data;t.after(()=>{network.json=oldJson;network.download=oldDownload;if(oldData===undefined)delete process.env.GPTIDE_DATA_HOME;else process.env.GPTIDE_DATA_HOME=oldData;});
  let downloads=0,answer='稍后',dirty=true;network.json=async()=>release;network.download=async(url,file)=>{downloads++;fs.writeFileSync(file,url.endsWith('/1')?bytes:fs.readFileSync(archive));};
  const commands=new Map(),errors=[],messages=[],saved=new Map(),context={subscriptions:[],globalState:{get:key=>saved.get(key),update:async(key,value)=>saved.set(key,value)}};
  const vscode={StatusBarAlignment:{Right:1},ProgressLocation:{Notification:1},window:{createStatusBarItem:()=>({show(){},dispose(){}}),withProgress:async(options,task)=>task({report(){}},{onCancellationRequested:()=>({dispose(){}})}),showInformationMessage:async message=>{messages.push(message);return message.startsWith('发现 GPTIDE')?answer:undefined;},showErrorMessage:async message=>errors.push(message)},commands:{registerCommand:(name,run)=>{commands.set(name,run);return {dispose(){}};}}};
  vscode.workspace={getConfiguration:()=>({get:(key,fallback)=>fallback}),get textDocuments(){return[{isDirty:dirty}];}};
  const updater=service.install(vscode,context,root);await updater.autoCheck();assert.equal(downloads,1,'Only release metadata is fetched before consent');assert.deepEqual(errors,[]);assert.equal(messages.length,1);assert.equal(saved.get('gptide.readyUpdate'),undefined);assert.deepEqual(fs.readdirSync(path.join(data,'updates')),[]);
  await updater.autoCheck();assert.equal(downloads,1);assert.equal(messages.length,1,'Later must not repeatedly prompt');
  answer='升级并重启';await commands.get('gptide.checkForUpdates')();assert.equal(downloads,3);assert.equal(messages.length,2,'One approval covers download and install');core.verify(root,base.files);assert.equal(fs.existsSync(path.join(root,'.gptide-update')),false);assert.ok(saved.get('gptide.readyUpdate'));const folder=saved.get('gptide.readyUpdate').folder;assert.ok(fs.existsSync(path.join(folder,'prepared.json')));
  context.subscriptions.forEach(s=>s.dispose?.());
  answer='稍后';const second={subscriptions:[],globalState:context.globalState};service.install(vscode,second,root);await commands.get('gptide.checkForUpdates')();assert.equal(downloads,3);assert.deepEqual(errors,[]);second.subscriptions.forEach(s=>s.dispose?.());
  const Module=require('node:module'),{EventEmitter}=require('node:events'),original=Module.prototype.require,servicePath=require.resolve('../builtin/updates.cjs'),cached=require.cache[servicePath];let autoService,spawned=0,closeCommand;
  try{delete require.cache[servicePath];Module.prototype.require=function(id){const value=original.apply(this,arguments);if(id!=='node:child_process')return value;return{...value,spawn:()=>{spawned++;const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;}};};autoService=require('../builtin/updates.cjs');}finally{Module.prototype.require=original;require.cache[servicePath]=cached;}
  vscode.commands.executeCommand=async id=>{closeCommand=id;};
  const automatic={subscriptions:[],globalState:context.globalState},auto=autoService.install(vscode,automatic,root),beforePrompts=messages.length;
  await auto.autoCheck();assert.equal(spawned,0);assert.equal(messages.length,beforePrompts+1);
  dirty=false;await auto.autoCheck();assert.equal(spawned,0);assert.equal(messages.length,beforePrompts+1,'No cached approval may silently install a deferred update');
  answer='升级并重启';await commands.get('gptide.checkForUpdates')();assert.equal(spawned,1);assert.equal(closeCommand,'workbench.action.closeWindow');assert.equal(messages.length,beforePrompts+2);assert.equal(downloads,3);assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'plan.json'))).reopenOnTimeout,true);
  automatic.subscriptions.forEach(s=>s.dispose?.());
});

test('automatic restart waits for agents, unsaved text, notebooks, workspaces and debugging',()=>{
  const vscode={workspace:{textDocuments:[],notebookDocuments:[]},debug:{}};
  assert.equal(service.canAutoRestart(vscode,()=>false),true);assert.equal(service.canAutoRestart(vscode,()=>true),false);
  vscode.workspace.textDocuments=[{isDirty:true}];assert.equal(service.canAutoRestart(vscode,()=>false),false);vscode.workspace.textDocuments=[];
  vscode.workspace.notebookDocuments=[{isDirty:true}];assert.equal(service.canAutoRestart(vscode,()=>false),false);vscode.workspace.notebookDocuments=[];
  vscode.workspace.workspaceFile={scheme:'untitled'};assert.equal(service.canAutoRestart(vscode,()=>false),false);delete vscode.workspace.workspaceFile;
  vscode.debug.activeDebugSession={};assert.equal(service.canAutoRestart(vscode,()=>false),false);
});

test('installed startup schedules update checks immediately and disposal cancels the timer', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-startup-update-'));
  t.after(() => core.removeTree(path.dirname(root), path.basename(root)));
  fs.mkdirSync(path.join(root, 'tools')); fs.copyFileSync(path.resolve(__dirname, '../tools/update-core.cjs'), path.join(root, 'tools/update-core.cjs')); fs.writeFileSync(path.join(root, 'installation.ini'), '');
  const previous = global.setTimeout, calls = [], context = { subscriptions: [], globalState: { get: () => undefined } };
  const vscode = { StatusBarAlignment: { Right: 1 }, window: { createStatusBarItem: () => ({ show() {}, dispose() {} }) }, commands: { registerCommand: () => ({ dispose() {} }) } };
  try { global.setTimeout = (callback, delay) => { calls.push({ callback, delay }); return { unref() {} }; }; service.install(vscode, context, root); }
  finally { global.setTimeout = previous; }
  assert.equal(calls.length, 1); assert.equal(calls[0].delay, 0); context.subscriptions.forEach(value => value.dispose?.());
});

test('startup checks respect the switch, skip busy tasks and never open a login prompt',async t=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'gptide-auto-update-')),oldData=process.env.GPTIDE_DATA_HOME;process.env.GPTIDE_DATA_HOME=data;t.after(()=>{if(oldData===undefined)delete process.env.GPTIDE_DATA_HOME;else process.env.GPTIDE_DATA_HOME=oldData;core.removeTree(path.dirname(data),path.basename(data));});
  const root=path.resolve(__dirname,'..'),old=network.json;let reads=0,enabled=false,busy=false,prompts=0,errors=0;network.json=async()=>{reads++;throw Object.assign(Error('private'),{status:404});};t.after(()=>{network.json=old;});
  const context={subscriptions:[],globalState:{get:()=>undefined,update:async()=>{}}};
  const vscode={StatusBarAlignment:{Right:1},workspace:{getConfiguration:()=>({get:()=>enabled})},window:{createStatusBarItem:()=>({show(){},dispose(){}}),showInformationMessage:async()=>{prompts++;},showErrorMessage:async()=>{errors++;}},commands:{registerCommand:()=>({dispose(){}})}};
  const updater=service.install(vscode,context,root,()=>busy);await updater.autoCheck();assert.equal(reads,0);enabled=true;busy=true;await updater.autoCheck();assert.equal(reads,0);busy=false;await updater.autoCheck();assert.equal(reads,1);assert.equal(prompts,0);assert.equal(errors,0);context.subscriptions.forEach(s=>s.dispose?.());
});

test('workspace restart preserves saved multi-root and remote folders instead of silently opening the first root',()=>{
  const locations={data:'C:/data',extensions:'C:/extensions'},workspaceFile={scheme:'file',fsPath:'C:/work/team.code-workspace'},workspaceFolders=[{uri:{scheme:'file',fsPath:'C:/one'}},{uri:{scheme:'file',fsPath:'C:/two'}}];
  const saved=service.restartArgs({workspaceFile,workspaceFolders},locations);assert.equal(saved.at(-1),workspaceFile.fsPath);assert.equal(saved.includes('C:/one'),false);
  const folders=service.restartArgs({workspaceFolders},locations);assert.deepEqual(folders.slice(-2),['C:/one','C:/two']);
  assert.throws(()=>service.restartArgs({workspaceFile:{scheme:'untitled'}},locations),/保存当前工作区/);
  assert.deepEqual(service.restartArgs({workspaceFolders:[{uri:{scheme:'vscode-remote',toString:()=> 'vscode-remote://ssh-remote+dev/project'}}]},locations).slice(-2),['--folder-uri','vscode-remote://ssh-remote+dev/project']);
});

test('an interrupted transaction offers offline recovery before network or baseline verification',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gptide-recovery-ui-'));t.after(()=>core.removeTree(path.dirname(dir),path.basename(dir)));fs.mkdirSync(path.join(dir,'tools'));fs.copyFileSync(path.resolve(__dirname,'../tools/update-core.cjs'),path.join(dir,'tools/update-core.cjs'));fs.mkdirSync(path.join(dir,'.gptide-update'));fs.writeFileSync(path.join(dir,'.gptide-update/journal.json'),JSON.stringify({schema:1,entries:[]}));
  const old=network.json;let reads=0;network.json=async()=>{reads++;throw Error('must not reach network');};t.after(()=>{network.json=old;});const commands=new Map(),messages=[],context={subscriptions:[],globalState:{get:()=>undefined}};
  const vscode={StatusBarAlignment:{Right:1},window:{createStatusBarItem:()=>({show(){},dispose(){}}),showInformationMessage:async message=>{messages.push(message);},showErrorMessage:async message=>{throw Error(message);}},commands:{registerCommand:(id,callback)=>{commands.set(id,callback);return {dispose(){}};}}};
  service.install(vscode,context,dir);await commands.get('gptide.checkForUpdates')();assert.equal(reads,0);assert.ok(messages.some(m=>m.includes('上次更新未完成')));assert.ok(fs.existsSync(path.join(dir,'.gptide-update/journal.json')));context.subscriptions.forEach(s=>s.dispose?.());
});
