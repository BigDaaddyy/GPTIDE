const fs=require('node:fs'),path=require('node:path'),{spawn,execFile}=require('node:child_process'),{promisify}=require('node:util'),core=require('./update-core.cjs');
async function queue(root,release,stage,{confirmed=false}={}){
  if(!confirmed)throw Error('必须先获得用户同意升级，才能安排安装');
  root=path.resolve(root);release=path.resolve(release);stage=path.resolve(stage);
  const before=JSON.parse(fs.readFileSync(path.join(root,'gptide-release.json'))).version;
  const prepared=await require('./offline-update.cjs').prepare(root,release,stage);
  const locations=require(path.join(root,'app/resources/app/extensions/gptide-chat/data-paths.cjs')).locations();
  const plan=JSON.parse(fs.readFileSync(prepared.plan));
  plan.waitSeconds=18000;plan.args=['--user-data-dir',locations.data,'--shared-data-dir',path.join(locations.data,'shared'),'--extensions-dir',locations.extensions,'--skip-welcome'];
  fs.writeFileSync(prepared.plan,JSON.stringify(plan));
  const report=path.join(stage,'bootstrap-result.json');
  const child=spawn(process.execPath,[__filename,'--wait',prepared.plan,report],{detached:true,stdio:'ignore',windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
  const info={queued:true,from:before,to:prepared.version,pid:child.pid,result:report};fs.writeFileSync(path.join(stage,'queued.json'),JSON.stringify(info));return info;
}
async function supervise(planFile,report){
  const plan=JSON.parse(fs.readFileSync(planFile)),folder=path.dirname(planFile);
  try{
    await promisify(execFile)(path.join(folder,'node.exe'),[path.join(folder,'update-worker.cjs'),planFile],{windowsHide:true,timeout:7*60*60*1000});
    const outcome=JSON.parse(fs.readFileSync(plan.result));fs.writeFileSync(report,JSON.stringify(outcome));
    if(outcome.ok)core.removeTree(path.dirname(folder),path.basename(folder));
  }catch(error){fs.writeFileSync(report,JSON.stringify({ok:false,error:error.message}));}
}
if(require.main===module)(process.argv[2]==='--wait'?supervise(process.argv[3],process.argv[4]):queue(process.argv[2],process.argv[3],process.argv[4],{confirmed:process.argv[5]==='--confirmed'}).then(value=>console.log(JSON.stringify(value)))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={queue};
