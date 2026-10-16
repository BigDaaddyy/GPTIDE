const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), version = require('../package.json').version;
const output = path.join(root, 'downloads', 'release', version), payload = path.join(output, 'payload');
function copy(from, to) {
  const stat = fs.lstatSync(from); if (stat.isSymbolicLink()) throw Error('安装包禁止符号链接：' + from);
  if (stat.isDirectory()) { fs.mkdirSync(to, { recursive: true }); for (const name of fs.readdirSync(from)) copy(path.join(from,name), path.join(to,name)); }
  else fs.copyFileSync(from, to);
}
function files(dir, relative = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir,e.name),relative+e.name+'/') : [relative+e.name]);
}
function compiler() {
  if (process.env.GPTIDE_MAKENSIS) return process.env.GPTIDE_MAKENSIS;
  const base = path.join(process.env.LOCALAPPDATA || '', 'electron-builder/Cache/nsis-3.0.4.1');
  if (fs.existsSync(base)) for (const name of fs.readdirSync(base)) { const exe = path.join(base,name,'makensis.exe'); if (fs.existsSync(exe)) return exe; }
  throw Error('未找到 NSIS；设置 GPTIDE_MAKENSIS 为 makensis.exe 的完整路径');
}
const makensis=compiler(), compileOnly=process.argv.includes('--compile-only');
if(!compileOnly){
fs.mkdirSync(output,{recursive:true});
// A positive allowlist: never stage data, examples, downloads, git or Codex home.
if (fs.existsSync(payload)) throw Error('打包目录已存在；使用新版本或手动检查并移走旧 payload：'+payload);
fs.mkdirSync(payload);
for (const name of ['app','runtime','tools','assets']) fs.mkdirSync(path.join(payload,name));
for (const name of fs.readdirSync(path.join(root,'app'))) {
  if (['VSCodium.exe','VSCodium.VisualElementsManifest.xml','.gptide-icon-sha256','bin'].includes(name)) continue;
  if (/^(data|logs|cache|user-data)$/i.test(name)) throw Error('运行包中发现数据目录：'+name);
  copy(path.join(root,'app',name),path.join(payload,'app',name));
}
copy(path.join(root,'runtime/node.exe'),path.join(payload,'runtime/node.exe'));
for(const name of ['launch.cjs','cursor-import.cjs'])copy(path.join(root,'tools',name),path.join(payload,'tools',name));
for (const name of ['icon.ico','icon.png','logo.svg']) copy(path.join(root,'assets',name),path.join(payload,'assets',name));
for (const name of ['启动GPTIDE.cmd','README.md','CHANGELOG.md','package.json']) copy(path.join(root,name),path.join(payload,name));
const defaults = path.join(output,'defaults'); fs.mkdirSync(defaults,{recursive:true});
fs.writeFileSync(path.join(defaults,'settings.json'),JSON.stringify(require('./defaults.cjs').settings,null,2));
fs.writeFileSync(path.join(defaults,'keybindings.json'),JSON.stringify(require('./defaults.cjs').keybindings,null,2));
const inventory = files(payload).map(name => {
  if (/(^|\/)(auth\.json|usage\.json|state\.vscdb|\.git|data|downloads|example-project)(\/|$)/i.test(name)) throw Error('安装包发现非发布数据：'+name);
  const data = fs.readFileSync(path.join(payload,name)); return {name,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};
});
fs.writeFileSync(path.join(output,'payload-manifest.json'),JSON.stringify({version,files:inventory},null,2));
}
const defaults=path.join(output,'defaults');
if(compileOnly){const manifest=JSON.parse(fs.readFileSync(path.join(output,'payload-manifest.json'),'utf8'));if(manifest.version!==version)throw Error('版本不匹配');if(JSON.stringify(files(payload).sort())!==JSON.stringify(manifest.files.map(x=>x.name).sort()))throw Error('暂存文件清单已改变');for(const entry of manifest.files){const bytes=fs.readFileSync(path.join(payload,entry.name));if(crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('暂存文件已改变：'+entry.name);}}
const installer = path.join(output,`GPTIDE-Setup-${version}-x64.exe`);
execFileSync(makensis,['/V2',`/DVERSION=${version}`,`/DSOURCE=${root}`,`/DPAYLOAD=${payload}`,`/DDEFAULTS=${defaults}`,`/DOUTPUT=${installer}`,path.join(root,'tools/installer.nsi')],{stdio:'inherit',windowsHide:true});
const digest = crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
fs.writeFileSync(path.join(output,'SHA256SUMS.txt'),`${digest}  ${path.basename(installer)}\n`);
console.log(JSON.stringify({installer,bytes:fs.statSync(installer).size,files:files(payload).length,sha256:digest}));
