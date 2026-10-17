const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),https=require('node:https'),{Readable}=require('node:stream'),{EventEmitter}=require('node:events');
const network=require('../builtin/update-network.cjs');
function mock(t,responses){const old=https.get,calls=[];https.get=(url,options,callback)=>{calls.push({url:String(url),headers:options.headers});const req=new EventEmitter();req.setTimeout=()=>req;req.destroy=error=>{queueMicrotask(()=>req.emit('error',error));};queueMicrotask(()=>{if(options.signal?.aborted){const error=Error('canceled');error.name='AbortError';req.emit('error',error);return;}const item=responses.shift(),res=Readable.from(item.body?[Buffer.from(item.body)]:[]);res.statusCode=item.status||200;res.headers=item.headers||{};callback(res);});return req;};t.after(()=>{https.get=old;});return calls;}
test('GitHub asset redirects strip authorization outside api.github.com',async t=>{
  const calls=mock(t,[{status:302,headers:{location:'https://release-assets.githubusercontent.com/download'}},{body:'hello'}]);
  const stream=await network.response('https://api.github.com/repos/BigDaaddyy/GPTIDE/releases/assets/1',{token:'fixture-secret',accept:'application/octet-stream'});let value='';for await(const chunk of stream)value+=chunk;assert.equal(value,'hello');assert.equal(calls[0].headers.Authorization,'Bearer fixture-secret');assert.equal(calls[1].headers.Authorization,undefined);
});
test('download rejects excess bytes and cleans partial files',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gptide-net-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));mock(t,[{body:'too much'},{body:'abc'}]);
  const file=path.join(dir,'asset');await assert.rejects(network.download('https://api.github.com/asset',file,{bytes:3}),/声明大小/);assert.equal(fs.existsSync(file),false);await network.download('https://api.github.com/asset',file,{bytes:3});assert.equal(fs.readFileSync(file,'utf8'),'abc');
});
test('unsafe redirects, HTTP failures and cancellation never become update content',async t=>{
  mock(t,[{status:302,headers:{location:'https://evil.example/download'}},{status:404}]);await assert.rejects(network.response('https://api.github.com/asset'),/不受信任/);await assert.rejects(network.json('https://api.github.com/asset'),error=>error.status===404);const controller=new AbortController();controller.abort();await assert.rejects(network.json('https://api.github.com/asset',{signal:controller.signal}),error=>error.name==='AbortError');
});
