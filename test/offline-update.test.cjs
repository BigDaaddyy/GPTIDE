const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const core=require('../tools/update-core.cjs'),offline=require('../tools/offline-update.cjs');
test('small offline updater verifies an exact installed baseline and stages changes without modifying it',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gptide-offline-update-'));t.after(()=>core.removeTree(path.dirname(dir),path.basename(dir)));
  const root=path.join(dir,'install'),fresh=path.join(dir,'fresh'),bundle=path.join(dir,'bundle'),data=path.join(dir,'data');for(const folder of [root,fresh,bundle,data])fs.mkdirSync(folder);
  const file=(folder,name,text)=>{const dest=path.join(folder,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,text);return{name,bytes:Buffer.byteLength(text),sha256:core.hash(dest)};};
  const base={schema:1,version:'1.9.3',files:[...core.REQUIRED_FILES.map(name=>file(root,name,'fixture')),file(root,'README.md','old')]};
  file(root,'installation.ini','Version=1.9.3');file(root,'gptide-release.json',JSON.stringify(base));
  const next={schema:1,version:'1.9.4',files:[...base.files.slice(0,-1),file(fresh,'README.md','updated')]};
  const archive=path.join(bundle,'GPTIDE-Update-1.9.3-to-1.9.4.bin.gz'),info=await core.bundle(fresh,core.delta(base,next).changed,archive);
  const update={schema:1,version:next.version,manifest:next,deltas:[{from:base.version,baseSha256:crypto.createHash('sha256').update(JSON.stringify(base)).digest('hex'),...info}]};file(bundle,'update-manifest.json',JSON.stringify(update));
  const staged=await offline.prepare(root,bundle,data),plan=JSON.parse(fs.readFileSync(staged.plan));
  assert.equal(fs.readFileSync(path.join(plan.staged,'README.md'),'utf8'),'updated');core.verify(root,base.files);assert.equal(fs.existsSync(path.join(root,'.gptide-update')),false);
  fs.appendFileSync(archive,'bad');await assert.rejects(offline.prepare(root,bundle,data),/校验失败/);assert.equal(fs.readdirSync(path.join(data,'updates')).length,1);
  fs.writeFileSync(archive,fs.readFileSync(archive).subarray(0,-3));file(root,'README.md','user modified');await assert.rejects(offline.prepare(root,bundle,data),/校验不一致/);
});
