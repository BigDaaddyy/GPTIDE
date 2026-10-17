const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),net=require('node:net'),{execFile}=require('node:child_process'),{promisify}=require('node:util'),core=require('./update-core.cjs');
const execute=promisify(execFile),root=path.resolve(__dirname,'..'),version=require('../package.json').version,output=path.join(root,'downloads/release',version),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(check,label){for(let i=0;i<120;i++){const value=await check();if(value)return value;await sleep(500);}throw Error('等待失败：'+label);}
(async()=>{
  const testRoot=path.join(output,'offline-check-'+Date.now()),installed=path.join(testRoot,'GPTIDE'),bundle=path.join(testRoot,'bundle'),data=path.join(testRoot,'Roaming/GPTIDE'),home=path.join(testRoot,'home');fs.mkdirSync(home,{recursive:true});fs.mkdirSync(bundle);fs.mkdirSync(path.join(data,'User'),{recursive:true});fs.mkdirSync(path.join(data,'projects'),{recursive:true});
  fs.writeFileSync(path.join(data,'User/settings.json'),JSON.stringify({'gptide.updates.autoDownload':false}));const marker=path.join(data,'projects/preserve.json');fs.writeFileSync(marker,'{"preserved":true}');
  await execute(path.join(root,'downloads/release/1.9.3/GPTIDE-Setup-1.9.3-x64.exe'),['/S','/TESTMODE=1','/D='+installed],{windowsHide:true,timeout:180000});
  await execute('powershell.exe',['-NoProfile','-Command','Expand-Archive -LiteralPath $env:GPTIDE_TEST_ZIP -DestinationPath $env:GPTIDE_TEST_BUNDLE'],{windowsHide:true,env:{...process.env,GPTIDE_TEST_ZIP:path.join(output,`GPTIDE-Update-${version}.zip`),GPTIDE_TEST_BUNDLE:bundle}});
  const prepared=await require(path.join(bundle,'offline-update.cjs')).prepare(installed,bundle,data),plan=JSON.parse(fs.readFileSync(prepared.plan));
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  plan.args=['--user-data-dir',data,'--shared-data-dir',path.join(data,'shared'),'--extensions-dir',path.join(home,'.gptide/extensions'),'--new-window','--skip-welcome','--remote-debugging-port='+port];fs.writeFileSync(prepared.plan,JSON.stringify(plan));
  const env={...process.env,USERPROFILE:home,APPDATA:path.join(testRoot,'Roaming'),CODEX_HOME:path.join(testRoot,'empty-codex'),GPTIDE_DATA_HOME:data,GPTIDE_EXTENSIONS_HOME:path.join(home,'.gptide/extensions')};delete env.ELECTRON_RUN_AS_NODE;
  await execute(path.join(prepared.folder,'node.exe'),[path.join(prepared.folder,'update-worker.cjs'),prepared.plan],{windowsHide:true,env,timeout:180000});
  const result=JSON.parse(fs.readFileSync(prepared.result));assert.equal(result.ok,true);assert.equal(result.version,version);core.verify(installed,plan.next.files);assert.equal(fs.readFileSync(marker,'utf8'),'{"preserved":true}');
  const {playwright}=require('./acceptance-env.cjs');let browser;
  try{
    browser=await wait(async()=>{try{return await playwright.chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:1000});}catch{return null;}},'重启');
    const page=await wait(()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('workbench')),'编辑器窗口');await page.waitForSelector('.monaco-workbench');await page.waitForSelector('.gptide-home');await page.screenshot({path:path.join(output,'offline-update-check.png')});
  }finally{if(browser){const session=await browser.newBrowserCDPSession();await Promise.race([session.send('Browser.close').catch(()=>{}),sleep(2000)]);}}
  await execute('powershell.exe',['-NoProfile','-Command',"for($i=0;$i -lt 60;$i++){try{$f=[IO.File]::Open($env:GPTIDE_TEST_EXE,'Open','ReadWrite','None');$f.Dispose();exit 0}catch{Start-Sleep -Milliseconds 250}};exit 1"],{windowsHide:true,env:{...process.env,GPTIDE_TEST_EXE:path.join(installed,'app/GPTIDE.exe')}});
  await execute(path.join(installed,'Uninstall.exe'),['/S','_?='+installed],{windowsHide:true,timeout:180000});assert.ok(fs.existsSync(marker));
  fs.writeFileSync(path.join(output,'offline-update-check.json'),JSON.stringify({from:'1.9.3',to:version,zipBytes:fs.statSync(path.join(output,`GPTIDE-Update-${version}.zip`)).size,actualPackagedRunner:true,realHelper:true,allFilesVerified:true,restartedGUI:true,userDataPreserved:true}));
  core.removeTree(output,path.basename(testRoot));console.log('Actual small ZIP update from 1.9.3, all hashes, GUI restart and data preservation passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
