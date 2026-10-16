const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
function sources(env=process.env){
  const home=env.USERPROFILE||os.homedir(),roaming=env.APPDATA||path.join(home,'AppData/Roaming');
  return [{label:'VS Code',user:path.join(roaming,'Code/User'),extensions:path.join(home,'.vscode/extensions')},{label:'Cursor',user:path.join(roaming,'Cursor/User'),extensions:path.join(home,'.cursor/extensions')}].filter(item=>fs.existsSync(item.user));
}
async function run(vscode,context,root,env=process.env){
  if(!fs.existsSync(path.join(root,'installation.ini'))||context.globalState.get('profileImportPrompted'))return;
  const found=sources(env);
  if(!found.length){await context.globalState.update('profileImportPrompted',true);return;}
  await context.globalState.update('profileImportPrompted',true);
  const answer=await vscode.window.showInformationMessage(`发现 ${found.map(x=>x.label).join(' 和 ')} 的本机数据。要导入设置、快捷键、代码片段和扩展到 GPTIDE 吗？Cursor 聊天会在打开对应项目时读取。`,'导入','暂不导入');
  if(answer==='导入'){
    const selected=found.length===1?found[0]:await vscode.window.showQuickPick(found,{title:'选择导入来源'});
    if(selected){
      // Import can reload the window; persist the decision before that happens.
      await context.globalState.update('profileImportPrompted',true);
      try{await require('./vscode-import-ui.cjs').run(vscode,root,context.globalStorageUri,selected);}
      catch(error){await context.globalState.update('profileImportPrompted',false);throw error;}
      return;
    }
  }
  await context.globalState.update('profileImportPrompted',true);
}
module.exports={sources,run};
