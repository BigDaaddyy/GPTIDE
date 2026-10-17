const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),core=require('./update-core.cjs');
async function prepare(root,bundle,data){
  root=path.resolve(root);bundle=path.resolve(bundle);
  if(!fs.existsSync(path.join(root,'installation.ini')))throw Error('没有找到 GPTIDE 安装目录');
  if(fs.existsSync(path.join(root,'.gptide-update/journal.json')))throw Error('上次更新尚未完成，请先在程序内检查更新并恢复');
  const base=core.validateInstalled(JSON.parse(fs.readFileSync(path.join(root,'gptide-release.json')))),update=JSON.parse(fs.readFileSync(path.join(bundle,'update-manifest.json'))),next=core.validateInstalled(update.manifest);
  if(update.schema!==1||update.version!==next.version||!/^\d+\.\d+\.\d+$/.test(next.version))throw Error('更新清单无效');
  const digest=crypto.createHash('sha256').update(JSON.stringify(base)).digest('hex'),delta=update.deltas?.find(d=>d.from===base.version&&d.baseSha256===digest);
  if(!delta)throw Error('没有匹配 '+base.version+' 的增量包；此更新包支持 '+(update.deltas||[]).map(d=>d.from).join('、'));
  if(delta.name!==`GPTIDE-Update-${base.version}-to-${next.version}.bin.gz`||!Number.isSafeInteger(delta.bytes)||delta.bytes<1||!/^[a-f0-9]{64}$/.test(delta.sha256))throw Error('增量包信息无效');
  const archive=path.join(bundle,delta.name);if(fs.statSync(archive).size!==delta.bytes||core.hash(archive)!==delta.sha256)throw Error('增量包校验失败');
  core.verify(root,base.files);
  const parent=path.join(path.resolve(data),'updates'),folder=path.join(parent,crypto.randomUUID());fs.mkdirSync(folder,{recursive:true});
  try{
    const staged=path.join(folder,'files');await core.extract(archive,staged,core.delta(base,next).changed);
    for(const name of ['update-core.cjs','update-worker.cjs'])fs.copyFileSync(path.join(__dirname,name),path.join(folder,name));
    fs.copyFileSync(process.execPath,path.join(folder,'node.exe'));
    const args=['--user-data-dir',path.resolve(data),'--shared-data-dir',path.join(path.resolve(data),'shared'),'--extensions-dir',path.join(require('node:os').homedir(),'.gptide/extensions'),'--new-window','--skip-welcome'];
    const result=path.join(folder,'result.json'),plan=path.join(folder,'plan.json');fs.writeFileSync(plan,JSON.stringify({root,base,next,staged,args,result}));
    return {folder,plan,result,version:next.version};
  }catch(error){core.removeTree(parent,path.basename(folder));throw error;}
}
if(require.main===module)(async()=>{
  if(!process.argv[2])throw Error('请使用随附的更新脚本选择安装目录');
  console.log('正在验证安装文件和增量包…');
  const prepared=await prepare(process.argv[2],__dirname,process.env.GPTIDE_DATA_HOME||path.join(process.env.APPDATA,'GPTIDE'));
  console.log('校验通过，正在按文件更新…');
  const child=require('node:child_process').spawn(path.join(prepared.folder,'node.exe'),[path.join(prepared.folder,'update-worker.cjs'),prepared.plan],{stdio:'inherit',windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('更新 helper 退出：'+code)));});
  const outcome=JSON.parse(fs.readFileSync(prepared.result));if(!outcome.ok)throw Error(outcome.error);try{core.removeTree(path.dirname(prepared.folder),path.basename(prepared.folder));}catch{}console.log('已更新至 '+outcome.version+'，GPTIDE 正在重新打开。');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={prepare};
