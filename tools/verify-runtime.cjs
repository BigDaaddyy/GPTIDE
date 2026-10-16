const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), base = path.join(root, 'app/resources/app'), manifest = require('../package.json'), builtin = require('../builtin/package.json');
if (!fs.readFileSync(path.join(root,'assets/logo.svg')).equals(fs.readFileSync(path.join(base,'out/media/code-icon.svg')))) throw Error('左上角图标与源码不一致');
if (manifest.version !== builtin.version) throw Error('源码版本不一致');
if (!fs.readFileSync(path.join(root,'assets/icon.ico')).equals(fs.readFileSync(path.join(base,'resources/win32/code.ico')))) throw Error('应用图标与源码不一致');
if (!fs.existsSync(path.join(root, 'app/GPTIDE.exe')) || !fs.existsSync(path.join(root,'runtime/node.exe'))) throw Error('完整运行包或 Node 运行时缺失');
for (const name of fs.readdirSync(path.join(root, 'builtin'))) if (!fs.readFileSync(path.join(root, 'builtin', name)).equals(fs.readFileSync(path.join(base, 'extensions/gptide-chat', name)))) throw Error('内置运行包与源码不一致：' + name);
const product = JSON.parse(fs.readFileSync(path.join(base,'product.json')));
if (product.nameShort !== 'GPTIDE' || product.gptideVersion !== manifest.version || product.sharedDataFolderName !== '.gptide-shared') throw Error('产品身份、版本或共享目录不一致');
if(!product.extensionEnabledApiProposals?.['gptide.gptide-chat']?.includes('contribSourceControlInputBoxMenu'))throw Error('原生提交输入菜单权限缺失');
for (const name of ['vs/workbench/workbench.desktop.main.js','vs/workbench/workbench.desktop.main.css']) {
  const content = fs.readFileSync(path.join(base,'out',name));
  const checksum = crypto.createHash('sha256').update(content).digest('base64').replace(/=+$/,'');
  if (product.checksums?.[name] !== checksum) throw Error('原生资源校验失败：' + name);
}
const source = fs.readFileSync(path.join(base,'out/vs/workbench/workbench.desktop.main.js'),'utf8');
if(!fs.readFileSync(path.join(base,'extensions/git/dist/main.js'),'utf8').includes('/* GPTIDE: Git change fallback */'))throw Error('Git 打开更改回退补丁缺失');
for (const marker of ['/* GPTIDE INLINE START */','/* GPTIDE INLINE END */','/* GPTIDE: compact chat chrome */','/* GPTIDE: relayout chat chrome */']) if (source.split(marker).length !== 2) throw Error('原生补丁缺失或重复：' + marker);
console.log('GPTIDE ' + manifest.version + ' 完整运行包、内置源码、原生校验与产品身份一致');
