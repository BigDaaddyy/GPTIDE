const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const paths=require('../builtin/data-paths.cjs');
test('user data and extensions use VS Code style locations independent of the installation',()=>{
 const result=paths.locations({APPDATA:'C:/fixture/Roaming',USERPROFILE:'C:/fixture/home'});
 assert.equal(result.data,path.resolve('C:/fixture/Roaming/GPTIDE'));assert.equal(result.extensions,path.resolve('C:/fixture/home/.gptide/extensions'));
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
