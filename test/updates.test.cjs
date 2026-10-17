const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const core=require('../tools/update-core.cjs'),service=require('../builtin/updates.cjs'),network=require('../builtin/update-network.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'gptide-update-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const installed=path.join(root,'installed'),fresh=path.join(root,'fresh'),staged=path.join(root,'staged');for(const dir of [installed,fresh,staged])fs.mkdirSync(dir);return {root,installed,fresh,staged};}
function put(root,name,text){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);return {name,bytes:Buffer.byteLength(text),sha256:core.hash(file)};}
function manifest(version,files){return core.validate({schema:1,version,files});}
test('streaming delta round-trip adds changes, removes obsolete files, retains user data and updates version',async t=>{
  const f=fixture(t),old=manifest('1.9.0',[put(f.installed,'app/editor.js','old'),put(f.installed,'assets/obsolete.txt','old asset'),put(f.installed,'runtime/node.exe','unchanged')]);
  const next=manifest('1.9.1',[put(f.fresh,'app/editor.js','updated'),put(f.fresh,'tools/new.cjs','new'),put(f.fresh,'runtime/node.exe','unchanged')]);
  fs.writeFileSync(path.join(f.installed,'gptide-release.json'),JSON.stringify(old));fs.writeFileSync(path.join(f.installed,'installation.ini'),'[GPTIDE]\r\nVersion=1.9.0\r\nTestMode=1');put(f.installed,'data/chat.json','private');
  const changes=core.delta(old,next);assert.equal(changes.changed.length,2);assert.equal(changes.removed.length,1);
  const archive=path.join(f.root,'delta.gz');await core.bundle(f.fresh,changes.changed,archive);await core.extract(archive,f.staged,changes.changed);core.apply(f.installed,f.staged,old,next);
  core.verify(f.installed,next.files);assert.equal(fs.existsSync(path.join(f.installed,'assets/obsolete.txt')),false);assert.equal(fs.readFileSync(path.join(f.installed,'data/chat.json'),'utf8'),'private');assert.match(fs.readFileSync(path.join(f.installed,'installation.ini'),'utf8'),/Version=1.9.1/);assert.equal(fs.existsSync(path.join(f.installed,'.gptide-update')),false);
});
test('failed replacement rolls back changed files, additions and manifest',t=>{
  const f=fixture(t),base=manifest('1.9.0',[put(f.installed,'app/a.js','original'),put(f.installed,'app/b.js','second')]);
  const next=manifest('1.9.1',[put(f.staged,'app/a.js','changed'),put(f.staged,'app/new.js','addition'),put(f.staged,'app/b.js','changed second')]);
  fs.writeFileSync(path.join(f.installed,'gptide-release.json'),JSON.stringify(base));fs.writeFileSync(path.join(f.installed,'installation.ini'),'Version=1.9.0');let count=0;
  assert.throws(()=>core.apply(f.installed,f.staged,base,next,{beforeWrite:()=>{if(++count===3)throw Error('simulated lock');}}),/simulated lock/);core.verify(f.installed,base.files);assert.equal(fs.existsSync(path.join(f.installed,'app/new.js')),false);assert.equal(JSON.parse(fs.readFileSync(path.join(f.installed,'gptide-release.json'))).version,'1.9.0');
});
test('local modifications and corrupt download prevent any program writes',async t=>{
  const f=fixture(t),base=manifest('1.9.0',[put(f.installed,'app/a','original')]),next=manifest('1.9.1',[put(f.staged,'app/a','new')]);fs.writeFileSync(path.join(f.installed,'gptide-release.json'),JSON.stringify(base));fs.writeFileSync(path.join(f.installed,'installation.ini'),'Version=1.9.0');put(f.installed,'app/a','local edit');
  assert.throws(()=>core.apply(f.installed,f.staged,base,next),/校验/);assert.equal(fs.readFileSync(path.join(f.installed,'app/a'),'utf8'),'local edit');
  const archive=path.join(f.root,'broken.gz');fs.writeFileSync(archive,'bad gzip');await assert.rejects(core.extract(archive,path.join(f.root,'out'),next.files));assert.equal(fs.existsSync(path.join(f.installed,'.gptide-update')),false);
});
test('unsafe paths, duplicate names, case renames and symlinks are refused',t=>{
  for(const name of ['../auth.json','data/chat.json','app/../../secret','app/CON','app/a:b','app/x.','app\\x','app//x'])assert.throws(()=>core.safeName(name));
  const f=fixture(t),entry=put(f.installed,'app/a','x');assert.throws(()=>manifest('1.9.0',[entry,{...entry,name:'app/A'}]),/清单/);assert.throws(()=>core.delta(manifest('1.9.0',[entry]),manifest('1.9.1',[{...entry,name:'app/A'}])),/大小写/);
  const external=path.join(f.root,'external');fs.mkdirSync(external);fs.symlinkSync(external,path.join(f.installed,'tools'),process.platform==='win32'?'junction':'dir');assert.throws(()=>core.target(f.installed,'tools/evil.js'),/链接/);fs.unlinkSync(path.join(f.installed,'tools'));
});
test('release selection pins base manifest, target tag and GitHub asset digest',()=>{
  const entry={name:'app/a',bytes:1,sha256:'a'.repeat(64)},files=[entry,...core.REQUIRED_FILES.map(name=>({...entry,name}))],base=manifest('1.9.0',files),next=manifest('1.9.1',files),name='GPTIDE-Update-1.9.0-to-1.9.1.bin.gz',sha='b'.repeat(64);
  const release={tag_name:'v1.9.1',assets:[{id:1,name,size:123,digest:'sha256:'+sha}]},update={schema:1,version:'1.9.1',manifest:next,deltas:[{from:'1.9.0',baseSha256:crypto.createHash('sha256').update(JSON.stringify(base)).digest('hex'),name,bytes:123,sha256:sha}]};
  assert.ok(service.selectDelta(core,release,update,base));assert.equal(service.selectDelta(core,release,update,{...base,version:'1.8.0'}),null);assert.throws(()=>service.selectDelta(core,{...release,tag_name:'v1.9.2'},update,base));assert.throws(()=>service.selectDelta(core,{...release,assets:[{...release.assets[0],digest:'sha256:'+'c'.repeat(64)}]},update,base));
  assert.equal(service.newer('1.10.0','1.9.9'),true);assert.equal(service.newer('1.9.0','1.9.0'),false);assert.equal(service.newer('junk','1.9.0'),false);
  for(const url of ['http://api.github.com/x','https://example.com/x','https://api.github.com@evil.com/x','https://api.github.com:444/x'])assert.throws(()=>network.allowed(url));assert.equal(network.allowed('https://release-assets.githubusercontent.com/x').protocol,'https:');
});

test('release builder emits direct delta packages for multiple supported old versions',async t=>{
  const f=fixture(t),output=path.join(f.root,'release'),payload=path.join(output,'payload');fs.mkdirSync(payload,{recursive:true});
  const entry=put(payload,'app/editor.js','new release');fs.writeFileSync(path.join(output,'payload-manifest.json'),JSON.stringify({version:'1.9.2',files:[entry]}));
  const paths=[];for(const version of ['1.9.0','1.9.1']){const file=path.join(f.root,version+'.json');fs.writeFileSync(file,JSON.stringify({schema:1,version,files:[{...entry,sha256:'a'.repeat(64)}]}));paths.push(file);}
  const update=await require('../tools/update-build.cjs').build(output,paths);assert.equal(update.deltas.length,2);for(const d of update.deltas){assert.equal(core.hash(path.join(output,d.name)),d.sha256);assert.ok(d.bytes>0);}assert.equal(JSON.parse(fs.readFileSync(path.join(payload,'gptide-release.json'))).version,'1.9.2');
});

test('persisted journal restores a partially applied transaction after the helper exits abruptly',t=>{
  const f=fixture(t),base=manifest('1.9.0',[put(f.installed,'app/a','old A'),put(f.installed,'app/b','old B')]),next=manifest('1.9.1',[put(f.staged,'app/a','new A'),put(f.staged,'app/b','new B')]);
  fs.writeFileSync(path.join(f.installed,'gptide-release.json'),JSON.stringify(base));fs.writeFileSync(path.join(f.installed,'installation.ini'),'Version=1.9.0');
  const child=require('node:child_process').spawnSync(process.execPath,['-e',"const core=require(process.argv[1]),plan=JSON.parse(process.argv[2]);let count=0;core.apply(plan.root,plan.stage,plan.base,plan.next,{beforeWrite:()=>{if(++count===2)process.exit(23);}});",path.resolve(__dirname,'../tools/update-core.cjs'),JSON.stringify({root:f.installed,stage:f.staged,base,next})],{windowsHide:true});
  assert.equal(child.status,23);assert.equal(fs.readFileSync(path.join(f.installed,'app/a'),'utf8'),'new A');core.recover(f.installed);core.verify(f.installed,base.files);assert.equal(fs.existsSync(path.join(f.installed,'.gptide-update')),false);
});

test('transaction cleanup handles Chinese paths without following links or escaping the target',t=>{
  const f=fixture(t),root=path.join(f.root,'中文安装目录');fs.mkdirSync(root);put(root,'.gptide-update/backup/app/a','backup');core.removeTree(root,'.gptide-update');assert.equal(fs.existsSync(path.join(root,'.gptide-update')),false);
  assert.throws(()=>core.removeTree(root,'..'),/越界/);assert.throws(()=>core.removeTree(root,'.'),/越界/);
  const outside=path.join(f.root,'outside');fs.mkdirSync(outside);put(outside,'keep','keep');fs.mkdirSync(path.join(root,'.gptide-update'));fs.symlinkSync(outside,path.join(root,'.gptide-update/link'),process.platform==='win32'?'junction':'dir');core.removeTree(root,'.gptide-update');assert.equal(fs.readFileSync(path.join(outside,'keep'),'utf8'),'keep');
});
