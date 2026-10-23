const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const app = path.join(root, 'app');
if (!fs.existsSync(path.join(app, 'VSCodium.exe'))) throw new Error('请先解压官方 VSCodium 完整 Windows 运行包到 app 目录');
fs.copyFileSync(path.join(root,'assets/logo.svg'),path.join(app,'resources/app/out/media/code-icon.svg'));
// Apply the same brand to native windows and the Windows executable.
for (const [from,to] of [['icon.ico','win32/code.ico'],['icon.png','win32/code_150x150.png'],['icon.png','win32/code_70x70.png']]) fs.copyFileSync(path.join(root,'assets',from),path.join(app,'resources/app/resources',to));
const brandedExe=path.join(app,'GPTIDE.exe'), iconStamp=path.join(app,'.gptide-icon-sha256'), iconHash=require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'assets/icon.ico'))).update(fs.readFileSync(path.join(app,'VSCodium.exe'))).digest('hex');
if(process.platform==='win32'&&(!fs.existsSync(brandedExe)||!fs.existsSync(iconStamp)||fs.readFileSync(iconStamp,'utf8')!==iconHash)){
const candidate=path.join(app,'GPTIDE.build.exe');
try {
fs.copyFileSync(path.join(app,'VSCodium.exe'),candidate);
require('node:child_process').execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'app-icon.ps1'),'-Executable',candidate,'-Icon',path.join(root,'assets/icon.ico')],{windowsHide:true,stdio:'pipe'});
fs.renameSync(candidate,brandedExe);
fs.writeFileSync(iconStamp,iconHash);
} finally { fs.rmSync(candidate,{force:true}); }
}
// Reproducible native styling; replace our block instead of accumulating it.
const workbenchCss = path.join(app, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.css');
const styleStart = '/* GPTIDE WORKBENCH START */', styleEnd = '/* GPTIDE WORKBENCH END */';
const originalCss = fs.readFileSync(workbenchCss, 'utf8').replace(/\n?\/\* GPTIDE WORKBENCH START \*\/[\s\S]*?\/\* GPTIDE WORKBENCH END \*\//g, '');
fs.writeFileSync(workbenchCss, originalCss + '\n' + styleStart + '\n' + fs.readFileSync(path.join(__dirname, 'workbench.css'), 'utf8') + '\n' + styleEnd);
const workbenchJs = path.join(app, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
const nativePatch = require('./workbench-patch.cjs');
const gitMain=path.join(app,'resources/app/extensions/git/dist/main.js');
fs.writeFileSync(gitMain,nativePatch.gitOpenChange(fs.readFileSync(gitMain,'utf8')));
fs.writeFileSync(workbenchJs, nativePatch.homePage(nativePatch.gptAccountMenu(nativePatch.hideTunnelMenu(fs.readFileSync(workbenchJs, 'utf8'))), fs.readFileSync(path.join(__dirname, 'home-render.js'), 'utf8')));
fs.writeFileSync(workbenchJs, nativePatch.inlineInput(fs.readFileSync(workbenchJs, 'utf8'), fs.readFileSync(path.join(__dirname, 'inline-widget.js'), 'utf8')));
fs.writeFileSync(workbenchJs,nativePatch.compactChatChrome(fs.readFileSync(workbenchJs,'utf8')));
fs.writeFileSync(workbenchJs,nativePatch.aboutVersion(fs.readFileSync(workbenchJs,'utf8')));
const target = path.join(app, 'resources', 'app', 'extensions', 'gptide-chat');
fs.mkdirSync(target, { recursive: true });
for (const name of fs.readdirSync(path.join(root, 'builtin'))) fs.copyFileSync(path.join(root, 'builtin', name), path.join(target, name));
const runtime = path.join(root, 'runtime'); fs.mkdirSync(runtime, { recursive: true }); fs.copyFileSync(process.execPath, path.join(runtime, 'node.exe'));
const productFile = path.join(app, 'resources', 'app', 'product.json'); const product = JSON.parse(fs.readFileSync(productFile, 'utf8'));
product.extensionEnabledApiProposals ||= {};product.extensionEnabledApiProposals['gptide.gptide-chat']=['contribSourceControlInputBoxMenu'];
Object.assign(product, { nameShort: 'GPTIDE', nameLong: 'GPTIDE', win32DirName: 'GPTIDE', win32NameVersion: 'GPTIDE', win32ShellNameShort: 'GPTIDE', gptideVersion: require('../package.json').version, applicationName: 'gptide', dataFolderName: '.gptide', sharedDataFolderName: '.gptide-shared', win32AppUserModelId: 'GptIDE.Desktop', urlProtocol: 'gptide' });
if (product.checksums) product.checksums['vs/workbench/workbench.desktop.main.css'] = require('node:crypto').createHash('sha256').update(fs.readFileSync(workbenchCss)).digest('base64').replace(/=+$/, '');
if (product.checksums) product.checksums['vs/workbench/workbench.desktop.main.js'] = require('node:crypto').createHash('sha256').update(fs.readFileSync(workbenchJs)).digest('base64').replace(/=+$/, '');
fs.writeFileSync(productFile, JSON.stringify(product, null, 2));
console.log('GPTIDE 内置聊天与完整运行包已准备；个人数据由启动器放在用户目录。');
