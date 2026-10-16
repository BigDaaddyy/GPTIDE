const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
function locations(env=process.env){
  const home=env.USERPROFILE||os.homedir();
  return {data:path.resolve(env.GPTIDE_DATA_HOME||path.join(env.APPDATA||path.join(home,'AppData/Roaming'),'GPTIDE')),extensions:path.resolve(env.GPTIDE_EXTENSIONS_HOME||path.join(home,'.gptide/extensions'))};
}
// Runtime activation supplies the actual editor user-data location. The legacy
// fallback preserves standalone library callers and explicit portable tooling.
function dataRoot(root){return process.env.GPTIDE_DATA_HOME||path.join(root,'data');}
function fromStorage(storage){
  const profile=path.dirname(path.dirname(storage)),parent=path.dirname(profile);
  return path.basename(parent).toLowerCase()==='profiles'&&path.basename(path.dirname(parent)).toLowerCase()==='user'?path.dirname(path.dirname(parent)):parent;
}
function migrateProfile(storage,data){
  if(!storage)return;
  const profile=path.dirname(path.dirname(storage));
  if((path.basename(path.dirname(profile)).toLowerCase()!=='profiles'||path.basename(path.resolve(profile,'../..')).toLowerCase()!=='user')||path.resolve(profile)===path.resolve(data))return;
  for(const name of ['projects','imports','usage.json'])copyMissing(path.join(profile,name),path.join(data,name));
}
function initialize(context,root){
  if(!process.env.GPTIDE_DATA_HOME){
    const storage=context.globalStorageUri?.fsPath;
    process.env.GPTIDE_DATA_HOME=storage?fromStorage(storage):locations().data;
  }
  const data=dataRoot(root);migrate(root,{data,extensions:locations().extensions});migrateProfile(context.globalStorageUri?.fsPath,data);ensureDefaults(data);return data;
}
function ensureDefaults(data){fs.mkdirSync(path.join(data,'User'),{recursive:true});const defaults=require('./defaults.cjs');for(const [name,value] of [['settings.json',defaults.settings],['keybindings.json',defaults.keybindings]]){const file=path.join(data,'User',name);try{fs.writeFileSync(file,JSON.stringify(value,null,2),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}}}
function copyMissing(source,target){
  if(!fs.existsSync(source))return;
  const origin=path.resolve(source),destination=path.resolve(target),relative=path.relative(origin,destination);
  if(!relative)return;
  if(relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw Error('复制目标不能位于源目录内部');
  if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw Error('复制目标不能是符号链接');
  const stat=fs.lstatSync(source);if(stat.isSymbolicLink())return;
  if(stat.isDirectory()){fs.mkdirSync(target,{recursive:true});for(const name of fs.readdirSync(source))copyMissing(path.join(source,name),path.join(target,name));}
  else if(!fs.existsSync(target)){fs.mkdirSync(path.dirname(target),{recursive:true});try{fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;}}
}
function migrate(root,where=locations()){
  const legacy=path.join(root,'data'), marker=path.join(where.data,'.legacy-migrated.json');
  let recover=false;
  if(fs.existsSync(marker)){
    const original=fs.readFileSync(marker,'utf8');let previous;try{previous=JSON.parse(original);}catch(error){if(!(error instanceof SyntaxError))throw error;}
    if(previous&&typeof previous.from==='string'&&path.isAbsolute(previous.from)){relocateExtensions(path.dirname(previous.from),where);return;}
    fs.copyFileSync(marker,marker+'.invalid-'+require('node:crypto').randomUUID(),fs.constants.COPYFILE_EXCL);
    recover=true;
  }
  if(!fs.existsSync(legacy)||path.resolve(legacy)===path.resolve(where.data)){if(recover)writeMarker(marker,legacy);return;}
  for(const [from,to] of [['user/User','User'],['projects','projects'],['shared','shared'],['imports','imports'],['usage.json','usage.json']])copyMissing(path.join(legacy,from),path.join(where.data,to));
  copyMissing(path.join(legacy,'extensions'),where.extensions);
  relocateExtensions(root,where);
  writeMarker(marker,legacy);
}
function writeMarker(marker,legacy){
  fs.mkdirSync(path.dirname(marker),{recursive:true});const temp=marker+'.'+require('node:crypto').randomUUID()+'.tmp';
  try{fs.writeFileSync(temp,JSON.stringify({from:legacy,timestamp:new Date().toISOString()}),{flag:'wx'});fs.renameSync(temp,marker);}finally{fs.rmSync(temp,{force:true});}
}
function relocateExtensions(root,where){
  const file=path.join(where.extensions,'extensions.json');if(!fs.existsSync(file))return;
  const original=fs.readFileSync(file,'utf8');let entries;try{entries=JSON.parse(original);}catch(error){if(error instanceof SyntaxError)return;throw error;}if(!Array.isArray(entries))return;
  const old=path.resolve(root,'data/extensions').replaceAll('\\','/').toLowerCase();let changed=false;
  for(const entry of entries){
    const value=entry?.location?.path;if(entry?.location?.scheme!=='file'||typeof value!=='string')continue;
    const normalized=value.replace(/^\/(?=[a-z]:)/i,'').replaceAll('\\','/');if(!normalized.toLowerCase().startsWith(old+'/'))continue;
    const next=path.resolve(where.extensions,normalized.slice(old.length+1));
    if(!next.startsWith(path.resolve(where.extensions)+path.sep)||!fs.existsSync(next))continue;
    const formatted=next.replaceAll('\\','/');entry.location.path=value.startsWith('/')&&!formatted.startsWith('/')?'/'+formatted:formatted;delete entry.location.external;changed=true;
  }
  if(changed){const backup=path.join(where.data,'migration-backups');fs.mkdirSync(backup,{recursive:true});fs.writeFileSync(path.join(backup,'extensions-'+require('node:crypto').randomUUID()+'.json'),original);const temp=file+'.'+require('node:crypto').randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(entries));fs.renameSync(temp,file);}
}
module.exports={locations,dataRoot,fromStorage,migrateProfile,initialize,ensureDefaults,copyMissing,migrate};
