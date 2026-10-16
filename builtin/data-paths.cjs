const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
function locations(env=process.env){
  const home=env.USERPROFILE||os.homedir();
  return {data:path.resolve(env.GPTIDE_DATA_HOME||path.join(env.APPDATA||path.join(home,'AppData/Roaming'),'GPTIDE')),extensions:path.resolve(env.GPTIDE_EXTENSIONS_HOME||path.join(home,'.gptide/extensions'))};
}
// Runtime activation supplies the actual editor user-data location. The legacy
// fallback preserves standalone library callers and explicit portable tooling.
function dataRoot(root){return process.env.GPTIDE_DATA_HOME||path.join(root,'data');}
function initialize(context,root){
  if(!process.env.GPTIDE_DATA_HOME){
    const storage=context.globalStorageUri?.fsPath;
    process.env.GPTIDE_DATA_HOME=storage?path.resolve(storage,'../../..'):locations().data;
  }
  const data=dataRoot(root);migrate(root,{data,extensions:locations().extensions});ensureDefaults(data);return data;
}
function ensureDefaults(data){fs.mkdirSync(path.join(data,'User'),{recursive:true});const defaults=require('./defaults.cjs');for(const [name,value] of [['settings.json',defaults.settings],['keybindings.json',defaults.keybindings]]){const file=path.join(data,'User',name);try{fs.writeFileSync(file,JSON.stringify(value,null,2),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}}}
function copyMissing(source,target){
  if(!fs.existsSync(source))return;
  const stat=fs.lstatSync(source);if(stat.isSymbolicLink())return;
  if(stat.isDirectory()){fs.mkdirSync(target,{recursive:true});for(const name of fs.readdirSync(source))copyMissing(path.join(source,name),path.join(target,name));}
  else if(!fs.existsSync(target)){fs.mkdirSync(path.dirname(target),{recursive:true});try{fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;}}
}
function migrate(root,where=locations()){
  const legacy=path.join(root,'data'), marker=path.join(where.data,'.legacy-migrated.json');
  if(fs.existsSync(marker)){const previous=JSON.parse(fs.readFileSync(marker,'utf8'));if(path.isAbsolute(previous.from))relocateExtensions(path.dirname(previous.from),where);return;}
  if(!fs.existsSync(legacy)||path.resolve(legacy)===path.resolve(where.data))return;
  for(const [from,to] of [['user/User','User'],['projects','projects'],['shared','shared'],['imports','imports'],['usage.json','usage.json']])copyMissing(path.join(legacy,from),path.join(where.data,to));
  copyMissing(path.join(legacy,'extensions'),where.extensions);
  relocateExtensions(root,where);
  fs.mkdirSync(where.data,{recursive:true});fs.writeFileSync(marker,JSON.stringify({from:legacy,timestamp:new Date().toISOString()}));
}
function relocateExtensions(root,where){
  const file=path.join(where.extensions,'extensions.json');if(!fs.existsSync(file))return;
  const original=fs.readFileSync(file,'utf8'),entries=JSON.parse(original);if(!Array.isArray(entries))return;
  const old=path.resolve(root,'data/extensions').replaceAll('\\','/').toLowerCase();let changed=false;
  for(const entry of entries){
    const value=entry.location?.path;if(entry.location?.scheme!=='file'||typeof value!=='string')continue;
    const normalized=value.replace(/^\/(?=[a-z]:)/i,'').replaceAll('\\','/');if(!normalized.toLowerCase().startsWith(old+'/'))continue;
    const next=path.resolve(where.extensions,normalized.slice(old.length+1));
    if(!next.startsWith(path.resolve(where.extensions)+path.sep)||!fs.existsSync(next))continue;
    const formatted=next.replaceAll('\\','/');entry.location.path=value.startsWith('/')&&!formatted.startsWith('/')?'/'+formatted:formatted;delete entry.location.external;changed=true;
  }
  if(changed){const backup=path.join(where.data,'migration-backups');fs.mkdirSync(backup,{recursive:true});fs.writeFileSync(path.join(backup,'extensions-'+require('node:crypto').randomUUID()+'.json'),original);const temp=file+'.'+require('node:crypto').randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(entries));fs.renameSync(temp,file);}
}
module.exports={locations,dataRoot,initialize,ensureDefaults,copyMissing,migrate};
