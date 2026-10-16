const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { execFile } = require('node:child_process'), { promisify } = require('node:util');
const execute = promisify(execFile), root = path.resolve(__dirname,'..'), version = require('../package.json').version;
const output = path.join(root,'downloads/release',version), installer = path.join(output,`GPTIDE-Setup-${version}-x64.exe`);
const testRoot = path.join(output,'install-check-'+Date.now()), installed = path.join(testRoot,'GPTIDE');
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
async function waitFor(check, label) { for(let i=0;i<600;i++){if(check())return;await sleep(200);}throw Error('等待失败：'+label); }
async function runtimeClosed(){
  // Electron has exited, but scanner/shared handles can briefly outlive it.
  await execute('powershell.exe',['-NoProfile','-Command',"for($i=0;$i -lt 100;$i++){try{$stream=[System.IO.File]::Open($env:GPTIDE_LOCK_TARGET,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None);$stream.Dispose();exit 0}catch{Start-Sleep -Milliseconds 200}};exit 1"],{env:{...process.env,GPTIDE_LOCK_TARGET:path.join(installed,'app/GPTIDE.exe')},windowsHide:true,timeout:30000});
}

(async()=>{
  fs.mkdirSync(testRoot,{recursive:true});
  const run = async () => {for(let attempt=0;;attempt++){try{return await execute(installer,['/S','/TESTMODE=1',`/D=${installed}`],{windowsHide:true,timeout:180000});}catch(error){if(error.code!==2||attempt>=3)throw error;console.log('Waiting for closed test runtime handles before retrying installation');await sleep(1500);}}};
  await run();
  assert.ok(fs.existsSync(path.join(installed,'app/GPTIDE.exe')));
  assert.ok(!fs.existsSync(path.join(installed,'app/VSCodium.exe')));
  const roaming=path.join(testRoot,'Roaming'),home=path.join(testRoot,'home'),data=path.join(roaming,'GPTIDE'),extensions=path.join(home,'.gptide/extensions');
  fs.mkdirSync(home,{recursive:true});
  fs.writeFileSync(path.join(data,'.legacy-migrated.json'),'{ interrupted migration');
  fs.mkdirSync(path.join(roaming,'Cursor/User/snippets'),{recursive:true});fs.writeFileSync(path.join(roaming,'Cursor/User/settings.json'),'{}');
  const { playwright } = require('./acceptance-env.cjs');
  const processEnv={...process.env,APPDATA:roaming,USERPROFILE:home,GPTIDE_DATA_HOME:data,GPTIDE_EXTENSIONS_HOME:extensions,CODEX_HOME:path.join(testRoot,'empty-codex-home')};delete processEnv.ELECTRON_RUN_AS_NODE;
  const launch=()=>playwright._electron.launch({executablePath:path.join(installed,'app/GPTIDE.exe'),args:['--user-data-dir',data,'--shared-data-dir',path.join(data,'shared'),'--extensions-dir',extensions,'--skip-welcome','--new-window'],env:processEnv});
  let app=await launch();
  try {
    const page=await app.firstWindow();await page.waitForSelector('.gptide-home');assert.match(await page.title(),/GPTIDE/);
    await page.getByRole('button',{name:'暂不导入',exact:true}).waitFor();await page.screenshot({path:path.join(testRoot,'first-run-import.png')});
    assert.equal(await page.getByText(/The runtime arguments file.*argv.json/).count(),0,'Fresh profile must not show runtime configuration errors');
    await page.getByRole('button',{name:'暂不导入',exact:true}).click();
    await page.screenshot({path:path.join(testRoot,'installed-home.png')});
    assert.ok(!fs.existsSync(path.join(installed,'data')),'No personal data in install directory');
  } finally {await app.close();await runtimeClosed();}
  const settings=path.join(data,'User/settings.json'),marker=path.join(data,'projects/test-only.json');
  assert.ok(JSON.parse(fs.readFileSync(path.join(data,'.legacy-migrated.json'))).from);
  assert.ok(fs.readdirSync(data).some(name=>name.startsWith('.legacy-migrated.json.invalid-')));
  assert.equal(JSON.parse(fs.readFileSync(settings))['telemetry.telemetryLevel'],'off');
  fs.mkdirSync(path.dirname(marker),{recursive:true});fs.writeFileSync(marker,JSON.stringify({fixture:true}));
  const customized={...JSON.parse(fs.readFileSync(settings)),'editor.fontSize':19,fixture:true};fs.writeFileSync(settings,JSON.stringify(customized));
  await run();assert.deepEqual(JSON.parse(fs.readFileSync(settings)),customized);assert.equal(JSON.parse(fs.readFileSync(marker)).fixture,true);
  app=await launch();try{const page=await app.firstWindow();await page.waitForSelector('.gptide-home');await page.waitForTimeout(1500);assert.equal(await page.getByRole('button',{name:'暂不导入',exact:true}).count(),0);}finally{await app.close();await runtimeClosed();}
  // NSIS normally forks the uninstaller into TEMP, so wait for actual removal.
  const uninstaller=path.join(installed,'Uninstall.exe');
  await execute(uninstaller,['/S'],{windowsHide:true,timeout:180000});
  await waitFor(()=>!fs.existsSync(path.join(installed,'app')),'卸载程序文件');
  assert.equal(JSON.parse(fs.readFileSync(marker)).fixture,true);
  assert.equal(JSON.parse(fs.readFileSync(settings)).fixture,true);
  const report={version,installed:true,upgradePreservesData:true,guiLaunched:true,uninstallPreservesData:true,firstRunImportPrompt:true,promptNotRepeated:true,userDataOutsideProgram:true,startupRecoveredCorruptMarker:true,testRoot};
  fs.writeFileSync(path.join(output,'installer-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(error=>{console.error(error);process.exitCode=1;});
