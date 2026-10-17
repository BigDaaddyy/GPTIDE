const fs=require('node:fs'),path=require('node:path'),{execFile,spawn}=require('node:child_process'),{promisify}=require('node:util'),core=require('./update-core.cjs');
const execute=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function run(plan){
  const {root,staged,base,next,args,result}=plan;
  core.validateInstalled(base);core.validateInstalled(next);if(!Array.isArray(args)||args.some(a=>typeof a!=='string'))throw Error('启动参数无效');
  let ready=false;
  for(let i=0;i<120;i++){
    try {await execute('powershell.exe',['-NoProfile','-Command',"$ErrorActionPreference='Stop';try{$f=[System.IO.File]::Open($env:GPTIDE_UPDATE_EXE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None);$f.Dispose();exit 0}catch{exit 1}"],{windowsHide:true,env:{...process.env,GPTIDE_UPDATE_EXE:path.join(root,'app/GPTIDE.exe')}});ready=true;break;}catch{await sleep(1000);}
  }
  if(!ready){fs.writeFileSync(result,JSON.stringify({ok:false,error:'编辑器尚未完全退出，更新已取消'}));return;}
  try{core.recover(root);core.apply(root,staged,base,next);
    if(!/^TestMode=1\s*$/m.test(fs.readFileSync(path.join(root,'installation.ini'),'utf8')))try{await execute('powershell.exe',['-NoProfile','-Command',"$k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\GPTIDE';$v=Get-ItemProperty -LiteralPath $k -ErrorAction Stop;if([IO.Path]::GetFullPath($v.InstallLocation) -eq [IO.Path]::GetFullPath($env:GPTIDE_UPDATE_ROOT)){Set-ItemProperty -LiteralPath $k -Name DisplayVersion -Value $env:GPTIDE_UPDATE_VERSION}"],{windowsHide:true,env:{...process.env,GPTIDE_UPDATE_ROOT:root,GPTIDE_UPDATE_VERSION:next.version}});}catch{}
    fs.writeFileSync(result,JSON.stringify({ok:true,version:next.version}));}
  catch(error){fs.writeFileSync(result,JSON.stringify({ok:false,error:error.message}));}
  const child=spawn(path.join(root,'app/GPTIDE.exe'),args,{detached:true,stdio:'ignore',windowsHide:false,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});child.on('error',error=>fs.writeFileSync(result,JSON.stringify({ok:false,error:'重启失败：'+error.message})));child.unref();
}
if(require.main===module)run(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={run};
