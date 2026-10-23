const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),network=require('./update-network.cjs');
const API='https://api.github.com/repos/BigDaaddyy/GPTIDE',RELEASES='https://github.com/BigDaaddyy/GPTIDE/releases/latest';
function newer(a,b){if(!/^\d+\.\d+\.\d+$/.test(a)||!/^\d+\.\d+\.\d+$/.test(b))return false;const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false;}
function asset(release,name){const value=release.assets?.find(a=>a.name===name);if(!Number.isSafeInteger(value?.id)||!Number.isSafeInteger(value.size)||value.size<1||!/^sha256:[a-f0-9]{64}$/.test(value.digest))throw Error('发布附件缺少可信校验信息');return value;}
function selectDelta(core,release,update,base){
  core.validateInstalled(update?.manifest);if(update.schema!==1||update.version!==update.manifest.version||release.tag_name!=='v'+update.version||release.draft||release.prerelease)throw Error('发布版本与更新清单不匹配');
  const digest=crypto.createHash('sha256').update(JSON.stringify(base)).digest('hex');
  const item=update.deltas?.find(d=>d.from===base.version&&d.baseSha256===digest);if(!item)return null;
  if(!/^GPTIDE-Update-\d+\.\d+\.\d+-to-\d+\.\d+\.\d+\.bin\.gz$/.test(item.name))throw Error('增量包名称无效');
  const file=asset(release,item.name);if(file.digest!=='sha256:'+item.sha256||file.size!==item.bytes)throw Error('增量包发布校验不一致');return {item,file};
}
function restartArgs(workspace,locations){
  const args=['--user-data-dir',locations.data,'--shared-data-dir',path.join(locations.data,'shared'),'--extensions-dir',locations.extensions,'--new-window','--skip-welcome'];
  if(workspace.workspaceFile){if(workspace.workspaceFile.scheme!=='file')throw Error('请先保存当前工作区，再重启更新');args.push(workspace.workspaceFile.fsPath);}
  else for(const folder of workspace.workspaceFolders||[]){if(folder.uri.scheme==='file')args.push(folder.uri.fsPath);else args.push('--folder-uri',folder.uri.toString());}
  return args;
}
function canAutoRestart(vscode,isBusy){
  return !isBusy()&&!(vscode.workspace?.textDocuments||[]).some(d=>d.isDirty)&&!(vscode.workspace?.notebookDocuments||[]).some(d=>d.isDirty)&&vscode.workspace?.workspaceFile?.scheme!=='untitled'&&!vscode.debug?.activeDebugSession;
}
function install(vscode,context,root,isBusy=()=>false){
  const core=require(path.join(root,'tools/update-core.cjs'));let checking=false,installing=false,pollTimer,autoTimer,cleanupTimer,disposed=false,activeController,ready,approvedVersion,deferredVersion;
  const autoEnabled=()=>vscode.workspace?.getConfiguration?.('gptide').get('updates.autoDownload',true)!==false;
  context.subscriptions.push({dispose:()=>{disposed=true;clearInterval(pollTimer);clearTimeout(autoTimer);clearTimeout(cleanupTimer);activeController?.abort();}});
  const bar=vscode.window.createStatusBarItem('gptide.updates',vscode.StatusBarAlignment.Right,47);bar.name='GPTIDE 更新';bar.command='gptide.checkForUpdates';context.subscriptions.push(bar);
  const pending=context.globalState.get('gptide.pendingUpdate');
  if(pending?.result)try{const outcome=JSON.parse(fs.readFileSync(pending.result,'utf8'));vscode.window[outcome.ok?'showInformationMessage':'showErrorMessage'](outcome.ok?'GPTIDE 已'+(outcome.recovered?'恢复至 ':'更新至 ')+outcome.version:'更新未完成：'+outcome.error);context.globalState.update('gptide.pendingUpdate',undefined);if(pending.automatic&&!outcome.ok)context.globalState.update('gptide.failedAutoUpdate',{root,version:pending.version});if(outcome.ok){context.globalState.update('gptide.failedAutoUpdate',undefined);context.globalState.update('gptide.readyUpdate',undefined);const parent=path.resolve(require('./data-paths.cjs').locations().data,'updates'),folder=path.resolve(path.dirname(pending.result));if(path.dirname(folder)===parent&&/^[a-f0-9-]{36}$/.test(path.basename(folder))){cleanupTimer=setTimeout(()=>{try{core.removeTree(parent,path.basename(folder));}catch{}},8000);cleanupTimer.unref?.();}}}catch{}
  const journalFile=path.join(root,'.gptide-update/journal.json');
  if(fs.existsSync(journalFile)){bar.text='$(warning) 恢复更新';bar.tooltip='检测到未清理的更新事务，点击检查并恢复';bar.show();}
  const newFolder=()=>{const folder=path.join(require('./data-paths.cjs').locations().data,'updates',crypto.randomUUID());fs.mkdirSync(folder,{recursive:true});return folder;};
  function showReady(){bar.text='$(cloud-download) 重启更新 '+ready.next.version;bar.tooltip='增量更新已下载，点击选择重启安装；聊天和设置保留';bar.show();}
  function loadReady(){
    const saved=context.globalState.get('gptide.readyUpdate');if(!saved||saved.root!==root)return;
    const parent=path.join(require('./data-paths.cjs').locations().data,'updates'),folder=path.resolve(saved.folder||'');
    if(path.dirname(folder)!==path.resolve(parent)||!/^[a-f0-9-]{36}$/.test(path.basename(folder)))throw Error('已下载更新的路径无效');
    if(fs.lstatSync(folder).isSymbolicLink())throw Error('更新目录不能是链接');
    const prepared=JSON.parse(fs.readFileSync(path.join(folder,'prepared.json'),'utf8'));
    core.validateInstalled(prepared.base);core.validateInstalled(prepared.next);
    const base=JSON.parse(fs.readFileSync(path.join(root,'gptide-release.json')));
    if(JSON.stringify(base)!==JSON.stringify(prepared.base)||!newer(prepared.next.version,base.version)||prepared.staged!==path.join(folder,'files'))throw Error('已下载更新与当前安装不匹配');
    core.verify(prepared.staged,core.delta(base,prepared.next).changed);
    ready={...prepared,folder};showReady();
  }
  async function requestUpgrade(version,bytes,automatic,downloaded=false){
    if(approvedVersion===version)return true;
    if(automatic&&deferredVersion===version)return false;
    const size=Number.isFinite(bytes)?`，增量下载 ${(bytes/1024**2).toFixed(1)} MB`:'';
    const choice=await vscode.window.showInformationMessage(`发现 GPTIDE ${version}${downloaded?'（已下载）':size}。是否升级？升级后将重新打开当前窗口。`,'升级并重启','稍后');
    if(disposed)return false;
    if(choice!=='升级并重启'){deferredVersion=version;return false;}
    approvedVersion=version;deferredVersion=undefined;return true;
  }
  async function offerRestart(automatic=false){
    if(!ready||disposed)return;
    showReady();if(isBusy())return;
    const failed=context.globalState.get('gptide.failedAutoUpdate');
    if(automatic&&failed?.root===root&&failed.version===ready.next.version){bar.tooltip='上次更新未完成，点击手动重试';return;}
    if(!await requestUpgrade(ready.next.version,undefined,automatic,true))return;
    if(!canAutoRestart(vscode,isBusy)){bar.tooltip='已同意升级，等待任务结束和文件保存；点击可查看';return;}
    core.verify(root,ready.base.files);core.verify(ready.staged,core.delta(ready.base,ready.next).changed);
    if(!canAutoRestart(vscode,isBusy))return;
    const {folder,...prepared}=ready;await restart(folder,prepared,true);
  }
  async function restart(folder,prepared,automatic=false){
    const args=restartArgs(vscode.workspace,require('./data-paths.cjs').locations());
    for(const name of ['update-core.cjs','update-worker.cjs'])fs.copyFileSync(path.join(root,'tools',name),path.join(folder,name));fs.copyFileSync(path.join(root,'runtime/node.exe'),path.join(folder,'node.exe'));
    const result=path.join(folder,'result.json'),plan=path.join(folder,'plan.json');fs.writeFileSync(plan,JSON.stringify({root,...prepared,args,result,reopenOnTimeout:automatic}));await context.globalState.update('gptide.pendingUpdate',{result,automatic,version:prepared.next?.version,root});
    const child=spawn(path.join(folder,'node.exe'),[path.join(folder,'update-worker.cjs'),plan],{detached:true,stdio:'ignore',windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();installing=true;
    pollTimer=setInterval(()=>{try{const outcome=JSON.parse(fs.readFileSync(result));clearInterval(pollTimer);installing=false;context.globalState.update('gptide.pendingUpdate',undefined);if(!outcome.ok){if(automatic)context.globalState.update('gptide.failedAutoUpdate',{root,version:prepared.next?.version});vscode.window.showErrorMessage('更新未完成：'+outcome.error);}}catch{}},2000);pollTimer.unref?.();
    await vscode.commands.executeCommand(automatic?'workbench.action.closeWindow':'workbench.action.quit');
  }
  async function check(automatic=false){
    if(checking||installing)return;checking=true;
    let folder,lock;
    try{
      if(isBusy()){if(!automatic)await vscode.window.showInformationMessage('请先等待当前 Agent 任务结束，再更新');return;}
      bar.text='$(sync~spin) 检查更新';bar.tooltip='正在检查 GitHub 新版本…';bar.show();
      if(fs.existsSync(journalFile)){
        const journal=JSON.parse(fs.readFileSync(journalFile));if(journal.schema!==1||!Array.isArray(journal.entries))throw Error('更新恢复记录无效');
        if(!journal.committed){if(automatic)return;const choice=await vscode.window.showInformationMessage('上次更新未完成，需要退出编辑器后恢复原版本。','退出并恢复');if(choice){if(isBusy())throw Error('Agent 正在工作，请稍后恢复');folder=newFolder();await restart(folder,{recoverOnly:true});}return;}
        core.recover(root);bar.hide();
      }
      if(!ready)try{loadReady();}catch{await context.globalState.update('gptide.readyUpdate',undefined);}
      if(ready){await offerRestart(automatic);return;}
      const updates=path.join(require('./data-paths.cjs').locations().data,'updates');fs.mkdirSync(updates,{recursive:true});
      const lockFile=path.join(updates,'check-'+crypto.createHash('sha256').update(root).digest('hex').slice(0,16)+'.lock');
      try{const fd=fs.openSync(lockFile,'wx');lock=lockFile;try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));}finally{fs.closeSync(fd);}}
      catch(error){if(error.code!=='EEXIST')throw error;let live=true;try{const owner=JSON.parse(fs.readFileSync(lockFile));try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')live=false;}}catch{live=Date.now()-fs.statSync(lockFile).mtimeMs<30*60*1000;}if(!live)fs.unlinkSync(lockFile);if(!automatic)await vscode.window.showInformationMessage(live?'另一个 GPTIDE 窗口正在检查更新':'上次检查已中断，请重新检查更新');return;}
      const controller=activeController=new AbortController();
      const run=async(progress,cancel)=>{
        const listener=cancel.onCancellationRequested(()=>controller.abort());if(cancel.isCancellationRequested)controller.abort();
        try{
          let token;let release;
          if(vscode.authentication?.getSession)try{token=(await vscode.authentication.getSession('github',['repo'],{silent:true}))?.accessToken;}catch{}
          try{release=await network.json(API+'/releases/latest',{token,signal:controller.signal});}
          catch(error){if(![401,404].includes(error.status))throw error;if(automatic){bar.text='$(github) 登录以检查更新';bar.tooltip='点击检查更新并登录 GitHub';bar.show();return null;}const action=await vscode.window.showInformationMessage('此仓库需要 GitHub 登录后检查更新','登录 GitHub');if(!action)return null;token=(await vscode.authentication.getSession('github',['repo'],{createIfNone:true})).accessToken;release=await network.json(API+'/releases/latest',{token,signal:controller.signal});}
          const current=require('./package.json').version,latest=release.tag_name?.replace(/^v/,'');if(!/^\d+\.\d+\.\d+$/.test(latest)||release.draft||release.prerelease)throw Error('GitHub 发布版本无效');
          if(!newer(latest,current)){bar.hide();if(!automatic)await vscode.window.showInformationMessage('当前已是最新版本（'+current+'）');return null;}
          bar.text='$(cloud-download) '+latest;bar.tooltip='GPTIDE 有新版本，点击更新';bar.show();
          if(automatic&&deferredVersion===latest)return null;
          const baseline=path.join(root,'gptide-release.json');
          if(!fs.existsSync(baseline)||!fs.existsSync(path.join(root,'installation.ini'))){if(automatic)return null;const action=await vscode.window.showInformationMessage('当前安装尚不支持增量更新，请安装一次新版完整安装包','打开下载页');if(action)await vscode.env.openExternal(vscode.Uri.parse(RELEASES));return null;}
          const base=core.validateInstalled(JSON.parse(fs.readFileSync(baseline)));if(base.version!==current)throw Error('安装清单版本不一致，请使用完整安装包修复');
          const manifestAsset=asset(release,'update-manifest.json');if(manifestAsset.size>8*1024**2)throw Error('更新清单过大');
          folder=newFolder();
          const manifestFile=path.join(folder,'update-manifest.json');await network.download(API+'/releases/assets/'+manifestAsset.id,manifestFile,{token,signal:controller.signal,bytes:manifestAsset.size});if('sha256:'+core.hash(manifestFile)!==manifestAsset.digest)throw Error('更新清单校验失败');
          const update=JSON.parse(fs.readFileSync(manifestFile)),delta=selectDelta(core,release,update,base);
          if(!delta){if(automatic){bar.tooltip='新版没有匹配当前安装的增量包，点击查看';return null;}const action=await vscode.window.showInformationMessage('没有适用于当前版本的增量包，可使用完整安装包更新','打开下载页');if(action)await vscode.env.openExternal(vscode.Uri.parse(RELEASES));return null;}
          if(!await requestUpgrade(latest,delta.item.bytes,automatic))return null;
          progress.report({message:'校验当前安装文件…'});core.verify(root,base.files);if(controller.signal.aborted)return null;
          const archive=path.join(folder,delta.item.name);let reported=0;
          await network.download(API+'/releases/assets/'+delta.file.id,archive,{token,signal:controller.signal,bytes:delta.item.bytes,onProgress:value=>{const percent=Math.floor(value*100);if(percent>reported){progress.report({increment:percent-reported,message:'下载更新 '+percent+'%'});reported=percent;}}});
          if(core.hash(archive)!==delta.item.sha256)throw Error('增量包校验失败');
          progress.report({message:'验证增量文件…'});const staged=path.join(folder,'files');await core.extract(archive,staged,core.delta(base,update.manifest).changed);
          if(controller.signal.aborted)return null;return {base,next:update.manifest,staged};
        }finally{listener.dispose();}
      };
      const prepared=automatic?await run({report:value=>{bar.text='$(sync~spin) 更新 '+(value.message||'');bar.show();}},{onCancellationRequested:()=>({dispose(){}})}):await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'检查 GPTIDE 更新',cancellable:true},run);
      if(!prepared)return;
      fs.writeFileSync(path.join(folder,'prepared.json'),JSON.stringify(prepared));
      await context.globalState.update('gptide.readyUpdate',{root,folder});ready={...prepared,folder};
      await offerRestart(automatic);
    }catch(error){if(error.name!=='AbortError'){if(automatic){bar.text='$(warning) 更新检查失败';bar.tooltip=error.message+'；点击重试';bar.show();}else await vscode.window.showErrorMessage('更新未完成：'+error.message+'。可使用完整安装包更新。');}}
    finally{checking=false;if(activeController?.signal.aborted)approvedVersion=undefined;activeController=undefined;if(lock)try{fs.unlinkSync(lock);}catch{}if(folder&&!installing&&folder!==ready?.folder){try{core.removeTree(path.dirname(folder),path.basename(folder));}catch{}}}
  }
  context.subscriptions.push(vscode.commands.registerCommand('gptide.checkForUpdates',()=>check(false)));
  async function autoCheck(){if(disposed)return;try{if(autoEnabled())await check(true);}finally{if(!disposed){autoTimer=setTimeout(autoCheck,ready||isBusy()?60000:6*60*60*1000);autoTimer.unref?.();}}}
  if(fs.existsSync(path.join(root,'installation.ini'))){autoTimer=setTimeout(autoCheck,0);autoTimer.unref?.();}
  return {check,autoCheck};
}
module.exports={install,newer,asset,selectDelta,restartArgs,canAutoRestart};
