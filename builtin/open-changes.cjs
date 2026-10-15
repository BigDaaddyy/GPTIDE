const path=require('node:path');
const same=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
async function open(vscode,input,remember){
  const uri=input?.scheme?input:vscode.window.activeTextEditor?.document.uri;
  if(uri?.scheme!=='file')return vscode.window.showInformationMessage('请先打开项目中的文件');
  if(!vscode.workspace.getWorkspaceFolder(uri))return vscode.window.showInformationMessage('当前文件不属于打开的项目');
  const extension=vscode.extensions.getExtension('vscode.git');
  if(!extension)return vscode.window.showInformationMessage('Git 扩展未启用');
  const api=(await extension.activate()).getAPI(1),repo=api.getRepository(uri);
  if(!repo)return vscode.window.showInformationMessage('当前文件不在 Git 仓库中');
  await repo.status();
  const change=[...repo.state.workingTreeChanges,...repo.state.indexChanges,...repo.state.mergeChanges,...(repo.state.untrackedChanges||[])].find(c=>same(c.uri.fsPath,uri.fsPath));
  const dirty=vscode.workspace.textDocuments.some(d=>d.uri.scheme==='file'&&same(d.uri.fsPath,uri.fsPath)&&d.isDirty);
  if(!change&&!dirty)return vscode.window.showInformationMessage('当前文件没有 Git 更改');
  let before='';
  if(change?.status!==7){
    try{before=await repo.show('HEAD',change?.originalUri?.fsPath||uri.fsPath);}
    catch(error){if(change?.status!==1)throw new Error('无法读取修改前的版本：'+error.message);}
  }
  if(typeof before!=='string'||Buffer.byteLength(before)>2*1024*1024)throw new Error('修改前的文件过大，无法打开差异');
  return vscode.commands.executeCommand('vscode.diff',remember(before,uri),uri,path.basename(uri.fsPath)+'（Git 更改）');
}
function install(vscode,context){
  const snapshots=new Map();let sequence=0;
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('gptide-git-before',{provideTextDocumentContent:uri=>{if(!snapshots.has(uri.path))throw new Error('差异快照已过期，请重新打开更改');return snapshots.get(uri.path);}}));
  context.subscriptions.push(vscode.commands.registerCommand('gptide.openChanges',uri=>open(vscode,uri,(text,file)=>{
    const key='/'+(++sequence)+'/'+path.basename(file.fsPath);snapshots.set(key,text);while(snapshots.size>20)snapshots.delete(snapshots.keys().next().value);
    return vscode.Uri.from({scheme:'gptide-git-before',path:key});
  }).catch(error=>vscode.window.showErrorMessage(error.message))));
  context.subscriptions.push({dispose:()=>snapshots.clear()});
}
module.exports={open,install};
