const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { cachedImport } = require('../builtin/cursor-cache.cjs');
test('Cursor startup cache skips unchanged scans, invalidates changed sources and isolates projects',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gptide-cache-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const userRoot=path.join(root,'Cursor/User'),file=path.join(root,'cache.json'),project=path.join(root,'project');fs.mkdirSync(path.join(userRoot,'globalStorage'),{recursive:true});
  let calls=0;const load=async()=>{calls++;return {chats:[{id:'cursor:test',source:'cursor',messages:[{text:'hello'}]}],warnings:[]};};const options={project,userRoot,file,load};
  await cachedImport(options);await cachedImport(options);assert.equal(calls,1);
  fs.writeFileSync(path.join(userRoot,'globalStorage/state.vscdb-wal'),'changed');await cachedImport(options);assert.equal(calls,2);
  await cachedImport({...options,project:path.join(root,'other')});assert.equal(calls,3);
  await cachedImport(options);assert.equal(calls,4);await cachedImport({...options,force:true});assert.equal(calls,5);
  fs.writeFileSync(file,'{ broken');await cachedImport(options);assert.equal(calls,6);
  await cachedImport({...options,userRoot:path.join(root,'otherCursor')});assert.equal(calls,7);
});
test('Cursor cache rejects partial scans and notices external workspace configuration changes',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gptide-cache-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const userRoot=path.join(root,'User'),folder=path.join(userRoot,'workspaceStorage/id'),config=path.join(root,'test.code-workspace'),file=path.join(root,'cache.json');fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(config,'{}');fs.writeFileSync(path.join(folder,'workspace.json'),JSON.stringify({workspace:require('node:url').pathToFileURL(config).href}));
  let calls=0;const options={project:root,userRoot,file,load:async()=>{calls++;return {chats:[],warnings:[]};}};
  await cachedImport(options);await cachedImport(options);assert.equal(calls,1);fs.writeFileSync(config,'{"folders":[]}');await cachedImport(options);assert.equal(calls,2);
  await cachedImport({...options,force:true,load:async()=>{fs.writeFileSync(config,'{"folders":[{}]}');return {chats:[],warnings:[]};}});await cachedImport(options);assert.equal(calls,3);
  fs.rmSync(file);let warnings=0;const partial={...options,load:async()=>{warnings++;return {chats:[],warnings:['locked']};}};await cachedImport(partial);await cachedImport(partial);assert.equal(warnings,2);
});
