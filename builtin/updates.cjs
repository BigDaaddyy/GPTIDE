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
function install(vscode,context,root,isBusy=()=>false){
  const core=require(path.join(root,'tools/update-core.cjs'));let checking=false,installing=false,pollTimer;
  context.subscriptions.push({dispose:()=>clearInterval(pollTimer)});
  const bar=vscode.window.createStatusBarItem('gptide.updates',vscode.StatusBarAlignment.Right,47);bar.name='GPTIDE 更新';bar.command='gptide.checkForUpdates';context.subscriptions.push(bar);
  const pending=context.globalState.get('gptide.pendingUpdate');
  if(pending?.result)try{const outcome=JSON.parse(fs.readFileSync(pending.result,'utf8'));vscode.window[outcome.ok?'showInformationMessage':'showErrorMessage'](outcome.ok?'GPTIDE 已更新至 '+outcome.version:'更新未完成：'+outcome.error);context.globalState.update('gptide.pendingUpdate',undefined);}catch{}
  async function check(){
    if(checking||installing)return;checking=true;
    let folder;
    try{
      const controller=new AbortController();
      const prepared=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'检查 GPTIDE 更新',cancellable:true},async(progress,cancel)=>{
        const listener=cancel.onCancellationRequested(()=>controller.abort());if(cancel.isCancellationRequested)controller.abort();
        try{
          let token;let release;
          try{release=await network.json(API+'/releases/latest',{signal:controller.signal});}
          catch(error){if(![401,404].includes(error.status))throw error;const action=await vscode.window.showInformationMessage('此仓库需要 GitHub 登录后检查更新','登录 GitHub');if(!action)return null;token=(await vscode.authentication.getSession('github',['repo'],{createIfNone:true})).accessToken;release=await network.json(API+'/releases/latest',{token,signal:controller.signal});}
          const current=require('./package.json').version,latest=release.tag_name?.replace(/^v/,'');if(!/^\d+\.\d+\.\d+$/.test(latest)||release.draft||release.prerelease)throw Error('GitHub 发布版本无效');
          if(!newer(latest,current)){await vscode.window.showInformationMessage('当前已是最新版本（'+current+'）');return null;}
          bar.text='$(cloud-download) '+latest;bar.tooltip='GPTIDE 有新版本，点击更新';bar.show();
          const baseline=path.join(root,'gptide-release.json');
          if(!fs.existsSync(baseline)||!fs.existsSync(path.join(root,'installation.ini'))){const action=await vscode.window.showInformationMessage('当前安装尚不支持增量更新，请安装一次新版完整安装包','打开下载页');if(action)await vscode.env.openExternal(vscode.Uri.parse(RELEASES));return null;}
          const base=core.validateInstalled(JSON.parse(fs.readFileSync(baseline)));if(base.version!==current)throw Error('安装清单版本不一致，请使用完整安装包修复');
          const manifestAsset=asset(release,'update-manifest.json');if(manifestAsset.size>8*1024**2)throw Error('更新清单过大');
          folder=path.join(require('./data-paths.cjs').locations().data,'updates',crypto.randomUUID());fs.mkdirSync(folder,{recursive:true});
          const manifestFile=path.join(folder,'update-manifest.json');await network.download(API+'/releases/assets/'+manifestAsset.id,manifestFile,{token,signal:controller.signal,bytes:manifestAsset.size});if('sha256:'+core.hash(manifestFile)!==manifestAsset.digest)throw Error('更新清单校验失败');
          const update=JSON.parse(fs.readFileSync(manifestFile)),delta=selectDelta(core,release,update,base);
          if(!delta){const action=await vscode.window.showInformationMessage('没有适用于当前版本的增量包，可使用完整安装包更新','打开下载页');if(action)await vscode.env.openExternal(vscode.Uri.parse(RELEASES));return null;}
          const action=await vscode.window.showInformationMessage(`GPTIDE ${latest} · 增量下载 ${(delta.item.bytes/1024**2).toFixed(1)} MB`,'下载更新');if(!action)return null;
          progress.report({message:'校验当前安装文件…'});core.verify(root,base.files);if(controller.signal.aborted)return null;
          const archive=path.join(folder,delta.item.name);let reported=0;
          await network.download(API+'/releases/assets/'+delta.file.id,archive,{token,signal:controller.signal,bytes:delta.item.bytes,onProgress:value=>{const percent=Math.floor(value*100);if(percent>reported){progress.report({increment:percent-reported,message:'下载更新 '+percent+'%'});reported=percent;}}});
          if(core.hash(archive)!==delta.item.sha256)throw Error('增量包校验失败');
          progress.report({message:'验证增量文件…'});const staged=path.join(folder,'files');await core.extract(archive,staged,core.delta(base,update.manifest).changed);
          if(controller.signal.aborted)return null;return {base,next:update.manifest,staged};
        }finally{listener.dispose();}
      });
      if(!prepared)return;
      if(isBusy()){await vscode.window.showInformationMessage('更新已下载，请等待当前 Agent 任务结束后再次检查更新');return;}
      const choice=await vscode.window.showInformationMessage('更新已准备好。退出所有 GPTIDE 窗口后会安装并重新打开；未保存的文件仍会提示保存。','重启更新');if(!choice)return;if(isBusy())throw Error('Agent 任务正在运行，请稍后更新');
      for(const name of ['update-core.cjs','update-worker.cjs'])fs.copyFileSync(path.join(root,'tools',name),path.join(folder,name));fs.copyFileSync(path.join(root,'runtime/node.exe'),path.join(folder,'node.exe'));
      const locations=require('./data-paths.cjs').locations(),args=['--user-data-dir',locations.data,'--shared-data-dir',path.join(locations.data,'shared'),'--extensions-dir',locations.extensions,'--new-window','--skip-welcome'];
      const project=vscode.workspace.workspaceFolders?.[0]?.uri;if(project?.scheme==='file')args.push(project.fsPath);
      const result=path.join(folder,'result.json'),plan=path.join(folder,'plan.json');fs.writeFileSync(plan,JSON.stringify({root,...prepared,args,result}));await context.globalState.update('gptide.pendingUpdate',{result});
      const child=spawn(path.join(folder,'node.exe'),[path.join(folder,'update-worker.cjs'),plan],{detached:true,stdio:'ignore',windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();installing=true;
      pollTimer=setInterval(()=>{try{const outcome=JSON.parse(fs.readFileSync(result));clearInterval(pollTimer);installing=false;context.globalState.update('gptide.pendingUpdate',undefined);if(!outcome.ok)vscode.window.showErrorMessage('更新未完成：'+outcome.error);}catch{}},2000);pollTimer.unref?.();
      await vscode.commands.executeCommand('workbench.action.quit');
    }catch(error){if(error.name!=='AbortError')await vscode.window.showErrorMessage('更新未完成：'+error.message+'。可使用完整安装包更新。');}
    finally{checking=false;if(folder&&!installing){try{core.removeTree(path.dirname(folder),path.basename(folder));}catch{}}}
  }
  context.subscriptions.push(vscode.commands.registerCommand('gptide.checkForUpdates',check));
}
module.exports={install,newer,asset,selectDelta};
