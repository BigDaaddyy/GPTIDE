const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const paths=require('../builtin/data-paths.cjs');
test('user data and extensions use VS Code style locations independent of the installation',()=>{
 const result=paths.locations({APPDATA:'C:/fixture/Roaming',USERPROFILE:'C:/fixture/home'});
 assert.equal(result.data,path.resolve('C:/fixture/Roaming/GPTIDE'));assert.equal(result.extensions,path.resolve('C:/fixture/home/.gptide/extensions'));
});
test('default and named profiles resolve to the same application data root',()=>{
 const base=path.resolve('C:/fixture/Roaming/GPTIDE');
 assert.equal(paths.fromStorage(path.join(base,'User/globalStorage/gptide.chat')),base);
 const custom=path.resolve('C:/fixture/profiles');assert.equal(paths.fromStorage(path.join(custom,'User/globalStorage/gptide.chat')),custom);
 assert.equal(paths.fromStorage(path.join(base,'User/profiles/custom/globalStorage/gptide.chat')),base);
});
test('previous named-profile histories migrate without replacing existing root histories',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gptide-named-profile-')),profile=path.join(root,'User/profiles/custom');
 try{fs.mkdirSync(path.join(profile,'projects'),{recursive:true});fs.mkdirSync(path.join(root,'projects'));fs.writeFileSync(path.join(profile,'projects/old.json'),'old');fs.writeFileSync(path.join(profile,'projects/shared.json'),'legacy');fs.writeFileSync(path.join(root,'projects/shared.json'),'current');
  paths.migrateProfile(path.join(profile,'globalStorage/gptide.chat'),root);assert.equal(fs.readFileSync(path.join(root,'projects/old.json'),'utf8'),'old');assert.equal(fs.readFileSync(path.join(root,'projects/shared.json'),'utf8'),'current');assert.equal(fs.readFileSync(path.join(profile,'projects/shared.json'),'utf8'),'legacy');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('corrupt migration markers are backed up and recovered without overwriting destination data',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gptide-marker-recovery-')),where={data:path.join(root,'profile'),extensions:path.join(root,'extensions')};
 try{fs.mkdirSync(path.join(root,'data/projects'),{recursive:true});fs.mkdirSync(where.data);fs.writeFileSync(path.join(where.data,'.legacy-migrated.json'),'{ truncated');
  fs.writeFileSync(path.join(root,'data/projects/test.json'),'original');paths.migrate(root,where);
  assert.equal(fs.readFileSync(path.join(where.data,'projects/test.json'),'utf8'),'original');assert.equal(JSON.parse(fs.readFileSync(path.join(where.data,'.legacy-migrated.json'))).from,path.join(root,'data'));
  assert.ok(fs.readdirSync(where.data).some(x=>x.startsWith('.legacy-migrated.json.invalid-')));
  fs.writeFileSync(path.join(where.data,'projects/test.json'),'newer');fs.writeFileSync(path.join(where.data,'.legacy-migrated.json'),'null');paths.migrate(root,where);assert.equal(fs.readFileSync(path.join(where.data,'projects/test.json'),'utf8'),'newer');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('malformed extension indexes do not abort migration and are preserved',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gptide-index-recovery-')),where={data:path.join(root,'profile'),extensions:path.join(root,'extensions')};
 try{fs.mkdirSync(path.join(root,'data/extensions'),{recursive:true});fs.writeFileSync(path.join(root,'data/extensions/extensions.json'),'[null,{}]');assert.doesNotThrow(()=>paths.migrate(root,where));
  fs.writeFileSync(path.join(where.extensions,'extensions.json'),'{ incomplete');assert.doesNotThrow(()=>paths.migrate(root,where));assert.equal(fs.readFileSync(path.join(where.extensions,'extensions.json'),'utf8'),'{ incomplete');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('copying into a source descendant fails before creating a recursive tree',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gptide-copy-overlap-'));
 try{fs.writeFileSync(path.join(root,'snippet.json'),'{}');assert.throws(()=>paths.copyMissing(root,path.join(root,'nested')),/源目录/);assert.equal(fs.existsSync(path.join(root,'nested')),false);assert.doesNotThrow(()=>paths.copyMissing(root,root));}
 finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('corrupt marker recovery remains stable when the old installation has been removed',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gptide-marker-no-source-')),where={data:path.join(root,'profile'),extensions:path.join(root,'extensions')};
 try{fs.mkdirSync(where.data);fs.writeFileSync(path.join(where.data,'.legacy-migrated.json'),'null');paths.migrate(root,where);paths.migrate(root,where);
  assert.equal(fs.readdirSync(where.data).filter(x=>x.includes('.invalid-')).length,1);assert.equal(JSON.parse(fs.readFileSync(path.join(where.data,'.legacy-migrated.json'))).from,path.join(root,'data'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('legacy migration copies chats and profile once, keeps both originals and newer destination files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gptide-migration-')),where={data:path.join(root,'profile'),extensions:path.join(root,'extensions')};
 try{
  const put=(name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
  put('data/user/User/settings.json','old');put('data/projects/chat.json','chat');put('data/extensions/plugin/file','plugin');put('profile/User/settings.json','newer');
  put('data/extensions/extensions.json',JSON.stringify([{identifier:{id:'test.plugin'},location:{scheme:'file',path:path.join(root,'data/extensions/plugin').replaceAll('\\','/')},relativeLocation:'plugin'}]));
  paths.migrate(root,where);assert.equal(fs.readFileSync(path.join(where.data,'User/settings.json'),'utf8'),'newer');assert.equal(fs.readFileSync(path.join(where.data,'projects/chat.json'),'utf8'),'chat');
  assert.equal(fs.readFileSync(path.join(root,'data/projects/chat.json'),'utf8'),'chat');assert.equal(fs.readFileSync(path.join(where.extensions,'plugin/file'),'utf8'),'plugin');
  assert.equal(JSON.parse(fs.readFileSync(path.join(where.extensions,'extensions.json')))[0].location.path,path.join(where.extensions,'plugin').replaceAll('\\','/'));
  assert.equal(fs.readdirSync(path.join(where.data,'migration-backups')).length,1);
  put('data/projects/chat.json','old version changed');paths.migrate(root,where);assert.equal(fs.readFileSync(path.join(where.data,'projects/chat.json'),'utf8'),'chat');
  paths.ensureDefaults(where.data);assert.equal(fs.readFileSync(path.join(where.data,'User/settings.json'),'utf8'),'newer');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
