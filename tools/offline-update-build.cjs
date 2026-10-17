const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
function build(output){
  output=path.resolve(output);const update=JSON.parse(fs.readFileSync(path.join(output,'update-manifest.json')));
  if(!update.deltas.length)return;
  const stage=path.join(output,'offline-update');fs.mkdirSync(stage);
  for(const name of ['offline-update.cjs','update-core.cjs','update-worker.cjs'])fs.copyFileSync(path.join(__dirname,name),path.join(stage,name));
  for(const [from,to] of [['offline-update.ps1','Update-GPTIDE.ps1'],['offline-update.cmd','Update-GPTIDE.cmd']])fs.copyFileSync(path.join(__dirname,from),path.join(stage,to));
  fs.copyFileSync(path.join(output,'update-manifest.json'),path.join(stage,'update-manifest.json'));
  for(const delta of update.deltas){if(delta.name!==`GPTIDE-Update-${delta.from}-to-${update.version}.bin.gz`)throw Error('增量包名称不匹配');fs.copyFileSync(path.join(output,delta.name),path.join(stage,delta.name));}
  fs.writeFileSync(path.join(stage,'使用说明.txt'),'完全解压此压缩包，退出所有 GPTIDE 窗口，然后双击 Update-GPTIDE.cmd。\r\n仅替换变化的程序文件，保留聊天、设置和插件。\r\n支持旧版本：'+update.deltas.map(d=>d.from).join('、')+'。\r\n自定义安装路径可在 PowerShell 执行：.\\Update-GPTIDE.ps1 -InstallPath "D:\\GPTIDE"\r\n更新失败会显示原因，请勿删除个人数据或先卸载。\r\n');
  const zip=path.join(output,`GPTIDE-Update-${update.version}.zip`);
  execFileSync('powershell.exe',['-NoProfile','-Command',"Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath $env:GPTIDE_OFFLINE_STAGE -File).FullName -DestinationPath $env:GPTIDE_OFFLINE_ZIP -CompressionLevel Optimal"],{windowsHide:true,env:{...process.env,GPTIDE_OFFLINE_STAGE:stage,GPTIDE_OFFLINE_ZIP:zip}});
  const hash=crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');fs.writeFileSync(path.join(output,'UPDATE-SHA256SUMS.txt'),`${hash}  ${path.basename(zip)}\n`);
  require('./update-core.cjs').removeTree(output,'offline-update');return {zip,bytes:fs.statSync(zip).size,sha256:hash};
}
if(require.main===module)console.log(JSON.stringify(build(process.argv[2])));
module.exports={build};
