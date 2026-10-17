const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
function inspect(name,data){
  const result=[],file=name.replaceAll('\\','/');
  const sample=/^\.env\.(example|sample|template)$/.test(path.basename(file));
  if(/(^|\/)(data|downloads|\.codex|\.cursor|\.gptide)(\/|$)|(^|\/)(auth\.json|usage\.json|state\.vscdb[^/]*|OPERATION_LOG\.md|preview\.png)$|\.(sqlite3?|pem|key|p12|pfx)$/i.test(file)||!sample&&/(^|\/)\.env(?:\.|$)/i.test(file))result.push('private-file');
  if(data.includes(0))return result;
  const text=data.toString('utf8');
  const rules=[['credential',/\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|AKIA[A-Z0-9]{16})\b/],['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]/],['personal-path',/[A-Za-z]:[\\/]+Users[\\/]+(?!Public\b|Default\b|Example\b|test\b|qa\b|user\b|username\b|you\b)[A-Za-z0-9_.-]+[\\/]/i],['personal-email',/\b[A-Za-z0-9._%+-]+@(?:gmail|hotmail|outlook|yahoo|qq|163|126)\.(?:com|cn)\b/i]];
  for(const [kind,pattern]of rules)if(pattern.test(text))result.push(kind);
  return result;
}
function scan({history=false,cwd=process.cwd()}={}){
  const git=(args,input)=>execFileSync('git',args,{cwd,input,maxBuffer:256*1024**2}),findings=[];
  if(history){
    const objects=git(['rev-list','--objects','--all']).toString().trim().split('\n').filter(Boolean),names=new Map(objects.map(line=>{const i=line.indexOf(' ');return[i<0?line:line.slice(0,i),i<0?'':line.slice(i+1)];}));
    const meta=git(['cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)'],[...names.keys()].join('\n')+'\n').toString().trim().split('\n').map(line=>line.split(' ')).filter(row=>row[1]==='blob');
    const output=git(['cat-file','--batch'],meta.map(row=>row[0]).join('\n')+'\n');let offset=0;
    for(const row of meta){const end=output.indexOf(10,offset),size=Number(output.subarray(offset,end).toString().split(' ')[2]),data=output.subarray(end+1,end+1+size);offset=end+size+2;for(const kind of inspect(names.get(row[0]),data))findings.push({file:names.get(row[0]),kind});}
    const emails=git(['log','--all','--format=%ae%n%ce']).toString().trim().split('\n');
    if(emails.some(email=>!/(?:@users\.noreply\.github\.com$|^noreply@github\.com$)/i.test(email)))findings.push({file:'Git commit metadata',kind:'non-private-email'});
  }else{
    const names=git(['ls-files','-z']).toString().split('\0').filter(Boolean);
    for(const name of names)for(const kind of inspect(name,fs.readFileSync(path.join(cwd,name))))findings.push({file:name,kind});
  }
  return [...new Map(findings.map(item=>[item.file+':'+item.kind,item])).values()];
}
if(require.main===module){const findings=scan({history:process.argv.includes('--history')});for(const item of findings)console.error(item.kind+': '+item.file);console.log(findings.length?'Privacy check failed ('+findings.length+' findings; values withheld).':'Privacy check passed.');process.exitCode=findings.length?1:0;}
module.exports={inspect,scan};
