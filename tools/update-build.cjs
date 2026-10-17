const fs=require('node:fs'),path=require('node:path'),core=require('./update-core.cjs');
async function build(output,baseFile){
  const inventory=JSON.parse(fs.readFileSync(path.join(output,'payload-manifest.json'))),manifest=core.validate({schema:1,version:inventory.version,files:inventory.files});
  const payload=path.join(output,'payload');core.verify(payload,manifest.files);
  fs.writeFileSync(path.join(payload,'gptide-release.json'),JSON.stringify(manifest));
  const update={schema:1,version:manifest.version,manifest,deltas:[]};
  const seen=new Set();for(const file of Array.isArray(baseFile)?baseFile:baseFile?[baseFile]:[]){const raw=JSON.parse(fs.readFileSync(file)),base=core.validate(raw.manifest||{schema:1,...raw});if(!require('../builtin/updates.cjs').newer(manifest.version,base.version)||seen.has(base.version))throw Error('增量基线必须是不同的旧版本');seen.add(base.version);const changes=core.delta(base,manifest),name=`GPTIDE-Update-${base.version}-to-${manifest.version}.bin.gz`;
    update.deltas.push({from:base.version,baseSha256:require('node:crypto').createHash('sha256').update(JSON.stringify(base)).digest('hex'),...await core.bundle(payload,changes.changed,path.join(output,name))});
  }
  fs.writeFileSync(path.join(output,'update-manifest.json'),JSON.stringify(update));return update;
}
if(require.main===module)build(path.resolve(process.argv[2]),process.argv.slice(3)).then(result=>console.log(JSON.stringify({version:result.version,deltas:result.deltas}))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={build};
