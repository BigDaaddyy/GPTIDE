const https=require('node:https'),fs=require('node:fs');
function allowed(url){const value=new URL(url);if(value.protocol!=='https:'||value.username||value.password||value.port||!['api.github.com','github.com','objects.githubusercontent.com','release-assets.githubusercontent.com'].includes(value.hostname))throw Error('更新下载地址不受信任');return value;}
function response(url,{token,signal,accept='application/vnd.github+json'}={},hops=0){
  const value=allowed(url);if(hops>5)throw Error('更新下载重定向过多');
  return new Promise((resolve,reject)=>{
    const headers={'User-Agent':'GPTIDE-Updater','Accept':accept,'X-GitHub-Api-Version':'2022-11-28'};if(token&&value.hostname==='api.github.com')headers.Authorization='Bearer '+token;
    const request=https.get(value,{headers,signal},res=>{
      if([301,302,303,307,308].includes(res.statusCode)){res.resume();if(!res.headers.location)return reject(Error('更新下载地址缺失'));try{resolve(response(new URL(res.headers.location,value).href,{token,signal,accept},hops+1));}catch(error){reject(error);}return;}
      if(res.statusCode!==200){res.resume();const error=Error('GitHub 请求失败（'+res.statusCode+'）');error.status=res.statusCode;reject(error);return;}resolve(res);
    });request.setTimeout(30000,()=>request.destroy(Error('更新下载连接超时')));request.on('error',reject);
  });
}
async function json(url,options={}){const stream=await response(url,options),chunks=[];let bytes=0;try{for await(const chunk of stream){bytes+=chunk.length;if(bytes>8*1024**2)throw Error('更新元数据过大');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}finally{stream.destroy();}}
async function download(url,file,{token,signal,bytes,onProgress=()=>{}}={}){
  if(!Number.isSafeInteger(bytes)||bytes<0||bytes>1024**3)throw Error('更新下载大小无效');
  const stream=await response(url,{token,signal,accept:'application/octet-stream'});let total=0,fd,created=false;
  try{fd=fs.openSync(file,'wx');created=true;for await(const chunk of stream){total+=chunk.length;if(total>bytes)throw Error('更新下载超出声明大小');fs.writeFileSync(fd,chunk);onProgress(total/bytes);}if(total!==bytes)throw Error('更新下载未完成');}
  catch(error){if(fd!==undefined){fs.closeSync(fd);fd=undefined;}if(created)try{fs.unlinkSync(file);}catch{}throw error;}
  finally{if(fd!==undefined)fs.closeSync(fd);stream.destroy();}
}
module.exports={allowed,response,json,download};
