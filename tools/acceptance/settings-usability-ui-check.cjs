const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),env=require('../acceptance-env.cjs');
(async()=>{
  const nonce='settings-qa';let html=fs.readFileSync(path.join(env.root,'builtin/settings-panel.html'),'utf8').replace('__SCRIPT__',()=>fs.readFileSync(path.join(env.root,'builtin/settings-panel.js'),'utf8')).replaceAll('__NONCE__',nonce);
  html=html.replace('<script nonce="'+nonce+'">','<script nonce="'+nonce+'">window.qaMessages=[];window.acquireVsCodeApi=()=>({postMessage:m=>qaMessages.push(m)});');
  const file=path.join(env.artifacts,'settings-usability.html');fs.writeFileSync(file,html);const browser=await env.playwright.chromium.launch(env.chromiumOptions);
  try{
    const page=await browser.newPage({viewport:{width:430,height:700}});await page.goto(pathToFileURL(file).href);
    const field={key:'model',label:'首选模型',type:'string',value:'project-model',userValue:'user-model',projectValue:'project-model',effectiveValue:'project-model',source:'项目',hint:'Default for new projects'};
    const state={type:'state',project:'QA project',projectKey:'qa',contextAvailable:true,context:{files:['src/a.js'],rules:'saved rules',excluded:[]},effective:'Offline fixture',fields:[field,{key:'approvalPolicy',label:'授权策略',type:'string',enum:['on-request','never'],value:'on-request',source:'默认'}]};
    const publish=extra=>page.evaluate(s=>window.dispatchEvent(new MessageEvent('message',{data:s})),{...state,...extra});await publish();
    assert.equal(await page.locator('#setting-model').inputValue(),'user-model');await page.locator('#scope').selectOption('project');assert.equal(await page.locator('#setting-model').inputValue(),'project-model');await page.locator('#scope').selectOption('user');
    await page.locator('#setting-model').fill('typed draft');await page.evaluate(()=>window.qaFocused=document.querySelector('#setting-model'));await publish({fields:[{...field,userValue:'external update'},state.fields[1]]});
    assert.equal(await page.locator('#setting-model').inputValue(),'typed draft');assert.ok(await page.evaluate(()=>document.activeElement===qaFocused&&qaFocused===document.querySelector('#setting-model')));
    await page.locator('#setting-model').press('Tab');const request=await page.evaluate(()=>qaMessages.findLast(m=>m.type==='set'));assert.equal(request.value,'typed draft');assert.equal(request.scope,'user');assert.ok(await page.locator('#scope').isDisabled());assert.ok(await page.locator('#setting-approvalPolicy').isDisabled());
    await publish();assert.ok(await page.locator('#scope').isDisabled());await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'settingSaved',key:'model',scope:'user'}})));await publish({fields:[{...field,userValue:'typed draft'},state.fields[1]]});assert.ok(await page.locator('#scope').isEnabled());
    await page.locator('#rules').fill('unsaved rules');assert.equal(await page.locator('#context-status').innerText(),'未保存');await publish();assert.equal(await page.locator('#rules').inputValue(),'unsaved rules');
    await page.locator('#save').click();const save=await page.evaluate(()=>qaMessages.findLast(m=>m.type==='context'));await page.locator('#rules').fill('newer unsaved rules');await page.evaluate(version=>window.dispatchEvent(new MessageEvent('message',{data:{type:'contextSaved',editVersion:version}})),save.editVersion);await publish({context:{...state.context,rules:'unsaved rules'}});
    assert.equal(await page.locator('#rules').inputValue(),'newer unsaved rules');assert.equal(await page.locator('#context-status').innerText(),'未保存');await page.locator('#context-reset').click();assert.equal(await page.locator('#rules').inputValue(),'unsaved rules');assert.ok(await page.locator('#save').isDisabled());
    await publish({project:'',projectKey:null,contextAvailable:false});assert.ok(await page.locator('#save').isDisabled());assert.ok(await page.locator('#rules').isDisabled());
    console.log('Configuration scopes, stable edit focus, pending write locks, unsaved context and older acknowledgments passed without model access.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
