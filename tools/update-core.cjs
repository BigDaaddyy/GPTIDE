const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises'), { Readable } = require('node:stream');
const ROOT_FILES = new Set(['README.md','CHANGELOG.md','UPDATES.md','package.json','启动GPTIDE.cmd']);
const REQUIRED_FILES=['app/GPTIDE.exe','runtime/node.exe','tools/launch.cjs','tools/update-core.cjs','tools/update-worker.cjs','package.json','app/resources/app/product.json','app/resources/app/extensions/gptide-chat/package.json','app/resources/app/extensions/gptide-chat/extension.cjs','app/resources/app/extensions/gptide-chat/updates.cjs','app/resources/app/extensions/gptide-chat/update-network.cjs'];
function removeFile(file){try{fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
function removeTree(root,relative){
  const base=path.resolve(root),folder=path.resolve(base,relative);if(folder===base||!folder.startsWith(base+path.sep))throw Error('清理目录越界');
  function visit(file){let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return;throw error;}if(stat.isDirectory()&&!stat.isSymbolicLink()){for(const name of fs.readdirSync(file))visit(path.join(file,name));fs.rmdirSync(file);}else removeFile(file);}
  // Explicit traversal avoids the Node 24 Windows Unicode-path rmSync regression.
  target(base,'package.json');visit(folder);
}
function safeName(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes(':') || name.startsWith('/') || name.endsWith('/') || name.split('/').some(s => !s || s === '.' || s === '..' || /[. ]$|[<>"|?*\x00-\x1f]|^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s))) throw Error('更新路径不合法');
  if (!ROOT_FILES.has(name) && !/^(app|runtime|tools|assets)\/.+/.test(name)) throw Error('更新不能写入个人数据目录');
  if (/(^|\/)(data|\.git|auth\.json|usage\.json|state\.vscdb)(\/|$)/i.test(name)) throw Error('更新包含个人数据');
  return name;
}
function target(root, name) {
  safeName(name); root = path.resolve(root); const file = path.resolve(root,...name.split('/'));
  if (!file.startsWith(root + path.sep)) throw Error('更新路径越界');
  let current = root;
  if (fs.lstatSync(root).isSymbolicLink()) throw Error('更新目录不能是链接');
  for (const part of name.split('/')) { current = path.join(current,part); try { if (fs.lstatSync(current).isSymbolicLink()) throw Error('更新路径不能是链接'); } catch(e) { if(e.code !== 'ENOENT') throw e; } }
  return file;
}
function hash(file) {
  const digest=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.alloc(1024*1024);
  try { let bytes; while((bytes=fs.readSync(fd,buffer,0,buffer.length,null))) digest.update(buffer.subarray(0,bytes)); } finally { fs.closeSync(fd); }
  return digest.digest('hex');
}
function validate(value) {
  if (!value || value.schema !== 1 || !/^\d+\.\d+\.\d+$/.test(value.version) || !Array.isArray(value.files) || !value.files.length || value.files.length>20000) throw Error('更新清单无效');
  const names=new Set();let total=0;
  for(const entry of value.files){safeName(entry.name);const lower=entry.name.toLowerCase();if(names.has(lower)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||entry.bytes>2*1024**3||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('更新文件清单无效');names.add(lower);total+=entry.bytes;}
  if(total>5*1024**3)throw Error('更新文件过大');
  for(const name of names)for(const part of name.split('/').slice(0,-1).map((_,i)=>name.split('/').slice(0,i+1).join('/')))if(names.has(part))throw Error('更新文件与目录冲突');
  return value;
}
function delta(base,next) {
  validate(base);validate(next);const old=new Map(base.files.map(f=>[f.name,f])),fresh=new Map(next.files.map(f=>[f.name,f]));
  const oldCase=new Map(base.files.map(f=>[f.name.toLowerCase(),f.name]));for(const file of next.files)if(oldCase.has(file.name.toLowerCase())&&oldCase.get(file.name.toLowerCase())!==file.name)throw Error('路径大小写变更需要完整安装包');
  return {changed:next.files.filter(f=>old.get(f.name)?.sha256!==f.sha256||old.get(f.name)?.bytes!==f.bytes),removed:base.files.filter(f=>!fresh.has(f.name))};
}
function validateInstalled(value){validate(value);const names=new Set(value.files.map(f=>f.name));if(REQUIRED_FILES.some(name=>!names.has(name)))throw Error('更新清单缺少必要程序文件，请使用完整安装包');return value;}
function verify(root,files) { for(const file of files) {const destination=target(root,file.name);if(fs.statSync(destination).size!==file.bytes||hash(destination)!==file.sha256)throw Error('文件校验不一致：'+file.name);} }
async function bundle(root,files,output) {
  async function* source(){for(const entry of files){const header=Buffer.from(JSON.stringify({name:entry.name,bytes:entry.bytes})),length=Buffer.alloc(4);length.writeUInt32LE(header.length);yield length;yield header;for await(const chunk of fs.createReadStream(target(root,entry.name)))yield chunk;}}
  verify(root,files);await pipeline(Readable.from(source()),zlib.createGzip({level:6}),fs.createWriteStream(output,{flags:'wx'}));
  return {name:path.basename(output),bytes:fs.statSync(output).size,sha256:hash(output)};
}
async function extract(archive,folder,files) {
  fs.mkdirSync(folder,{recursive:true});const expected=new Map(files.map(f=>[f.name,f])),seen=new Set(),compressed=fs.createReadStream(archive),input=zlib.createGunzip();
  compressed.on('error',error=>input.destroy(error));input.on('error',()=>compressed.destroy());compressed.pipe(input);const source=input[Symbol.asyncIterator]();let pending=Buffer.alloc(0);
  async function read(count,allowEnd=false){const parts=[];let remaining=count;while(remaining){if(!pending.length){const next=await source.next();if(next.done){if(allowEnd&&remaining===count)return null;throw Error('增量包被截断');}pending=next.value;}const size=Math.min(remaining,pending.length);parts.push(pending.subarray(0,size));pending=pending.subarray(size);remaining-=size;}return Buffer.concat(parts,count);}
  try { while(true){const length=await read(4,true);if(!length)break;const bytes=length.readUInt32LE();if(!bytes||bytes>4096)throw Error('增量包头无效');const header=JSON.parse((await read(bytes)).toString('utf8')),entry=expected.get(header.name);if(!entry||seen.has(entry.name)||header.bytes!==entry.bytes)throw Error('增量包文件不匹配');seen.add(entry.name);
    const file=target(folder,entry.name);fs.mkdirSync(path.dirname(file),{recursive:true});const fd=fs.openSync(file,'wx');try{let remaining=entry.bytes;while(remaining){const chunk=await read(Math.min(65536,remaining));fs.writeFileSync(fd,chunk);remaining-=chunk.length;}}finally{fs.closeSync(fd);} }
    if(seen.size!==expected.size)throw Error('增量包缺少文件');verify(folder,files);
  } finally {input.destroy();compressed.destroy();}
}
function atomic(file,value){const temp=file+'.tmp-'+crypto.randomUUID();try{fs.writeFileSync(temp,JSON.stringify(value),{flag:'wx'});fs.renameSync(temp,file);}finally{removeFile(temp);}}
function metadata(root,name){if(!['gptide-release.json','installation.ini'].includes(name))throw Error('更新元数据路径无效');target(root,'package.json');const file=path.join(root,name);if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error('更新元数据不能是链接');return file;}
function transactionRoot(root){root=path.resolve(root);const folder=path.join(root,'.gptide-update');if(fs.existsSync(folder)&&fs.lstatSync(folder).isSymbolicLink())throw Error('更新备份目录不能是链接');return folder;}
function recover(root) {
  const folder=transactionRoot(root),file=path.join(folder,'journal.json');if(!fs.existsSync(file))return;
  const journal=JSON.parse(fs.readFileSync(file));if(journal.schema!==1||!Array.isArray(journal.entries))throw Error('更新恢复记录无效');
  if(journal.pid && journal.pid!==process.pid){let alive=true;try{process.kill(journal.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}if(alive)throw Error('另一个更新程序仍在运行');}
  if(!journal.committed)for(const entry of [...journal.entries].reverse()){
    const meta=['gptide-release.json','installation.ini'].includes(entry.name),destination=meta?metadata(root,entry.name):target(root,entry.name),backup=meta?metadata(path.join(folder,'backup'),entry.name):target(path.join(folder,'backup'),entry.name);
    if(entry.existed){if(hash(backup)!==entry.sha256)throw Error('更新备份损坏：'+entry.name);if(!fs.existsSync(destination)||hash(destination)!==entry.sha256){fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(backup,destination);}}else removeFile(destination);
  }
  // This exact directory is private program-update state, never a user-data root.
  removeTree(root,'.gptide-update');
}
function apply(root,staged,base,next,{beforeWrite=()=>{}}={}) {
  const versions=[base?.version,next?.version];if(versions.every(v=>/^\d+\.\d+\.\d+$/.test(v))){const a=versions[0].split('.').map(Number),b=versions[1].split('.').map(Number);const differing=a.findIndex((v,i)=>v!==b[i]);if(differing<0||a[differing]>b[differing])throw Error('更新目标必须是新版本');}
  validate(base);validate(next);root=path.resolve(root);const installed=JSON.parse(fs.readFileSync(metadata(root,'gptide-release.json')));if(JSON.stringify(installed)!==JSON.stringify(base))throw Error('安装版本已改变，请重新检查更新');
  if(!fs.existsSync(metadata(root,'installation.ini')))throw Error('请选择完整安装版更新');
  verify(root,base.files);const change=delta(base,next);verify(staged,change.changed);
  const oldNames=new Set(base.files.map(f=>f.name));for(const entry of change.changed)if(!oldNames.has(entry.name)&&fs.existsSync(target(root,entry.name)))throw Error('新增文件与本机文件冲突：'+entry.name);
  const folder=transactionRoot(root);fs.mkdirSync(folder);fs.mkdirSync(path.join(folder,'backup'));const journal={schema:1,pid:process.pid,entries:[]};atomic(path.join(folder,'journal.json'),journal);
  function backup(name){const meta=['gptide-release.json','installation.ini'].includes(name),destination=meta?metadata(root,name):target(root,name),saved=meta?metadata(path.join(folder,'backup'),name):target(path.join(folder,'backup'),name);const existed=fs.existsSync(destination);if(existed){if(!fs.statSync(destination).isFile())throw Error('更新目标不是文件');fs.mkdirSync(path.dirname(saved),{recursive:true});fs.copyFileSync(destination,saved);}journal.entries.push({name,existed,...(existed?{sha256:hash(saved)}:{})});atomic(path.join(folder,'journal.json'),journal);return destination;}
  try{
    for(const entry of change.changed){const destination=backup(entry.name);beforeWrite(entry.name);fs.mkdirSync(path.dirname(destination),{recursive:true});const temp=destination+'.gptide-new-'+crypto.randomUUID();fs.copyFileSync(target(staged,entry.name),temp,fs.constants.COPYFILE_EXCL);try{fs.renameSync(temp,destination);}finally{removeFile(temp);}}
    for(const entry of change.removed){const destination=backup(entry.name);beforeWrite(entry.name);fs.unlinkSync(destination);}
    verify(root,next.files);backup('installation.ini');const ini=fs.readFileSync(path.join(root,'installation.ini'),'utf8');fs.writeFileSync(path.join(root,'installation.ini'),ini.replace(/^Version=.*$/m,'Version='+next.version));backup('gptide-release.json');atomic(path.join(root,'gptide-release.json'),next);atomic(path.join(folder,'journal.json'),{...journal,committed:true});journal.committed=true;recover(root);
  }catch(error){if(journal.committed)return {...change,cleanupPending:true};try{recover(root);}catch(rollback){throw Error(error.message+'；恢复未完成：'+rollback.message);}throw error;}
  return change;
}
module.exports={safeName,target,hash,validate,validateInstalled,REQUIRED_FILES,delta,verify,bundle,extract,apply,recover,removeTree};
