const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const {codeTokens,codeLanguage}=require('../builtin/code.cjs');
test('code tokens preserve exact Unicode, whitespace and markup for every supported language',()=>{
  const text='const 名字 = "<script>&"; // hello\r\n# comment\n/* block */ 0xff 1.2e3\n';
  for(const language of ['js','tsx','py','sh','sql','json','yaml','toml','powershell','ruby','rust','css','unknown'])assert.equal(codeTokens(text,language).map(t=>t.text).join(''),text);
  assert.equal(codeLanguage(' TSX '),'typescriptreact');assert.equal(codeLanguage(''),'plaintext');
  const tokens=codeTokens(text,'js');assert.ok(tokens.some(t=>t.kind==='keyword'&&t.text==='const'));assert.ok(tokens.some(t=>t.kind==='string'));assert.ok(tokens.some(t=>t.kind==='comment'));assert.ok(tokens.some(t=>t.kind==='number'));
  assert.equal(codeTokens('SELECT x FROM y','sql')[0].kind,'keyword');assert.equal(codeTokens('True','python')[0].kind,'keyword');
  for(const language of ['ts','tsx'])assert.deepEqual(codeTokens('const interface',language).filter(t=>t.kind==='keyword').map(t=>t.text),['const','interface']);
});
test('large and excessively fragmented code fall back without dropping text',()=>{
  for(const text of ['x'.repeat(200001),'const 1; '.repeat(3000)])assert.deepEqual(codeTokens(text,'js'),[{kind:'plain',text}]);
});
const vscode={languages:{getLanguages:async()=>['javascript','plaintext'],setTextDocumentLanguage:async(doc,language)=>({...doc,language})},Uri:{from:value=>value},workspace:{openTextDocument:async uri=>({uri})},window:{showTextDocument:async doc=>doc}};
const original=Module.prototype.require;let Chat;
try{Module.prototype.require=function(id){return id==='vscode'?vscode:original.apply(this,arguments);};Chat=require('../builtin/extension.cjs').Chat;}finally{Module.prototype.require=original;}
function fixture(){return Object.assign(Object.create(Chat.prototype),{projectKey:'owner',activeId:'a',streamRevision:1,chats:[{id:'a',projectKey:'owner',messages:[{text:'```js\nconst x = 1;\n```'}]}]});}
test('clipboard replies only after completion, reports failure and discards closed-project replies',async()=>{
  const chat=fixture(),replies=[];chat.view={webview:{postMessage:message=>replies.push(message)}};let finish;
  vscode.env={clipboard:{writeText:text=>{assert.equal(text,'whole code');return new Promise(resolve=>{finish=resolve;});}}};
  const pending=chat.copyText('whole code','one');assert.equal(replies.length,0);finish();await pending;assert.deepEqual(replies,[{type:'copied',projectKey:'owner',copyId:'one'}]);
  vscode.env.clipboard.writeText=async()=>{throw new Error('clipboard denied');};await assert.rejects(chat.copyText('x','two'),/denied/);assert.equal(replies.at(-1).type,'copyFailed');
  vscode.env.clipboard.writeText=()=>new Promise(resolve=>{finish=resolve;});const closed=chat.copyText('x','three');chat.invalidated=true;finish();await closed;assert.equal(replies.length,2);
});
test('readonly snippet previews own the current project and resolve the advertised language',async()=>{
  const chat=fixture();let shown;vscode.window.showTextDocument=async doc=>{shown=doc;};await chat.showCode('a',0,0,1);
  assert.equal(shown.uri.scheme,'gptide-code');assert.equal(shown.language,'javascript');assert.equal(chat.codeContent(shown.uri),'const x = 1;');
  assert.throws(()=>chat.codeContent({path:shown.uri.path.replace('owner','other')}),/过期/);chat.invalidated=true;assert.throws(()=>chat.codeContent(shown.uri),/过期/);
});
test('stale, foreign, oversized and nonexistent snippets cannot open editors',async()=>{
  const chat=fixture();await assert.rejects(chat.showCode('a',0,0,0),/更新/);await assert.rejects(chat.showCode('a',-1,0,1),/不存在/);
  chat.chats[0].projectKey='foreign';await assert.rejects(chat.showCode('a',0,0,1),/不存在/);chat.chats[0].projectKey='owner';
  chat.chats[0].messages[0].text='```\n'+'x'.repeat(512*1024+1)+'\n```';await assert.rejects(chat.showCode('a',0,0,1),/过大/);
  chat.chats[0].messages[0].text='```js\nx\n```';let shown=false;vscode.window.showTextDocument=async()=>{shown=true;};vscode.languages.getLanguages=async()=>{chat.streamRevision++;return['javascript'];};await chat.showCode('a',0,0,1);assert.equal(shown,false);
});
