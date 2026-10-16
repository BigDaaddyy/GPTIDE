const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),onboarding=require('../builtin/onboarding.cjs');
test('first installed start detects both profiles, asks before importing, and remembers skip',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gptide-onboarding-'));
 try{
  fs.writeFileSync(path.join(root,'installation.ini'),'[GPTIDE]');const env={APPDATA:path.join(root,'Roaming'),USERPROFILE:path.join(root,'home')};
  for(const source of ['Code','Cursor'])fs.mkdirSync(path.join(env.APPDATA,source,'User'),{recursive:true});
  let saved,asked=0;const context={globalState:{get:()=>saved,update:async(_key,value)=>{saved=value;}}};
  const vscode={window:{showInformationMessage:async text=>{assert.equal(saved,true,'Persist before showing the prompt');asked++;assert.match(text,/VS Code 和 Cursor/);return'暂不导入';}}};
  await onboarding.run(vscode,context,root,env);await onboarding.run(vscode,context,root,env);assert.equal(asked,1);assert.equal(saved,true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('portable runtime does not prompt and missing profiles do not trigger a dialog',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gptide-no-profile-'));let asked=0,saved=false;
 try{const context={globalState:{get:()=>saved,update:async(_key,value)=>{saved=value;}}},vscode={window:{showInformationMessage:async()=>asked++}};
  await onboarding.run(vscode,context,root,{});assert.equal(saved,false);fs.writeFileSync(path.join(root,'installation.ini'),'[GPTIDE]');
  await onboarding.run(vscode,context,root,{APPDATA:path.join(root,'absent'),USERPROFILE:root});assert.equal(asked,0);assert.equal(saved,true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('accepting Cursor import copies selected compatible data into the active profile',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gptide-cursor-onboarding-'));
 try{
  fs.writeFileSync(path.join(root,'installation.ini'),'[GPTIDE]');const env={APPDATA:path.join(root,'Roaming'),USERPROFILE:root},source=path.join(env.APPDATA,'Cursor/User'),target=path.join(root,'profile/User');
  fs.mkdirSync(path.join(source,'snippets'),{recursive:true});fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(source,'settings.json'),'{"editor.fontSize":19}');fs.writeFileSync(path.join(source,'snippets/javascript.json'),'{}');
  let prompts=0,saved=false;const context={globalStorageUri:{fsPath:path.join(target,'globalStorage/gptide.chat')},globalState:{get:()=>saved,update:async(_key,value)=>{saved=value;}}};
  const vscode={commands:{executeCommand:async name=>{assert.equal(saved,true,'Decision persisted before window reload');assert.equal(name,'workbench.action.reloadWindow');}},ProgressLocation:{Notification:1},extensions:{getExtension:()=>undefined},window:{showInformationMessage:async()=>++prompts===1?'导入':'重新加载窗口',showQuickPick:async choices=>Array.isArray(choices)&&typeof choices[0]==='object'?choices:'同名设置使用来源的值',withProgress:async(_options,action)=>action({report(){}},{isCancellationRequested:false,onCancellationRequested:()=>({dispose(){}})})}};
  await onboarding.run(vscode,context,root,env);assert.equal(saved,true);assert.equal(JSON.parse(fs.readFileSync(path.join(target,'settings.json')))['editor.fontSize'],19);assert.ok(fs.existsSync(path.join(target,'snippets/javascript.json')));assert.equal(fs.readFileSync(path.join(source,'settings.json'),'utf8'),'{"editor.fontSize":19}');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
