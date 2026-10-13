const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const app = path.join(root, 'app');
if (!fs.existsSync(path.join(app, 'VSCodium.exe'))) throw new Error('请先解压官方 VSCodium 完整 Windows 运行包到 app 目录');
const target = path.join(app, 'resources', 'app', 'extensions', 'gptide-chat');
fs.mkdirSync(target, { recursive: true });
for (const name of fs.readdirSync(path.join(root, 'builtin'))) fs.copyFileSync(path.join(root, 'builtin', name), path.join(target, name));
const runtime = path.join(root, 'runtime'); fs.mkdirSync(runtime, { recursive: true }); fs.copyFileSync(process.execPath, path.join(runtime, 'node.exe'));
const productFile = path.join(app, 'resources', 'app', 'product.json'); const product = JSON.parse(fs.readFileSync(productFile, 'utf8'));
Object.assign(product, { nameShort: 'GptIDE', nameLong: 'GptIDE', applicationName: 'gptide', dataFolderName: '.gptide', win32AppUserModelId: 'GptIDE.Desktop', urlProtocol: 'gptide' });
fs.writeFileSync(productFile, JSON.stringify(product, null, 2));
const manifestCache = path.join(root, 'data', 'user', 'CachedProfilesData', '__default__profile__', 'extensions.builtin.cache');
if (fs.existsSync(manifestCache)) fs.unlinkSync(manifestCache);
const user = path.join(root, 'data', 'user', 'User'); fs.mkdirSync(user, { recursive: true });
const settingsFile = path.join(user, 'settings.json');
// User-level defaults win over VS Code's numerous Ctrl+K chord prefixes.
// Existing user customizations remain owned by the user.
const keysFile = path.join(user, 'keybindings.json');
if (!fs.existsSync(keysFile)) fs.writeFileSync(keysFile, JSON.stringify([
  { key: 'ctrl+k', command: 'gptide.inlineEdit', when: 'editorTextFocus' },
  { key: 'ctrl+shift+k', command: 'gptide.attachSelection', when: 'editorTextFocus' }
], null, 2));
if (!fs.existsSync(settingsFile)) fs.writeFileSync(settingsFile, JSON.stringify({
  'workbench.colorTheme': 'Default Light Modern',
  'workbench.startupEditor': 'none',
  'workbench.sideBar.location': 'left',
  'workbench.activityBar.location': 'top',
  'workbench.editor.empty.hint': 'hidden',
  'window.title': '${rootName}${separator}GptIDE',
  'window.commandCenter': true,
  'window.restoreWindows': 'one',
  'editor.fontSize': 14,
  'editor.minimap.enabled': false,
  'telemetry.telemetryLevel': 'off',
  'update.mode': 'none',
  'extensions.autoUpdate': false,
  'gptide.model': 'gpt-6.1-sol',
  'workbench.colorCustomizations': { 'focusBorder': '#5E6AD2', 'button.background': '#5E6AD2', 'button.hoverBackground': '#4D59BE', 'activityBarBadge.background': '#5E6AD2', 'sideBar.background': '#F8F9FB' }
}, null, 2));
console.log('GptIDE 内置聊天已打包；完整编辑器、Node 运行时和项目独立数据目录已准备。');
