const fs=require('node:fs'),path=require('node:path'),{execFile,spawn}=require('node:child_process'),{promisify}=require('node:util'),core=require('./update-core.cjs');
const execute=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function run(plan){
  const {root,staged,base,next,args,result,recoverOnly}=plan;
  const report=value=>{const temp=result+'.tmp';fs.writeFileSync(temp,JSON.stringify(value));fs.renameSync(temp,result);};
  try{
  if(!recoverOnly){core.validateInstalled(base);core.validateInstalled(next);}if(!Array.isArray(args)||args.some(a=>typeof a!=='string'))throw Error('启动参数无效');
  let ready=false;
  const waitSeconds=Number.isInteger(plan.waitSeconds)&&plan.waitSeconds>=120&&plan.waitSeconds<=18000?plan.waitSeconds:120;
  for(let i=0;i<waitSeconds;i++){
    try {await execute('powershell.exe',['-NoProfile','-Command',"$ErrorActionPreference='Stop';try{$f=[System.IO.File]::Open($env:GPTIDE_UPDATE_EXE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None);$f.Dispose();exit 0}catch{exit 1}"],{windowsHide:true,env:{...process.env,GPTIDE_UPDATE_EXE:path.join(root,'app/GPTIDE.exe')}});ready=true;break;}catch{await sleep(1000);}
  }
  if(!ready){report({ok:false,error:'编辑器尚未完全退出，更新已取消'});if(plan.reopenOnTimeout){const child=spawn(path.join(root,'app/GPTIDE.exe'),args,{detached:true,stdio:'ignore',windowsHide:false,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});child.on('error',()=>{});child.unref();}return;}
  try{core.recover(root);if(!recoverOnly)core.apply(root,staged,base,next);
    const version=JSON.parse(fs.readFileSync(path.join(root,'gptide-release.json'))).version;
    if(!/^TestMode=1\s*$/m.test(fs.readFileSync(path.join(root,'installation.ini'),'utf8')))try{await execute('powershell.exe',['-NoProfile','-Command',"$k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\GPTIDE';$v=Get-ItemProperty -LiteralPath $k -ErrorAction Stop;if([IO.Path]::GetFullPath($v.InstallLocation) -eq [IO.Path]::GetFullPath($env:GPTIDE_UPDATE_ROOT)){Set-ItemProperty -LiteralPath $k -Name DisplayVersion -Value $env:GPTIDE_UPDATE_VERSION}"],{windowsHide:true,env:{...process.env,GPTIDE_UPDATE_ROOT:root,GPTIDE_UPDATE_VERSION:version}});}catch{}
    report({ok:true,version,recovered:!!recoverOnly});}
  catch(error){report({ok:false,error:error.message});}
  const child=spawn(path.join(root,'app/GPTIDE.exe'),args,{detached:true,stdio:'ignore',windowsHide:false,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});child.on('error',error=>report({ok:false,error:'重启失败：'+error.message}));child.unref();
  }catch(error){report({ok:false,error:error.message});}
}
if(require.main===module)run(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={run};
