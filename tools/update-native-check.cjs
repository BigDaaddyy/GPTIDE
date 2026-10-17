const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict'),{execFile}=require('node:child_process'),{promisify}=require('node:util'),core=require('./update-core.cjs');
const execute=promisify(execFile),root=path.resolve(__dirname,'..'),version=require('../package.json').version,output=path.join(root,'downloads/release',version),sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(check,label){for(let i=0;i<120;i++){const value=await check();if(value)return value;await sleep(500);}throw Error('等待失败：'+label);}
(async()=>{
  const testRoot=path.join(output,'update-check-'+Date.now()),installed=path.join(testRoot,'GPTIDE'),stage=path.join(testRoot,'stage'),home=path.join(testRoot,'home'),data=path.join(testRoot,'Roaming/GPTIDE');fs.mkdirSync(stage,{recursive:true});fs.mkdirSync(home,{recursive:true});
  await execute(path.join(output,`GPTIDE-Setup-${version}-x64.exe`),['/S','/TESTMODE=1',`/D=${installed}`],{windowsHide:true,timeout:180000});
  const base=core.validate(JSON.parse(fs.readFileSync(path.join(installed,'gptide-release.json')))),next={...base,version:'99.0.0',files:base.files.filter(f=>f.name!=='assets/icon.png').map(f=>({...f}))};
  for(const name of ['README.md','package.json','app/resources/app/product.json','app/resources/app/extensions/gptide-chat/package.json']){
    let content=fs.readFileSync(path.join(installed,name),'utf8');if(name==='README.md')content+='\nIsolated update verification\n';else{const value=JSON.parse(content);if(name.endsWith('product.json'))value.gptideVersion=next.version;else value.version=next.version;content=JSON.stringify(value);}
    const file=core.target(stage,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);Object.assign(next.files.find(f=>f.name===name),{bytes:Buffer.byteLength(content),sha256:core.hash(file)});
  }
  const marker=path.join(data,'projects/update-preserve.json');fs.mkdirSync(path.dirname(marker),{recursive:true});fs.writeFileSync(marker,'{"fixture":true}');
  const archive=path.join(testRoot,'delta.gz'),changes=core.delta(base,next);await core.bundle(stage,changes.changed,archive);const extracted=path.join(testRoot,'extracted');await core.extract(archive,extracted,changes.changed);
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const result=path.join(testRoot,'result.json'),plan=path.join(testRoot,'plan.json'),extensions=path.join(home,'.gptide/extensions');
  fs.writeFileSync(plan,JSON.stringify({root:installed,staged:extracted,base,next,result,args:['--user-data-dir',data,'--shared-data-dir',path.join(data,'shared'),'--extensions-dir',extensions,'--new-window','--skip-welcome',`--remote-debugging-port=${port}`]}));
  const env={...process.env,APPDATA:path.join(testRoot,'Roaming'),USERPROFILE:home,GPTIDE_DATA_HOME:data,GPTIDE_EXTENSIONS_HOME:extensions,CODEX_HOME:path.join(testRoot,'empty-codex')};delete env.ELECTRON_RUN_AS_NODE;
  const helper=path.join(testRoot,'helper');fs.mkdirSync(helper);for(const name of ['update-core.cjs','update-worker.cjs'])fs.copyFileSync(path.join(installed,'tools',name),path.join(helper,name));fs.copyFileSync(path.join(installed,'runtime/node.exe'),path.join(helper,'node.exe'));
  await execute(path.join(helper,'node.exe'),[path.join(helper,'update-worker.cjs'),plan],{env,windowsHide:true,timeout:180000});assert.equal(JSON.parse(fs.readFileSync(result)).ok,true);
  const {playwright}=require('./acceptance-env.cjs');let browser;
  try{
    browser=await wait(async()=>{try{return await playwright.chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:1000});}catch{return null;}},'更新后重启');
    const page=await wait(()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('workbench')),'编辑器窗口');await page.waitForSelector('.monaco-workbench');await page.waitForSelector('.gptide-home');await page.screenshot({path:path.join(testRoot,'updated-home.png')});
    const session=await browser.newBrowserCDPSession();await Promise.race([session.send('Browser.close').catch(()=>{}),sleep(2000)]);
  }finally{if(browser)await Promise.race([browser.close().catch(()=>{}),sleep(2000)]);}
  core.verify(installed,next.files);assert.equal(fs.existsSync(path.join(installed,'assets/icon.png')),false);assert.equal(JSON.parse(fs.readFileSync(marker)).fixture,true);assert.equal(JSON.parse(fs.readFileSync(path.join(installed,'gptide-release.json'))).version,'99.0.0');
  const rollback={...next,version:'99.0.1',files:next.files.map(f=>({...f}))},failure=path.join(testRoot,'failure');fs.mkdirSync(failure);
  for(const name of ['README.md','package.json']){const value=fs.readFileSync(path.join(installed,name),'utf8')+'\n';fs.writeFileSync(path.join(failure,name),value);Object.assign(rollback.files.find(f=>f.name===name),{bytes:Buffer.byteLength(value),sha256:core.hash(path.join(failure,name))});}
  await wait(()=>{try{core.recover(installed);return true;}catch{return false;}},'清理已提交更新事务');
  let writes=0;assert.throws(()=>core.apply(installed,failure,next,rollback,{beforeWrite:()=>{if(++writes===2)throw Error('fixture failure');}}),/fixture failure/);core.verify(installed,next.files);assert.equal(JSON.parse(fs.readFileSync(marker)).fixture,true);
  await sleep(1500);await execute(path.join(installed,'Uninstall.exe'),['/S',`_?=${installed}`],{windowsHide:true,timeout:180000});await wait(()=>!fs.existsSync(path.join(installed,'app')),'卸载测试安装');assert.equal(JSON.parse(fs.readFileSync(marker)).fixture,true);
  const report={version,testRoot,changedFiles:changes.changed.length,removedFiles:changes.removed.length,bundleBytes:fs.statSync(archive).size,realWorker:true,restartedGUI:true,rollback:true,userDataPreserved:true};fs.writeFileSync(path.join(output,'update-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(error=>{console.error(error);process.exitCode=1;});
